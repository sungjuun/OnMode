import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Notice } from '../../src/data/notices'
import { dataOf, studyFixture } from '../support/studyFixture'

test('owners manage notices, members receive changes, and stale edits cannot overwrite them', async ({ page, browser }) => {
  test.setTimeout(60000)
  const f = await studyFixture()
  const other = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  const list = async () => dataOf(await f.owner.rpc('onmode_notices', { group_id: f.groupId })) as Notice[]
  const change = async (action: string, payload: Partial<Notice>) => dataOf(await f.owner.rpc('onmode_notice_change', { group_id: f.groupId, action, payload }))
  try {
    await f.login(page, 0)
    const memberPage = await other.newPage()
    await f.login(memberPage, 1)
    await expect(memberPage.getByRole('button', { name: '공지 작성' })).toHaveCount(0)
    await page.getByRole('button', { name: '공지 작성' }).click()
    let dialog = page.getByRole('dialog', { name: '공지 작성' })
    await dialog.getByLabel('공지 제목').fill('이번 주 운영 안내')
    await dialog.getByLabel('공지 내용').fill('월요일부터 함께 집중해요.\n목표는 매일 30분입니다.')
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    let memberCard = memberPage.getByRole('article', { name: '이번 주 운영 안내', exact: true })
    await expect(memberCard).toBeVisible()
    await memberCard.getByText('이번 주 운영 안내', { exact: true }).click()
    await expect(memberCard.locator('.notice-body')).toHaveText('월요일부터 함께 집중해요.\n목표는 매일 30분입니다.')
    await expect(memberCard.getByRole('button', { name: '공지 수정' })).toHaveCount(0)
    const first = (await list())[0]
    await Promise.all([change('create', first), change('create', first)])
    expect(await list()).toHaveLength(1)
    for (const action of ['create', 'edit', 'delete']) {
      expect((await f.member.rpc('onmode_notice_change', { group_id: f.groupId, action, payload: { ...first, id: action === 'create' ? randomUUID() : first.id } })).error?.code).toBe('42501')
    }
    expect((await f.outsider.rpc('onmode_notices', { group_id: f.groupId })).error?.code).toBe('42501')
    expect((await f.anon.rpc('onmode_notices', { group_id: f.groupId })).error?.code).toBe('42501')
    expect(dataOf(await f.outsider.from('group_notices').select('id').eq('group_id', f.groupId))).toEqual([])
    expect((await f.owner.from('group_notices').update({ body: 'bypass' }).eq('id', first.id)).error?.code).toBe('42501')

    let card = page.getByRole('article', { name: first.title, exact: true })
    await card.getByText(first.title, { exact: true }).click()
    await card.getByRole('button', { name: '공지 수정' }).click()
    dialog = page.getByRole('dialog', { name: '공지 수정' })
    await dialog.getByLabel('공지 제목').fill('정기 모임 안내')
    const plainText = '<img src=x onerror="window.noticeInjected=true">\n토요일에 모여요.'
    await dialog.getByLabel('공지 내용').fill(plainText)
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    memberCard = memberPage.getByRole('article', { name: '정기 모임 안내', exact: true })
    await expect(memberCard).toBeVisible()
    await expect(memberCard.locator('.notice-body')).toHaveText(plainText)
    expect(await memberPage.evaluate(() => 'noticeInjected' in window)).toBe(false)
    const second = (await list())[0]
    expect(second.version).toBe(2)
    await change('edit', { ...second, version: 1 })
    expect((await list())[0].version).toBe(2)
    expect((await f.owner.rpc('onmode_notice_change', { group_id: f.groupId, action: 'edit', payload: { ...first, body: 'stale' } })).error?.code).toBe('40001')
    expect((await f.owner.rpc('onmode_notice_change', { group_id: f.groupId, action: 'delete', payload: first })).error?.code).toBe('40001')

    card = page.getByRole('article', { name: second.title, exact: true })
    await card.getByRole('button', { name: '공지 수정' }).click()
    dialog = page.getByRole('dialog', { name: '공지 수정' })
    await dialog.getByLabel('공지 내용').fill('내가 작성 중인 초안')
    await change('edit', { ...second, body: '다른 기기에서 저장한 최신 내용' })
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(/다른 곳에서 공지가 변경/)
    await expect(dialog.getByLabel('공지 내용')).toHaveValue('내가 작성 중인 초안')
    await dialog.getByRole('button', { name: '닫고 최신 공지 보기' }).click()
    await expect(card.locator('.notice-body')).toHaveText('다른 기기에서 저장한 최신 내용')
    await expect(memberCard.locator('.notice-body')).toHaveText('다른 기기에서 저장한 최신 내용')
    expect(await memberPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await memberCard.screenshot({ path: test.info().outputPath('notice-mobile-dark.png'), scale: 'css' })

    await card.getByRole('button', { name: '공지 삭제' }).click()
    dialog = page.getByRole('dialog', { name: '공지 삭제' })
    await dialog.getByRole('button', { name: '취소', exact: true }).click()
    await expect(card).toBeVisible()
    const latest = (await list())[0]
    await card.getByRole('button', { name: '공지 삭제' }).click()
    await page.getByRole('dialog', { name: '공지 삭제' }).getByRole('button', { name: '삭제 확정' }).click()
    await expect(memberCard).toHaveCount(0)
    await expect(memberPage.getByText('등록된 공지가 없어요', { exact: true })).toBeVisible()
    await change('delete', latest)
    expect(await list()).toEqual([])
  } finally { await other.close(); await f.cleanup() }
})

test('notice pagination is stable and the next group owner can manage shared notices', async ({ page }) => {
  test.setTimeout(60000)
  const f = await studyFixture()
  const ids: string[] = []
  try {
    for (let i = 0; i < 23; i++) {
      const id = randomUUID()
      ids.push(id)
      dataOf(await f.owner.rpc('onmode_notice_change', { group_id: f.groupId, action: 'create', payload: { id, title: '학습 안내 ' + i, body: '내용 ' + i } }))
    }
    // Equal timestamps exercise the UUID tie-breaker without depending on machine timing.
    f.sql("update public.group_notices set created_at = '2026-11-01T00:00:00Z' where group_id = '" + f.groupId + "'")
    const first = dataOf(await f.owner.rpc('onmode_notices', { group_id: f.groupId })) as Notice[]
    expect(first).toHaveLength(21)
    expect(first.map(n => n.id)).toEqual([...ids].sort().reverse().slice(0, 21))
    const cursor = first[19]
    const next = dataOf(await f.owner.rpc('onmode_notices', { group_id: f.groupId, cursor_at: cursor.createdAt, cursor_id: cursor.id })) as Notice[]
    expect(next).toHaveLength(3)
    expect(new Set([...first.slice(0, 20), ...next].map(n => n.id)).size).toBe(23)
    await f.login(page, 0)
    const section = page.getByRole('region', { name: '그룹 공지' })
    await expect(section.getByRole('article')).toHaveCount(20)
    await section.getByRole('button', { name: '이전 공지 더 보기' }).click()
    await expect(section.getByRole('article')).toHaveCount(23)
    await expect(section.getByRole('button', { name: '이전 공지 더 보기' })).toHaveCount(0)

    dataOf(await f.owner.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await f.owner.rpc('onmode_notices', { group_id: f.groupId })).error?.code).toBe('42501')
    expect((await f.owner.rpc('onmode_notice_change', { group_id: f.groupId, action: 'edit', payload: { ...first[0], body: 'old owner' } })).error?.code).toBe('42501')
    dataOf(await f.member.rpc('onmode_notice_change', { group_id: f.groupId, action: 'edit', payload: { ...first[0], body: '새 그룹장의 공지' } }))
    const updated = dataOf(await f.member.rpc('onmode_notices', { group_id: f.groupId })) as Notice[]
    expect(updated[0]).toMatchObject({ body: '새 그룹장의 공지', version: 2 })
  } finally { await f.cleanup() }
})
