import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { ChatMessage } from '../../src/data/chat'
import { dataOf, studyFixture } from '../support/studyFixture'

test('members chat live, retry a lost response once, and delete only permitted messages', async ({ page, browser }) => {
  test.setTimeout(60000)
  const f = await studyFixture()
  const other = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  const list = async () => dataOf(await f.owner.rpc('onmode_chat_messages', { group_id: f.groupId })) as ChatMessage[]
  try {
    await f.login(page, 0)
    const memberPage = await other.newPage()
    await f.login(memberPage, 1)
    const ownerChat = page.getByRole('region', { name: '그룹 채팅', exact: true })
    const memberChat = memberPage.getByRole('region', { name: '그룹 채팅', exact: true })
    await expect(ownerChat.getByText('채팅 연결됨', { exact: true })).toBeVisible()
    await expect(memberChat.getByText('채팅 연결됨', { exact: true })).toBeVisible()
    const greeting = '안녕하세요!\n오늘도 함께 집중해요.'
    await ownerChat.getByRole('textbox', { name: '메시지', exact: true }).fill(greeting)
    await ownerChat.getByRole('textbox', { name: '메시지', exact: true }).press('Control+Enter')
    await expect(memberChat.locator('.chat-bubble').filter({ hasText: greeting })).toBeVisible()
    await expect(ownerChat.getByRole('textbox', { name: '메시지', exact: true })).toHaveValue('')
    const first = (await list())[0]
    const sendPayload = { group_id: f.groupId, action: 'send', payload: { id: first.id, body: greeting } }
    dataOf(await f.owner.rpc('onmode_chat_change', sendPayload))
    dataOf(await f.owner.rpc('onmode_chat_change', sendPayload))
    expect(await list()).toHaveLength(1)
    expect((await f.member.rpc('onmode_chat_change', { group_id: f.groupId, action: 'delete', payload: { id: first.id } })).error?.code).toBe('42501')
    expect((await f.outsider.rpc('onmode_chat_messages', { group_id: f.groupId })).error?.code).toBe('42501')
    expect((await f.anon.rpc('onmode_chat_messages', { group_id: f.groupId })).error?.code).toBe('42501')
    expect((await f.outsider.rpc('onmode_chat_change', { group_id: f.groupId, action: 'send', payload: { id: randomUUID(), body: 'outsider' } })).error?.code).toBe('42501')
    expect(dataOf(await f.outsider.from('group_messages').select('id').eq('group_id', f.groupId))).toEqual([])
    expect(dataOf(await f.outsider.from('group_chat_updates').select('group_id').eq('group_id', f.groupId))).toEqual([])
    expect((await f.member.from('group_messages').update({ body: 'bypass' }).eq('id', first.id)).error?.code).toBe('42501')

    // Let the server store the message, but lose its response before it reaches the composer.
    await page.route('**/rest/v1/rpc/onmode_chat_change', async route => {
      await route.fetch()
      await route.abort('failed')
    }, { times: 1 })
    const retryText = '전송 재시도 확인'
    await ownerChat.getByRole('textbox', { name: '메시지', exact: true }).fill(retryText)
    await ownerChat.getByRole('button', { name: '전송', exact: true }).click()
    await expect(ownerChat.getByRole('alert')).toHaveText(/채팅에 연결하지 못했어요/)
    await expect(ownerChat.getByRole('textbox', { name: '메시지', exact: true })).toHaveValue(retryText)
    await expect(memberChat.locator('.chat-bubble').filter({ hasText: retryText })).toBeVisible()
    await ownerChat.getByRole('button', { name: '다시 전송', exact: true }).click()
    await expect(ownerChat.getByRole('textbox', { name: '메시지', exact: true })).toHaveValue('')
    expect((await list()).filter(m => m.body === retryText)).toHaveLength(1)

    const memberId = (await f.member.auth.getUser()).data.user?.id
    if (!memberId) throw Error('Local member fixture is unavailable.')
    const htmlText = '<img src=x onerror="window.chatInjected=true">\n같이 공부해요.'
    const forgedId = randomUUID()
    dataOf(await f.member.rpc('onmode_chat_change', { group_id: f.groupId, action: 'send', payload: {
      id: forgedId, body: htmlText, senderId: first.senderId,
    } }))
    await expect(memberChat.locator('.chat-bubble').filter({ hasText: htmlText })).toBeVisible()
    expect((await list()).find(m => m.id === forgedId)?.senderId).toBe(memberId)
    expect(await memberPage.evaluate(() => 'chatInjected' in window)).toBe(false)
    expect(await memberPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await memberChat.screenshot({ path: test.info().outputPath('chat-mobile-dark.png'), scale: 'css' })
    const memberOwnId = randomUUID()
    dataOf(await f.member.rpc('onmode_chat_change', { group_id: f.groupId, action: 'send', payload: { id: memberOwnId, body: '내가 삭제할 메시지' } }))
    dataOf(await f.member.rpc('onmode_chat_change', { group_id: f.groupId, action: 'delete', payload: { id: memberOwnId } }))
    expect((await list()).find(m => m.id === memberOwnId)?.body).toBeNull()

    const ownerMessage = ownerChat.locator('[data-message-id="' + first.id + '"]')
    await ownerMessage.getByRole('button', { name: '메시지 삭제' }).click()
    await page.getByRole('dialog', { name: '메시지 삭제' }).getByRole('button', { name: '취소', exact: true }).click()
    await expect(ownerMessage.locator('.chat-bubble')).toHaveText(greeting)
    await ownerMessage.getByRole('button', { name: '메시지 삭제' }).click()
    await page.getByRole('dialog', { name: '메시지 삭제' }).getByRole('button', { name: '삭제 확정' }).click()
    await expect(memberChat.locator('[data-message-id="' + first.id + '"] .chat-bubble')).toHaveText('삭제된 메시지입니다.')
    dataOf(await f.owner.rpc('onmode_chat_change', sendPayload))
    expect((await list()).find(m => m.id === first.id)).toMatchObject({ body: null })
    await ownerChat.locator('[data-message-id="' + forgedId + '"]').getByRole('button', { name: '메시지 삭제' }).click()
    await page.getByRole('dialog', { name: '메시지 삭제' }).getByRole('button', { name: '삭제 확정' }).click()
    await expect(memberChat.locator('[data-message-id="' + forgedId + '"] .chat-bubble')).toHaveText('삭제된 메시지입니다.')
    dataOf(await f.member.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await f.member.rpc('onmode_chat_messages', { group_id: f.groupId })).error?.code).toBe('42501')
    expect((await f.member.rpc('onmode_chat_change', { group_id: f.groupId, action: 'send', payload: { id: randomUUID(), body: 'left' } })).error?.code).toBe('42501')
  } finally { await other.close(); await f.cleanup() }
})

