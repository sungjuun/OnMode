import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { ChatMessage } from '../../src/data/chat'
import type { ChatFile } from '../../src/data/chatFiles'
import { barcodePhoto } from '../support/barcodeFixture'
import { dataOf, studyFixture } from '../support/studyFixture'

const bucket = 'onmode-chat-files'
const cleanFiles = () => execFileSync(process.execPath, ['scripts/chat-file-gc.mjs', '--once'], { stdio: ['ignore', 'pipe', 'pipe'] })
type Fixture = Awaited<ReturnType<typeof studyFixture>>
const fileRows = (f: Fixture) => f.sql("select count(*) from public.group_chat_files where group_id = '" + f.groupId + "'")
const list = async (f: Fixture, app = f.owner) => dataOf(await app.rpc('onmode_chat_messages', { group_id: f.groupId })) as ChatMessage[]
const storageCount = (f: Fixture, key: string) => f.sql("select count(*) from storage.objects where bucket_id = '" + bucket + "' and name = '" + key + "'")
const reservePayload = (body: string, name = '독서 정리.txt') => ({ id: randomUUID(), messageId: randomUUID(), name, mime: 'text/plain', bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') })
const reserve = (f: Fixture, app: Fixture['owner'], payload: Record<string, unknown>) => app.rpc('onmode_chat_file', { group_id: f.groupId, action: 'reserve', payload })

test('photo and file attachments survive upload and send response loss, support preview and download, then remove bytes', async ({ page, browser }) => {
  test.setTimeout(120000)
  const f = await studyFixture()
  const other = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  try {
    await f.login(page, 0)
    const member = await other.newPage()
    await f.login(member, 1)
    const ownerChat = page.getByRole('region', { name: '그룹 채팅', exact: true })
    const memberChat = member.getByRole('region', { name: '그룹 채팅', exact: true })
    await expect(memberChat.getByText('채팅 연결됨', { exact: true })).toBeVisible()
    const input = ownerChat.getByLabel('채팅 첨부 파일', { exact: true })
    await input.setInputFiles({ name: '제외.html', mimeType: 'text/html', buffer: Buffer.from('<h1>제외</h1>') })
    await expect(ownerChat.getByRole('alert')).toHaveText(/JPG·PNG·WebP·PDF·TXT/)
    expect(fileRows(f)).toBe('0')
    const photo = { ...(await barcodePhoto(page)), name: '스터디 사진.png' }
    await input.setInputFiles(photo)
    await expect(ownerChat.getByRole('group', { name: '선택한 첨부 파일' })).toContainText(photo.name)
    let loseUpload = true
    await page.route('**/storage/v1/object/onmode-chat-files/*', async route => {
      if (loseUpload && route.request().method() === 'POST') { loseUpload = false; await route.fetch(); await route.abort(); return }
      await route.continue()
    })
    await ownerChat.getByRole('button', { name: '전송', exact: true }).click()
    await expect(ownerChat.getByRole('alert')).toHaveText(/파일을 업로드하지 못했어요/)
    expect(await list(f)).toEqual([])
    expect(fileRows(f)).toBe('1')
    await expect(ownerChat.getByRole('group', { name: '선택한 첨부 파일' })).toContainText(photo.name)
    let loseSend = true
    const attempts: { id: string; attachmentId: string }[] = []
    await page.route('**/rest/v1/rpc/onmode_chat_change', async route => {
      const request = route.request().postDataJSON()
      if (request.action === 'send' && request.payload.attachmentId) {
        attempts.push({ id: request.payload.id, attachmentId: request.payload.attachmentId })
        if (loseSend) { loseSend = false; await route.fetch(); await route.abort(); return }
      }
      await route.continue()
    })
    await ownerChat.getByRole('button', { name: '다시 전송', exact: true }).click()
    await expect(ownerChat.getByRole('alert')).toHaveText(/채팅에 연결하지 못했어요/)
    await expect(memberChat.getByText(photo.name, { exact: true })).toBeVisible()
    await ownerChat.getByRole('button', { name: '다시 전송', exact: true }).click()
    await expect(ownerChat.getByRole('group', { name: '선택한 첨부 파일' })).toHaveCount(0)
    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toEqual(attempts[1])
    const photoMessage = (await list(f))[0]
    expect(photoMessage.body).toBe('사진을 첨부했어요.')
    expect(photoMessage.attachment).toMatchObject({ name: photo.name, mime: 'image/png', bytes: photo.buffer.length })
    expect(await list(f)).toHaveLength(1)
    expect(storageCount(f, photoMessage.attachment!.objectName)).toBe('1')
    const photoRow = memberChat.locator(`[data-message-id="${photoMessage.id}"]`)
    await photoRow.getByRole('button', { name: '사진 보기', exact: true }).click()
    const preview = member.getByRole('dialog', { name: '첨부 사진', exact: true })
    await expect(preview.getByRole('img')).toBeVisible()
    await expect.poll(() => preview.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    await preview.getByRole('button', { name: '창 닫기' }).click()
    const pdf = Buffer.from('%PDF-1.7\n% Local download fixture\n%%EOF')
    const memberInput = memberChat.getByLabel('채팅 첨부 파일', { exact: true })
    await memberInput.setInputFiles({ name: '스터디 자료.pdf', mimeType: 'application/pdf', buffer: pdf })
    await memberChat.getByRole('textbox', { name: '메시지', exact: true }).fill('함께 볼 자료예요.')
    await memberChat.getByRole('button', { name: '전송', exact: true }).click()
    const pdfRow = ownerChat.locator('.chat-message').filter({ hasText: '스터디 자료.pdf' })
    await expect(pdfRow.getByText('함께 볼 자료예요.', { exact: true })).toBeVisible()
    const [download] = await Promise.all([page.waitForEvent('download'), pdfRow.getByRole('button', { name: '파일 다운로드' }).click()])
    expect(download.suggestedFilename()).toBe('스터디 자료.pdf')
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const part of stream) chunks.push(part)
    expect(Buffer.concat(chunks)).toEqual(pdf)
    await member.reload()
    await member.getByRole('article').filter({ has: member.getByRole('heading', { name: '온모드 집중 스터디', exact: true }) }).getByRole('button', { name: '보기' }).click()
    await expect(memberChat.getByText('스터디 자료.pdf', { exact: true })).toBeVisible()
    expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await memberChat.screenshot({ path: test.info().outputPath('chat-files-mobile-dark.png'), scale: 'css' })
    await ownerChat.locator(`[data-message-id="${photoMessage.id}"]`).getByRole('button', { name: '메시지 삭제' }).click()
    await page.getByRole('dialog', { name: '메시지 삭제', exact: true }).getByRole('button', { name: '삭제 확정' }).click()
    await expect(photoRow.locator('.chat-bubble')).toHaveText('삭제된 메시지입니다.')
    expect((await f.member.storage.from(bucket).download(photoMessage.attachment!.objectName)).error).not.toBeNull()
    cleanFiles()
    expect(storageCount(f, photoMessage.attachment!.objectName)).toBe('0')
  } finally { await other.close(); await f.cleanup(); cleanFiles() }
})

test('private storage rejects foreign, forged, expired and unpublished access and cleans abandoned uploads', async () => {
  test.setTimeout(120000)
  const f = await studyFixture()
  try {
    const body = '함께 읽는 로컬 테스트 파일', payload = reservePayload(body)
    const file = dataOf(await reserve(f, f.owner, payload)) as ChatFile
    expect(dataOf(await reserve(f, f.owner, payload))).toEqual(file)
    expect((await reserve(f, f.owner, { ...payload, sha256: '0'.repeat(64) })).error?.code).toBe('40001')
    for (const invalid of [{ bytes: 10485761 }, { bytes: 0 }, { mime: 'text/html' }, { name: 'run.exe' }, { name: '../file.txt' }, { sha256: 'bad' }]) expect((await reserve(f, f.owner, { ...reservePayload(body), ...invalid })).error?.code).toBe('22023')
    expect((await reserve(f, f.outsider, reservePayload(body))).error?.code).toBe('42501')
    expect((await reserve(f, f.anon, reservePayload(body))).error?.code).toBe('42501')
    expect((await f.owner.rpc('onmode_chat_file_gc', { action: 'claim' })).error?.code).toBe('42501')
    expect((await f.owner.from('group_chat_files').update({ bytes: 1 }).eq('id', file.id)).error?.code).toBe('42501')
    expect((await f.owner.from('group_chat_files').select('sha256')).error?.code).toBe('42501')
    const publish = (app: Fixture['owner'], attachmentId = file.id, id = payload.messageId) => app.rpc('onmode_chat_change', { group_id: f.groupId, action: 'send', payload: { id, body: '파일을 첨부했어요.', attachmentId } })
    expect((await publish(f.owner)).error?.code).toBe('40001')
    const bytes = new Blob([body], { type: 'text/plain' })
    expect((await f.member.storage.from(bucket).upload(file.objectName, bytes)).error).not.toBeNull()
    expect((await f.owner.storage.from(bucket).upload(randomUUID() + '.txt', bytes)).error).not.toBeNull()
    dataOf(await f.owner.storage.from(bucket).upload(file.objectName, bytes, { contentType: 'text/plain', upsert: false }))
    expect((await f.member.storage.from(bucket).download(file.objectName)).error).not.toBeNull()
    expect(dataOf(await f.member.from('group_chat_files').select('id'))).toEqual([])
    expect((await publish(f.member)).error?.code).toBe('42501')
    expect((await publish(f.owner, file.id, randomUUID())).error?.code).toBe('42501')
    dataOf(await publish(f.owner)); dataOf(await publish(f.owner))
    expect(await list(f)).toHaveLength(1)
    expect(await dataOf(await f.member.storage.from(bucket).download(file.objectName)).text()).toBe(body)
    for (const app of [f.outsider, f.anon]) expect((await app.storage.from(bucket).download(file.objectName)).error).not.toBeNull()
    expect((await fetch('http://127.0.0.1:56321/storage/v1/object/public/' + bucket + '/' + file.objectName)).ok).toBe(false)
    expect((await f.owner.storage.from(bucket).update(file.objectName, new Blob(['변조'], { type: 'text/plain' }))).error).not.toBeNull()
    expect(await dataOf(await f.member.storage.from(bucket).download(file.objectName)).text()).toBe(body)
    expect((await f.member.rpc('onmode_chat_file', { group_id: f.groupId, action: 'cancel', payload: { id: file.id } })).error?.code).toBe('42501')
    expect(dataOf(await f.owner.rpc('onmode_chat_file', { group_id: f.groupId, action: 'cancel', payload: { id: file.id } }))).toEqual({ posted: true })
    const badPayload = reservePayload('크기가 다른 파일')
    const mismatch = dataOf(await reserve(f, f.owner, badPayload)) as ChatFile
    expect((await f.owner.storage.from(bucket).upload(mismatch.objectName, new Blob([new Uint8Array(10485761)], { type: 'text/plain' }), { contentType: 'text/plain' })).error).not.toBeNull()
    expect((await f.owner.storage.from(bucket).upload(mismatch.objectName, new Blob(['html'], { type: 'text/html' }), { contentType: 'text/html' })).error).not.toBeNull()
    dataOf(await f.owner.storage.from(bucket).upload(mismatch.objectName, new Blob(['다른 크기'], { type: 'text/plain' }), { contentType: 'text/plain' }))
    expect((await publish(f.owner, mismatch.id, badPayload.messageId)).error?.code).toBe('40001')
    expect(dataOf(await f.owner.rpc('onmode_chat_file', { group_id: f.groupId, action: 'cancel', payload: { id: mismatch.id } }))).toEqual({ posted: false })
    cleanFiles()
    expect(storageCount(f, mismatch.objectName)).toBe('0')
    expect((await reserve(f, f.owner, badPayload)).error?.code).toBe('40001')
    const draft = reservePayload('이전 가입의 첨부 초안')
    const old = dataOf(await reserve(f, f.member, draft)) as ChatFile
    dataOf(await f.member.storage.from(bucket).upload(old.objectName, new Blob(['이전 가입의 첨부 초안'], { type: 'text/plain' }), { contentType: 'text/plain' }))
    dataOf(await f.member.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await f.member.storage.from(bucket).download(file.objectName)).error).not.toBeNull()
    const code = dataOf(await f.owner.rpc('onmode_groups')).find((g: { id: string }) => g.id === f.groupId).inviteCode
    dataOf(await f.member.rpc('onmode_group_change', { action: 'invite', payload: { code } }))
    expect((await publish(f.member, old.id, draft.messageId)).error?.code).toBe('42501')
    expect((await f.member.storage.from(bucket).download(old.objectName)).error).not.toBeNull()
    cleanFiles()
    expect(storageCount(f, old.objectName)).toBe('0')
    expect((await reserve(f, f.member, draft)).error?.code).toBe('40001')
    const expiredPayload = reservePayload('기한 지난 첨부 초안')
    const expired = dataOf(await reserve(f, f.owner, expiredPayload)) as ChatFile
    dataOf(await f.owner.storage.from(bucket).upload(expired.objectName, new Blob(['기한 지난 첨부 초안'], { type: 'text/plain' }), { contentType: 'text/plain' }))
    f.sql("update public.group_chat_files set expires_at = now() - interval '1 minute' where id = '" + expired.id + "'")
    expect((await publish(f.owner, expired.id, expiredPayload.messageId)).error?.code).toBe('40001')
    cleanFiles()
    expect(storageCount(f, expired.objectName)).toBe('0')
    f.sql("delete from public.study_groups where id = '" + f.groupId + "'")
    cleanFiles()
    expect(storageCount(f, file.objectName)).toBe('0')
  } finally { await f.cleanup(); cleanFiles() }
})
