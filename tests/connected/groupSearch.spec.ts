import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { PublicGroup } from '../../src/data/supabase'
import { dataOf, studyFixture } from '../support/studyFixture'

type Fixture = Awaited<ReturnType<typeof studyFixture>>
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'"
const search = (app: Fixture['owner'], query: string, cursor?: PublicGroup) =>
  app.rpc('onmode_search_public_groups', { search_query: query, cursor_name: cursor?.name ?? null, cursor_id: cursor?.id ?? null })

async function discoveryFixture() {
  const f = await studyFixture()
  const tag = 'search' + randomUUID().slice(0, 8)
  const name = '검색 스터디 ' + tag
  const rows = Array.from({ length: 24 }, (_, i) => ({
    id: randomUUID(),
    description: '리듬 학습 · 회차 ' + String(i + 1).padStart(2, '0') + (i === 0 ? ' alpha %_' : i === 1 ? ' beta' : i === 23 ? ' 비공개표식' : ''),
    isPublic: i < 23,
  }))
  const ownerId = (await f.owner.auth.getUser()).data.user!.id
  const ids = rows.map(row => literal(row.id)).join(',')
  async function cleanup() {
    try { f.sql('delete from public.study_groups where id in (' + ids + ')') }
    finally { await f.cleanup() }
  }
  try {
    f.sql('insert into public.study_groups(id,name,description,is_public,goal_minutes) values ' +
      rows.map(row => '(' + [literal(row.id), literal(name), literal(row.description), row.isPublic, 120].join(',') + ')').join(',') +
      "; insert into public.group_members(group_id,user_id,role) select id," + literal(ownerId) + ",'owner' from public.study_groups where id in (" + ids + ")" +
      '; insert into public.group_updates(group_id) select id from public.study_groups where id in (' + ids + ')')
    return { ...f, tag, name, rows, cleanup }
  } catch (error) { await cleanup(); throw error }
}

test('public search keeps equal names paginated and hides private and joined groups', async () => {
  const f = await discoveryFixture()
  try {
    expect((await search(f.anon, f.tag)).error?.code).toBe('42501')
    expect((await f.anon.rpc('onmode_my_groups')).error?.code).toBe('42501')
    const query = '  ' + f.tag.toUpperCase() + '   리듬  '
    const first = dataOf(await search(f.member, query)) as PublicGroup[]
    expect(first).toHaveLength(21)
    const second = dataOf(await search(f.member, query, first[19])) as PublicGroup[]
    expect(second).toHaveLength(3)
    const shown = [...first.slice(0, 20), ...second]
    expect(shown.map(item => item.id)).toEqual(f.rows.filter(row => row.isPublic).map(row => row.id).sort())
    expect(shown.every(item => item.isPublic && item.members === 1)).toBe(true)
    expect(Object.keys(first[0]).sort()).toEqual(['description', 'id', 'isPublic', 'members', 'name'])
    expect(dataOf(await search(f.member, f.tag + ' %_'))).toMatchObject([{ id: f.rows[0].id }])
    expect(dataOf(await search(f.member, f.tag + ' 비공개표식'))).toEqual([])
    expect(dataOf(await search(f.owner, f.tag))).toEqual([])
    expect((await search(f.member, '가'.repeat(121))).error?.code).toBe('22023')
    expect((await f.member.rpc('onmode_search_public_groups', { search_query: f.tag, cursor_id: first[0].id })).error?.code).toBe('22023')

    const ownerGroups = dataOf(await f.owner.rpc('onmode_my_groups'))
    expect(ownerGroups.find((group: { id: string }) => group.id === f.rows[0].id)).toMatchObject({ role: 'owner', inviteCode: expect.any(String) })
    expect(ownerGroups.find((group: { id: string }) => group.id === f.rows[23].id)).toMatchObject({ role: 'owner', isPublic: false })
    expect(dataOf(await f.member.rpc('onmode_my_groups'))).toMatchObject([{ id: f.groupId, role: 'member', isPublic: false }])
    dataOf(await f.member.rpc('onmode_group_change', { action: 'join', payload: { id: f.rows[0].id } }))
    expect(dataOf(await search(f.member, f.tag + ' alpha'))).toEqual([])
    expect(dataOf(await search(f.outsider, f.tag + ' alpha'))).toMatchObject([{ id: f.rows[0].id, members: 2 }])
    const joined = dataOf(await f.member.rpc('onmode_my_groups')).find((group: { id: string }) => group.id === f.rows[0].id)
    expect(joined).toMatchObject({ role: 'member' })
    expect(joined.inviteCode).toBeUndefined()
  } finally { await f.cleanup() }
})