test('chat pagination preserves reading position and limits new sends without penalizing retries', async ({ page }) => {
  test.setTimeout(60000)
  const f = await studyFixture()
  try {
    const ownerId = (await f.owner.auth.getUser()).data.user?.id
    if (!ownerId) throw Error('Local owner fixture is unavailable.')
    // Seed equal timestamps only in the isolated DB to exercise stable cursor pagination.
    f.sql("insert into public.group_messages(id,group_id,sender_id,body,created_at) select gen_random_uuid(),'" + f.groupId + "','" + ownerId + "','이전 대화 ' || n,now() - interval '2 minutes' from generate_series(1,35) n")
    const first = dataOf(await f.owner.rpc('onmode_chat_messages', { group_id: f.groupId })) as ChatMessage[]
    expect(first).toHaveLength(31)
    const cursor = first[29]
    const next = dataOf(await f.owner.rpc('onmode_chat_messages', { group_id: f.groupId, cursor_at: cursor.createdAt, cursor_id: cursor.id })) as ChatMessage[]
    expect(next).toHaveLength(5)
    expect(new Set([...first.slice(0, 30), ...next].map(m => m.id)).size).toBe(35)
    await f.login(page, 0)
    const view = page.getByRole('region', { name: '그룹 채팅', exact: true })
    await expect(view.getByText('채팅 연결됨', { exact: true })).toBeVisible()
    await expect(view.locator('.chat-message')).toHaveCount(30)
    const scroller = view.locator('.chat-scroll')
    await scroller.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')) })
    await view.getByRole('button', { name: '이전 대화 더 보기' }).click()
    await expect(view.locator('.chat-message')).toHaveCount(35)
    await page.reload()
    await page.getByRole('button', { name: '보기', exact: true }).click()
    await expect(view.getByText('채팅 연결됨', { exact: true })).toBeVisible()
    await expect(view.locator('.chat-message')).toHaveCount(30)
    await scroller.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')) })
    const anchor = await scroller.evaluate(node => [...node.querySelectorAll<HTMLElement>('[data-message-id]')].find(item => item.getBoundingClientRect().bottom > node.getBoundingClientRect().top)?.dataset.messageId)
    const newId = randomUUID()
    const send = (id: string) => f.owner.rpc('onmode_chat_change', { group_id: f.groupId, action: 'send', payload: { id, body: '새 메시지 ' + id } })
    dataOf(await send(newId))
    await expect(view.getByRole('button', { name: '새 메시지 보기' })).toBeVisible()
    expect(await scroller.evaluate(node => [...node.querySelectorAll<HTMLElement>('[data-message-id]')].find(item => item.getBoundingClientRect().bottom > node.getBoundingClientRect().top)?.dataset.messageId)).toBe(anchor)
    await view.getByRole('button', { name: '새 메시지 보기' }).click()
    await expect.poll(() => scroller.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(2)
    for (let i = 0; i < 29; i++) dataOf(await send(randomUUID()))
    expect((await send(randomUUID())).error?.message).toMatch(/너무 빠르게/)
    dataOf(await send(newId))
    dataOf(await f.owner.rpc('onmode_chat_change', { group_id: f.groupId, action: 'delete', payload: { id: newId } }))
    expect((await send(randomUUID())).error?.message).toMatch(/너무 빠르게/)
    dataOf(await f.member.rpc('onmode_chat_change', { group_id: f.groupId, action: 'send', payload: { id: randomUUID(), body: '멤버 메시지' } }))
  } finally { await f.cleanup() }
})
