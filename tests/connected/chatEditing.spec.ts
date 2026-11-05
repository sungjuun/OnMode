import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { ChatMessage } from '../../src/data/chat'
import { dataOf, studyFixture } from '../support/studyFixture'

test('own messages edit live, retain drafts on lost responses, and show edited labels after reload', async ({ page, browser }) => {
  test.setTimeout(90000)
  const f = await studyFixture()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  const id = randomUUID()
  const list = async () => dataOf(await f.owner.rpc('onmode_chat_messages', { group_id: f.groupId })) as ChatMessage[]
  const chatVersion = async () => dataOf<{ version: number }>(await f.owner.from('group_chat_updates').select('version').eq('group_id', f.groupId).single()).version
  try {
    dataOf(await f.member.rpc('onmode_chat_change', { group_id: f.groupId, action: 'send', payload: { id, body: '오늘 공부할 내용을 정리했어요.' } }))
    await f.login(page, 0)
    const member = await context.newPage()
    await f.login(member, 1)
    const ownerChat = page.getByRole('region', { name: '그룹 채팅', exact: true })
    const memberChat = member.getByRole('region', { name: '그룹 채팅', exact: true })
    await expect(memberChat.getByText('채팅 연결됨', { exact: true })).toBeVisible()
    const ownerRow = ownerChat.locator(`[data-message-id="${id}"]`)
    const memberRow = memberChat.locator(`[data-message-id="${id}"]`)
    await expect(ownerRow.getByRole('button', { name: '메시지 수정', exact: true })).toHaveCount(0)
    await expect(ownerRow.getByRole('button', { name: '메시지 삭제', exact: true })).toBeVisible()
    await memberRow.getByRole('button', { name: '메시지 수정', exact: true }).click()
    const dialog = member.getByRole('dialog', { name: '메시지 수정', exact: true })
    const input = dialog.getByRole('textbox', { name: '수정할 메시지', exact: true })
    await expect(input).toHaveValue('오늘 공부할 내용을 정리했어요.')
    await expect(dialog.getByRole('button', { name: '저장', exact: true })).toBeDisabled()
    await input.fill('취소할 수정')
    await dialog.getByRole('button', { name: '취소', exact: true }).click()
    expect((await list())[0]).toMatchObject({ version: 1, editedAt: null, body: '오늘 공부할 내용을 정리했어요.' })
    await memberRow.getByRole('button', { name: '메시지 수정', exact: true }).click()
    await input.fill('   ')
    await expect(dialog.getByRole('button', { name: '저장', exact: true })).toBeDisabled()
    const edited = '<img src=x onerror="window.chatEditedInjected=true">\n오늘은 영어 회화와 독서를 함께 공부해요.'
    await input.fill(edited)
    const before = (await list())[0]
    const beforeChatVersion = await chatVersion()
    let loseResponse = true
    const attempts: { editId: string; version: number }[] = []
    await member.route('**/rest/v1/rpc/onmode_chat_change', async route => {
      const request = route.request().postDataJSON()
      if (request.action === 'edit') {
        attempts.push({ editId: request.payload.editId, version: request.payload.version })
        if (loseResponse) { loseResponse = false; await route.fetch(); await route.abort(); return }
      }
      await route.continue()
    })
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(/채팅에 연결하지 못했어요/)
    await expect(input).toHaveValue(edited)
    await expect(ownerRow.locator('.chat-bubble')).toHaveText(edited)
    await expect(ownerRow.getByText('수정됨', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '다시 저장', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toEqual(attempts[1])
    const after = (await list())[0]
    expect(after).toMatchObject({ id, body: edited, version: 2, createdAt: before.createdAt, deletedAt: null })
    expect(after.editedAt).not.toBeNull()
    expect(await chatVersion()).toBe(beforeChatVersion + 1)
    expect(await member.evaluate(() => 'chatEditedInjected' in window)).toBe(false)
    expect(await page.evaluate(() => 'chatEditedInjected' in window)).toBe(false)
    expect(await memberRow.locator('img').count()).toBe(0)
    await member.reload()
    await member.getByRole('article').filter({ has: member.getByRole('heading', { name: '온모드 집중 스터디', exact: true }) }).getByRole('button', { name: '보기' }).click()
    await expect(memberRow.locator('.chat-bubble')).toHaveText(edited)
    await expect(memberRow.getByText('수정됨', { exact: true })).toBeVisible()
    expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await memberChat.screenshot({ path: test.info().outputPath('chat-edited-mobile-dark.png'), scale: 'css' })

    // Moderation can delete during an edit; a retry must never revive the content.
    await memberRow.getByRole('button', { name: '메시지 수정', exact: true }).click()
    await input.fill('삭제 중에도 남아 있어야 하는 초안')
    dataOf(await f.owner.rpc('onmode_chat_change', { group_id: f.groupId, action: 'delete', payload: { id } }))
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(/삭제된 메시지는 수정할 수 없어요/)
    await expect(input).toHaveValue('삭제 중에도 남아 있어야 하는 초안')
    await expect(dialog.getByRole('button', { name: '저장', exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: '수정 취소하고 최신 대화 보기' }).click()
    await expect(memberRow.locator('.chat-bubble')).toHaveText('삭제된 메시지입니다.')
    await expect(memberRow.getByRole('button', { name: '메시지 수정' })).toHaveCount(0)
    await expect(memberRow.getByText('수정됨', { exact: true })).toHaveCount(0)
    expect((await list())[0]).toMatchObject({ body: null, editedAt: null, version: 3 })
  } finally { await context.close(); await f.cleanup() }
})

test('edit ownership, validation, concurrent versions and deleted or departed senders are enforced', async ({ page }) => {
  test.setTimeout(90000)
  const f = await studyFixture()
  const id = randomUUID(), memberId = randomUUID()
  const list = async () => dataOf(await f.owner.rpc('onmode_chat_messages', { group_id: f.groupId })) as ChatMessage[]
  const edit = (app: typeof f.owner, version: number, body: string, editId = randomUUID(), messageId = id) => app.rpc('onmode_chat_change', { group_id: f.groupId, action: 'edit', payload: { id: messageId, version, body, editId } })
  try {
    dataOf(await f.owner.rpc('onmode_chat_change', { group_id: f.groupId, action: 'send', payload: { id, body: '최초 메시지' } }))
    dataOf(await f.member.rpc('onmode_chat_change', { group_id: f.groupId, action: 'send', payload: { id: memberId, body: '멤버의 메시지' } }))
    const original = (await list()).find(m => m.id === id)!
    for (const app of [f.member, f.outsider, f.anon]) expect((await edit(app, 1, '권한 없는 수정')).error?.code).toBe('42501')
    expect((await edit(f.owner, 1, '그룹장도 다른 사람 내용을 수정할 수 없음', randomUUID(), memberId)).error?.code).toBe('42501')
    expect((await edit(f.owner, 1, '없는 메시지', randomUUID(), randomUUID())).error?.code).toBe('42501')
    expect((await f.owner.rpc('onmode_chat_change', { group_id: randomUUID(), action: 'edit', payload: { id, version: 1, body: '다른 그룹', editId: randomUUID() } })).error?.code).toBe('42501')
    for (const body of ['', '   ', '\n\t', '가'.repeat(2001), null, 123, {}, []]) expect((await f.owner.rpc('onmode_chat_change', { group_id: f.groupId, action: 'edit', payload: { id, version: 1, body, editId: randomUUID() } })).error?.code).toBe('22023')
    for (const version of [undefined, null, '1', 0, -1, 1.5, 2147483647]) expect((await f.owner.rpc('onmode_chat_change', { group_id: f.groupId, action: 'edit', payload: { id, version, body: '버전 검증', editId: randomUUID() } })).error?.code).toBe('22023')
    for (const editId of [undefined, null, 'invalid', 1]) expect((await f.owner.rpc('onmode_chat_change', { group_id: f.groupId, action: 'edit', payload: { id, version: 1, body: '요청 검증', editId } })).error?.code).toBe('22023')
    expect((await list()).find(m => m.id === id)).toEqual(original)
    const choices = [{ text: '동시 수정 A', request: randomUUID() }, { text: '동시 수정 B', request: randomUUID() }]
    const results = await Promise.all(choices.map(c => edit(f.owner, 1, c.text, c.request)))
    expect(results.filter(r => !r.error)).toHaveLength(1)
    expect(results.find(r => r.error)?.error?.code).toBe('40001')
    const winner = choices[results.findIndex(r => !r.error)]
    const second = (await list()).find(m => m.id === id)!
    expect(second).toMatchObject({ version: 2, body: winner.text, createdAt: original.createdAt })
    dataOf(await edit(f.owner, 1, winner.text, winner.request))
    expect((await list()).find(m => m.id === id)).toEqual(second)
    expect((await edit(f.owner, 1, '재사용한 요청의 다른 내용', winner.request)).error?.code).toBe('22023')
    expect((await edit(f.owner, 1, winner.text)).error?.code).toBe('40001')
    dataOf(await edit(f.owner, 2, winner.text))
    expect((await list()).find(m => m.id === id)).toEqual(second)
    expect((await f.owner.from('group_messages').update({ body: '우회', version: 99 }).eq('id', id)).error?.code).toBe('42501')
    expect(dataOf(await f.outsider.from('group_messages').select('id,edited_at,version').eq('id', id))).toEqual([])

    await f.login(page, 0)
    const chat = page.getByRole('region', { name: '그룹 채팅', exact: true })
    const row = chat.locator(`[data-message-id="${id}"]`)
    await row.getByRole('button', { name: '메시지 수정' }).click()
    const dialog = page.getByRole('dialog', { name: '메시지 수정', exact: true })
    const input = dialog.getByRole('textbox', { name: '수정할 메시지', exact: true })
    await input.fill('다른 기기에 앞서 작성 중인 초안')
    const beforeOrder = (await list()).map(m => m.id)
    dataOf(await edit(f.owner, 2, '다른 기기에서 먼저 저장한 내용'))
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(/다른 곳에서 메시지가 수정됐어요/)
    await expect(input).toHaveValue('다른 기기에 앞서 작성 중인 초안')
    expect((await list()).map(m => m.id)).toEqual(beforeOrder)
    expect((await list()).find(m => m.id === id)).toMatchObject({ version: 3, body: '다른 기기에서 먼저 저장한 내용', createdAt: original.createdAt })
    await dialog.getByRole('button', { name: '수정 취소하고 최신 대화 보기' }).click()
    await expect(row.locator('.chat-bubble')).toHaveText('다른 기기에서 먼저 저장한 내용')
    await expect(chat.getByRole('button', { name: '새 메시지 보기' })).toHaveCount(0)
    await row.getByRole('button', { name: '메시지 수정' }).click()
    await expect(input).toHaveValue('다른 기기에서 먼저 저장한 내용')
    await input.fill('최신 내용을 확인한 뒤 저장')
    await input.press('Control+Enter')
    await expect(dialog).not.toBeVisible()
    await expect(row.locator('.chat-bubble')).toHaveText('최신 내용을 확인한 뒤 저장')
    expect((await list()).find(m => m.id === id)?.version).toBe(4)

    const race = await Promise.all([edit(f.owner, 4, '삭제와 경합하는 수정'), f.owner.rpc('onmode_chat_change', { group_id: f.groupId, action: 'delete', payload: { id } })])
    expect(race[1].error).toBeNull()
    if (race[0].error) expect(race[0].error.code).toBe('40001')
    expect((await list()).find(m => m.id === id)).toMatchObject({ body: null, editedAt: null })
    expect((await edit(f.owner, 4, '삭제 후 복원 시도')).error?.code).toBe('40001')
    dataOf(await f.member.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await edit(f.member, 1, '탈퇴 후 수정', randomUUID(), memberId)).error?.code).toBe('42501')
    const code = dataOf(await f.owner.rpc('onmode_groups')).find((g: { id: string }) => g.id === f.groupId).inviteCode
    dataOf(await f.member.rpc('onmode_group_change', { action: 'invite', payload: { code } }))
    dataOf(await f.owner.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await edit(f.member, 4, '그룹장 이관 후 타인 수정')).error?.code).toBe('42501')
    dataOf(await edit(f.member, 1, '이관 후에도 내 메시지만 수정', randomUUID(), memberId))
  } finally { await f.cleanup() }
})