test('mobile search keeps the newest query and retries a failed page before joining', async ({ browser }) => {
  test.setTimeout(90000)
  const f = await discoveryFixture()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true })
  let releaseOlder = () => {}
  try {
    const page = await context.newPage()
    const seen = new Set<string>()
    const olderPending = new Promise<void>(resolve => { releaseOlder = resolve })
    let olderReady = () => {}
    const olderFetched = new Promise<void>(resolve => { olderReady = resolve })
    let failNext = true
    let attempts = 0
    await page.route('**/rest/v1/rpc/*', async route => {
      const method = route.request().url().split('/').at(-1)!
      seen.add(method)
      if (method === 'onmode_search_public_groups') {
        const body = route.request().postDataJSON()
        if (body.search_query === f.tag + ' alpha') {
          const response = await route.fetch()
          olderReady()
          await olderPending
          await route.fulfill({ response }).catch(() => undefined)
          return
        }
        if (body.cursor_id) {
          attempts++
          if (failNext) { failNext = false; await route.abort(); return }
        }
      }
      await route.continue()
    })
    await f.login(page, 1)
    expect(seen.has('onmode_my_groups')).toBe(true)
    expect(seen.has('onmode_groups')).toBe(false)
    expect(seen.has('onmode_search_public_groups')).toBe(false)
    const publicTab = page.getByRole('button', { name: '공개 그룹', exact: true })
    const input = page.getByRole('searchbox', { name: '그룹 검색' })
    const publicCards = page.locator('.group-card').filter({ has: page.getByRole('heading', { name: f.name, exact: true }) })
    await publicTab.click()
    await input.fill(f.tag + ' alpha')
    await olderFetched
    await input.fill(f.tag + ' beta')
    await expect(publicCards).toHaveCount(1)
    await expect(publicCards).toContainText('회차 02')
    releaseOlder()
    await expect(publicCards).toContainText('회차 02')
    await expect(publicCards.filter({ hasText: '회차 01' })).toHaveCount(0)
    await input.fill(f.tag + ' 없는 검색어')
    await expect(page.getByText('검색 결과가 없어요', { exact: true })).toBeVisible()
    await input.fill(f.tag.toUpperCase() + '  리듬')
    await expect(publicCards).toHaveCount(20)
    const more = page.getByRole('button', { name: '공개 그룹 더 보기' })
    await more.click()
    await expect(page.getByRole('alert')).toContainText('공개 그룹을 불러오지 못했어요')
    await expect(publicCards).toHaveCount(20)
    await page.getByRole('button', { name: '다시 시도' }).click()
    await expect(publicCards).toHaveCount(23)
    expect(attempts).toBe(2)
    await expect(more).toHaveCount(0)
    const target = publicCards.nth(21)
    const detail = await target.locator('p').innerText()
    const description = detail.slice(0, detail.lastIndexOf(' · '))
    await target.getByRole('button', { name: '가입', exact: true }).click()
    await expect(page.getByRole('button', { name: '내 그룹', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(publicCards).toHaveCount(1)
    await expect(publicCards).toContainText(description)
    await expect(page.getByRole('button', { name: '그룹 탈퇴', exact: true })).toBeVisible()
    await expect(page.locator('.study-group-heading')).toBeFocused()
    await publicTab.click()
    await expect(input).toHaveValue(f.tag.toUpperCase() + '  리듬')
    await expect(publicCards).toHaveCount(20)
    await more.click()
    await expect(publicCards).toHaveCount(22)
    await expect(publicCards.filter({ hasText: description })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  } finally { releaseOlder(); await context.close(); await f.cleanup() }
})
