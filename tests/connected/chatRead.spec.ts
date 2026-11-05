import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { ChatMessage, ChatReadCount } from '../../src/data/chat'
import { dataOf, studyFixture } from '../support/studyFixture'

type Fixture = Awaited<ReturnType<typeof studyFixture>>
const send = async (f: Fixture, app: Fixture['owner'], body: string) => {
  const id = randomUUID()
  dataOf(await app.rpc('onmode_chat_change', { group_id: f.groupId, action: 'send', payload: { id, body } }))
  return id
}
const list = async (f: Fixture, app = f.owner) => dataOf(await app.rpc('onmode_chat_messages', { group_id: f.groupId })) as ChatMessage[]
const read = (f: Fixture, app: Fixture['owner'], membershipSince: string, messages: unknown) => app.rpc('onmode_chat_read', { group_id: f.groupId, payload: { membershipSince, messages } })
const count = async (f: Fixture, id: string, app = f.owner) => (dataOf(await app.rpc('onmode_chat_read_counts', { group_id: f.groupId, message_ids: [id] })) as ChatReadCount[])[0]?.readCount

test('read receipts enforce membership, author privacy, exact versions, retries and cleanup', async () => {
  test.setTimeout(90000)
  const f = await studyFixture()
  let otherGroup: string | undefined
  try {
    const id = await send(f, f.owner, '읽음 검증 메시지')
    const own = await send(f, f.member, '내가 보낸 메시지')
    const since = (await list(f, f.member))[0].membershipSince
    const refs = [{ id, version: 1 }]
    for (const app of [f.outsider, f.anon]) {
      expect((await read(f, app, since, refs)).error?.code).toBe('42501')
      expect((await app.rpc('onmode_chat_read_counts', { group_id: f.groupId, message_ids: [id] })).error?.code).toBe('42501')
    }
    expect((await read(f, f.member, 'old membership', refs)).error?.code).toBe('40001')
    for (const invalid of [null, {}, [], Array.from({ length: 31 }, () => refs[0]), [null], [refs[0], refs[0]], [{ id, version: 0 }], [{ id, version: 1.5 }], [{ id, version: '1' }], [{ id, version: 2147483648 }], [{ id, version: 1, userId: 'forged' }]]) expect((await read(f, f.member, since, invalid)).error?.code).toBe('22023')
    expect((await read(f, f.member, since, [{ id: randomUUID(), version: 1 }])).error?.code).toBe('42501')
    otherGroup = dataOf(await f.owner.rpc('onmode_group_change', { action: 'create', payload: { name: '읽음 범위 검증', description: '', isPublic: false, goalMinutes: 60 } })) as string
    const otherId = randomUUID()
    dataOf(await f.owner.rpc('onmode_chat_change', { group_id: otherGroup, action: 'send', payload: { id: otherId, body: '다른 그룹' } }))
    expect((await read(f, f.member, since, [{ id: otherId, version: 1 }])).error?.code).toBe('42501')
    expect(dataOf(await read(f, f.member, since, [{ id: own, version: 1 }]))).toBe(0)
    const messageUpdate = dataOf<{ version: number }>(await f.owner.from('group_chat_updates').select('version').eq('group_id', f.groupId).single()).version
    // The caller cannot select a different reader through an extra payload field.
    expect(dataOf(await f.member.rpc('onmode_chat_read', { group_id: f.groupId, payload: { membershipSince: since, messages: refs, userId: (await f.owner.auth.getUser()).data.user!.id } }))).toBe(1)
    expect(await count(f, id)).toBe(1)
    expect(await count(f, id, f.member)).toBeUndefined()
    const firstReceipt = dataOf(await f.member.from('group_message_reads').select('message_id,version,read_at').eq('message_id', id))
    const receiptUpdate = dataOf<{ version: number }>(await f.owner.from('group_chat_read_updates').select('version').eq('group_id', f.groupId).single()).version
    expect(dataOf(await read(f, f.member, since, refs))).toBe(0)
    expect(dataOf(await f.member.from('group_message_reads').select('message_id,version,read_at').eq('message_id', id))).toEqual(firstReceipt)
    expect(dataOf<{ version: number }>(await f.owner.from('group_chat_read_updates').select('version').eq('group_id', f.groupId).single()).version).toBe(receiptUpdate)
    expect(dataOf<{ version: number }>(await f.owner.from('group_chat_updates').select('version').eq('group_id', f.groupId).single()).version).toBe(messageUpdate)
    expect(dataOf(await f.outsider.from('group_message_reads').select('message_id'))).toEqual([])
    for (const operation of [f.member.from('group_message_reads').update({ version: 99 }).eq('message_id', id), f.member.from('group_message_reads').delete().eq('message_id', id), f.member.from('group_message_reads').insert({ group_id: f.groupId, message_id: id, user_id: (await f.owner.auth.getUser()).data.user!.id, version: 99 })]) expect((await operation).error?.code).toBe('42501')

    dataOf(await f.owner.rpc('onmode_chat_change', { group_id: f.groupId, action: 'edit', payload: { id, version: 1, editId: randomUUID(), body: '수정한 내용을 다시 확인해요.' } }))
    expect(await count(f, id)).toBe(0)
    expect(dataOf(await read(f, f.member, since, refs))).toBe(0)
    expect(dataOf(await read(f, f.member, since, [{ id, version: 3 }]))).toBe(0)
    expect(dataOf(await read(f, f.member, since, [{ id, version: 2 }]))).toBe(1)
    expect(await count(f, id)).toBe(1)
    const code = dataOf(await f.owner.rpc('onmode_groups')).find((g: { id: string }) => g.id === f.groupId).inviteCode
    dataOf(await f.outsider.rpc('onmode_group_change', { action: 'invite', payload: { code } }))
    const outsiderSince = (await list(f, f.outsider))[0].membershipSince
    dataOf(await read(f, f.outsider, outsiderSince, [{ id, version: 2 }]))
    expect(await count(f, id)).toBe(2)
    expect(dataOf(await f.member.from('group_message_reads').select('user_id').eq('message_id', id))).toHaveLength(1)
    expect(dataOf(await f.owner.from('group_message_reads').select('user_id').eq('message_id', id))).toHaveLength(2)
    dataOf(await f.member.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect(await count(f, id)).toBe(1)
    expect((await read(f, f.member, since, [{ id, version: 2 }])).error?.code).toBe('42501')
    dataOf(await f.member.rpc('onmode_group_change', { action: 'invite', payload: { code } }))
    expect((await read(f, f.member, since, [{ id, version: 2 }])).error?.code).toBe('40001')
    dataOf(await read(f, f.member, (await list(f, f.member))[0].membershipSince, [{ id, version: 2 }]))
    expect(await count(f, id)).toBe(2)
    dataOf(await f.owner.rpc('onmode_chat_change', { group_id: f.groupId, action: 'delete', payload: { id } }))
    expect(await count(f, id)).toBe(0)
    expect(dataOf(await read(f, f.member, (await list(f, f.member))[0].membershipSince, [{ id, version: 3 }]))).toBe(0)
    f.sql("delete from public.study_groups where id = '" + f.groupId + "'")
    expect(f.sql("select count(*) from public.group_message_reads where group_id = '" + f.groupId + "'")).toBe('0')
    expect(f.sql("select count(*) from public.group_chat_read_updates where group_id = '" + f.groupId + "'")).toBe('0')
  } finally { if (otherGroup) f.sql("delete from public.study_groups where id = '" + otherGroup + "'"); await f.cleanup() }
})

test('visible message endings acknowledge live, hidden/offscreen chats do not, and a lost response retries safely', async ({ page, browser }) => {
  test.setTimeout(120000)
  const f = await studyFixture()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  try {
    const id = await send(f, f.owner, '오늘도 함께 집중해요.')
    await f.login(page, 0)
    const member = await context.newPage()
    await f.login(member, 1)
    const ownerChat = page.getByRole('region', { name: '그룹 채팅', exact: true })
    const memberChat = member.getByRole('region', { name: '그룹 채팅', exact: true })
    await expect(memberChat.getByText('채팅 연결됨', { exact: true })).toBeVisible()
    await member.waitForTimeout(700)
    expect(await count(f, id)).toBe(0)
    await member.bringToFront()
    await memberChat.locator('.chat-scroll').scrollIntoViewIfNeeded()
    await memberChat.locator('.chat-scroll').focus()
    await expect.poll(() => count(f, id)).toBe(1)
    await expect(ownerChat.locator(`[data-message-id="${id}"]`).getByLabel('메시지 읽음 인원')).toHaveText('읽음 1명')
    const reply = await send(f, f.member, '확인했어요. 독서 목표부터 시작할게요.')
    await page.bringToFront()
    await ownerChat.locator('.chat-scroll').scrollIntoViewIfNeeded()
    await ownerChat.locator('.chat-scroll').focus()
    await expect.poll(() => count(f, reply, f.member)).toBe(1)
    await member.bringToFront()
    await memberChat.locator('.chat-scroll').scrollIntoViewIfNeeded()
    await expect(memberChat.locator(`[data-message-id="${reply}"]`).getByLabel('메시지 읽음 인원')).toHaveText('읽음 1명')
    expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await memberChat.screenshot({ path: test.info().outputPath('chat-read-mobile-dark.png'), scale: 'css' })
    let loseResponse = true
    await member.route('**/rest/v1/rpc/onmode_chat_read', async route => {
      if (loseResponse) { loseResponse = false; await route.fetch(); await route.abort(); return }
      await route.continue()
    })
    const retry = await send(f, f.owner, '읽음 재시도 확인')
    await expect(memberChat.locator('.chat-read-issue').getByRole('alert')).toHaveText(/읽음 상태를 갱신하지 못했어요/)
    expect(await count(f, retry)).toBe(1)
    const version = dataOf<{ version: number }>(await f.owner.from('group_chat_read_updates').select('version').eq('group_id', f.groupId).single()).version
    await memberChat.locator('.chat-read-issue').getByRole('button', { name: '다시 시도', exact: true }).click()
    await expect(memberChat.locator('.chat-read-issue')).toHaveCount(0)
    expect(dataOf<{ version: number }>(await f.owner.from('group_chat_read_updates').select('version').eq('group_id', f.groupId).single()).version).toBe(version)
    // Simulate visibility lifecycle while still allowing deterministic UI assertions.
    await member.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
    const hidden = await send(f, f.owner, '백그라운드에서는 읽지 않아요.')
    await expect(memberChat.locator(`[data-message-id="${hidden}"]`)).toHaveCount(1)
    await member.waitForTimeout(700)
    expect(await count(f, hidden)).toBe(0)
    await member.evaluate(() => { Reflect.deleteProperty(document, 'visibilityState'); document.dispatchEvent(new Event('visibilitychange')) })
    await memberChat.locator('.chat-scroll').focus()
    await expect.poll(() => count(f, hidden)).toBe(1)
    // A real modal covers the conversation. Closing a delete dialog does not
    // reload messages, so DOM removal alone must restart visibility detection.
    await memberChat.locator(`[data-message-id="${reply}"]`).getByRole('button', { name: '메시지 삭제' }).click()
    const behindDialog = await send(f, f.owner, '대화상자 뒤의 메시지는 읽지 않아요.')
    await expect(memberChat.locator(`[data-message-id="${behindDialog}"]`)).toHaveCount(1)
    await member.waitForTimeout(700)
    expect(await count(f, behindDialog)).toBe(0)
    await member.getByRole('dialog', { name: '메시지 삭제' }).getByRole('button', { name: '취소', exact: true }).click()
    await expect.poll(() => count(f, behindDialog)).toBe(1)
  } finally { await context.close(); await f.cleanup() }
})

test('older conversations retain their anchor and never acknowledge an offscreen new message', async ({ page }) => {
  test.setTimeout(90000)
  const f = await studyFixture()
  try {
    const ownerId = (await f.owner.auth.getUser()).data.user!.id
    f.sql("insert into public.group_messages(id,group_id,sender_id,body,created_at) select gen_random_uuid(),'" + f.groupId + "','" + ownerId + "','이전 대화 ' || n,now() - interval '2 minutes' from generate_series(1,35) n")
    const own = await send(f, f.member, '읽음 갱신과 스크롤 위치 확인')
    await f.login(page, 1)
    const view = page.getByRole('region', { name: '그룹 채팅', exact: true })
    await expect(view.getByText('채팅 연결됨', { exact: true })).toBeVisible()
    const scroller = view.locator('.chat-scroll')
    await page.bringToFront(); await scroller.scrollIntoViewIfNeeded(); await scroller.focus()
    await scroller.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')) })
    const anchor = await scroller.evaluate(node => [...node.querySelectorAll<HTMLElement>('[data-message-id]')].find(item => item.getBoundingClientRect().bottom > node.getBoundingClientRect().top)?.dataset.messageId)
    const since = (await list(f))[0].membershipSince
    dataOf(await read(f, f.owner, since, [{ id: own, version: 1 }]))
    await expect(view.locator(`[data-message-id="${own}"]`).getByLabel('메시지 읽음 인원')).toHaveText('읽음 1명')
    expect(await scroller.evaluate(node => [...node.querySelectorAll<HTMLElement>('[data-message-id]')].find(item => item.getBoundingClientRect().bottom > node.getBoundingClientRect().top)?.dataset.messageId)).toBe(anchor)
    await expect(view.getByRole('button', { name: '새 메시지 보기' })).toHaveCount(0)
    const newest = await send(f, f.owner, '화면 아래의 새 메시지')
    await expect(view.getByRole('button', { name: '새 메시지 보기' })).toBeVisible()
    await page.waitForTimeout(700)
    expect(await count(f, newest)).toBe(0)
    await view.getByRole('button', { name: '새 메시지 보기' }).click()
    await expect.poll(() => count(f, newest)).toBe(1)
    expect(await scroller.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(2)
  } finally { await f.cleanup() }
})
