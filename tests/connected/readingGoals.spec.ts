import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { SharedBook, ReadingMember, ReadingGoal } from '../../src/data/groupLibrary'
import type { Activity, View } from '../../src/domain/model'
import { dataOf, studyFixture } from '../support/studyFixture'

const book = (): Activity => ({ id: randomUUID(), kind: 'book', name: '함께 읽는 독서', author: '온모드 저자', pages: 200, currentPage: 70, goalPages: 10 })
type Fixture = Awaited<ReturnType<typeof studyFixture>>
async function publish(f: Fixture) {
  const source = book(), id = randomUUID()
  dataOf(await f.owner.rpc('onmode_command', { command: { type: 'activity', value: source } }))
  dataOf(await f.owner.rpc('onmode_command', { command: { type: 'journal', value: { id: randomUUID(), activityId: source.id, date: '2026-11-05', text: '비공개 독서 노트', amount: 70 } } }))
  dataOf(await f.owner.rpc('onmode_library_change', { group_id: f.groupId, action: 'create', payload: { id, activityId: source.id } }))
  return { source, id }
}
const change = (f: Fixture, app: Fixture['owner'], action: string, payload: Record<string, unknown>) => app.rpc('onmode_library_change', { group_id: f.groupId, action, payload })
async function load(f: Fixture, app = f.owner) { return (dataOf(await app.rpc('onmode_library', { group_id: f.groupId })).books as SharedBook[])[0] }
const progressPayload = (id: string, reading: ReadingGoal, page: number | null, requestId = randomUUID()) => ({
  id, goalRevision: reading.revision, membershipSince: reading.membershipSince, revision: reading.mine?.revision ?? 0, requestId, page,
})

test('reading goals and explicit progress synchronize without publishing or changing private reading history', async ({ page, browser }) => {
  test.setTimeout(120000)
  const f = await studyFixture()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  let releaseMembers = () => {}
  try {
    const { source } = await publish(f)
    for (const [app, name] of [[f.owner, '독서 그룹장'], [f.member, '독서 멤버']] as const) dataOf(await app.rpc('onmode_command', { command: { type: 'profile', value: { name, goalMinutes: 120, notifications: false } } }))
    expect((await load(f)).reading).toBeUndefined()
    await f.login(page, 0)
    const member = await context.newPage()
    await f.login(member, 1)
    const ownerCard = page.getByRole('region', { name: '공동 도서관', exact: true }).getByRole('article', { name: source.name, exact: true })
    const memberCard = member.getByRole('region', { name: '공동 도서관', exact: true }).getByRole('article', { name: source.name, exact: true })
    await expect(memberCard.getByRole('button', { name: '독서 목표 설정' })).toHaveCount(0)
    await ownerCard.getByRole('button', { name: '독서 목표 설정' }).click()
    await page.getByRole('spinbutton', { name: '함께 읽을 목표 페이지' }).fill('100')
    await page.getByRole('dialog', { name: '독서 목표 설정' }).getByRole('button', { name: '저장', exact: true }).click()
    await expect(memberCard.getByRole('heading', { name: '100쪽까지 함께 읽기' })).toBeVisible()
    await expect(ownerCard.getByText('아직 공유한 진도가 없어요.', { exact: true })).toBeVisible()
    expect((await load(f)).reading).toMatchObject({ targetPage: 100, revision: 1, participants: 0, achieved: 0 })
    await memberCard.getByRole('button', { name: '진도 공유', exact: true }).click()
    const dialog = member.getByRole('dialog', { name: '진도 공유', exact: true })
    const input = dialog.getByRole('spinbutton', { name: '공유할 현재 페이지' })
    await expect(input).toHaveValue('0')
    await input.fill('30')
    const requests: Record<string, unknown>[] = []
    let loseResponse = true
    await member.route('**/rest/v1/rpc/onmode_library_change', async route => {
      const body = route.request().postDataJSON()
      if (body.action === 'reading_progress') {
        requests.push(body.payload)
        if (loseResponse) { loseResponse = false; await route.fetch(); await route.abort(); return }
      }
      await route.continue()
    })
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(/연결하지 못했어요/)
    await expect(input).toHaveValue('30')
    await dialog.getByRole('button', { name: '다시 저장' }).click()
    await expect(dialog).not.toBeVisible()
    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual(requests[1])
    expect((await load(f, f.member)).reading).toMatchObject({ participants: 1, achieved: 0, mine: { page: 30, revision: 1 } })
    await ownerCard.getByRole('button', { name: '진도 공유', exact: true }).click()
    await expect(page.getByRole('spinbutton', { name: '공유할 현재 페이지' })).toHaveValue('0')
    await page.getByRole('spinbutton', { name: '공유할 현재 페이지' }).fill('120')
    await page.getByRole('dialog', { name: '진도 공유', exact: true }).getByRole('button', { name: '저장', exact: true }).click()
    await expect(memberCard.getByText('2명 참여 · 참여자 중 목표 달성 1/2명', { exact: true })).toBeVisible()
    await expect(memberCard.getByRole('progressbar', { name: source.name + ' 공동 독서 목표 달성률' })).toHaveAttribute('aria-valuenow', '50')
    await memberCard.getByText('멤버별 공유 진도', { exact: true }).click()
    await expect(memberCard.locator('.reading-members').getByText('독서 그룹장', { exact: true })).toBeVisible()
    await expect(memberCard.locator('.reading-members').getByText('독서 멤버', { exact: true })).toBeVisible()
    expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await memberCard.screenshot({ path: test.info().outputPath('shared-reading-mobile-dark.png'), scale: 'css' })
    expect(await memberCard.innerText()).not.toContain('비공개 독서 노트')
    await memberCard.getByRole('button', { name: '공유 진도 수정' }).click()
    await input.fill('80')
    await dialog.getByRole('button', { name: '취소', exact: true }).click()
    expect((await load(f, f.member)).reading?.mine?.page).toBe(30)
    await memberCard.getByRole('button', { name: '진도 공유 중단', exact: true }).click()
    await member.getByRole('dialog', { name: '진도 공유 중단' }).getByRole('button', { name: '공유 중단 확정' }).click()
    await expect(ownerCard.getByText('1명 참여 · 참여자 중 목표 달성 1/1명', { exact: true })).toBeVisible()
    expect(dataOf(await f.owner.from('group_reading_progress').select('current_page'))).toEqual([{ current_page: 120 }])
    expect((await load(f, f.member)).reading?.mine).toMatchObject({ revision: 2 })
    expect((await load(f, f.member)).reading?.mine?.page).toBeUndefined()
    await memberCard.getByRole('button', { name: '진도 공유', exact: true }).click()
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(memberCard.getByText('내가 공유한 진도 0쪽 / 목표 100쪽', { exact: true })).toBeVisible()
    const memberGate = new Promise<void>(resolve => { releaseMembers = resolve })
    await member.route('**/rest/v1/rpc/onmode_reading_members', async route => { await memberGate; await route.continue() })
    await ownerCard.getByRole('button', { name: '독서 목표 수정' }).click()
    await page.getByRole('spinbutton', { name: '함께 읽을 목표 페이지' }).fill('50')
    await page.getByRole('dialog', { name: '독서 목표 설정' }).getByRole('button', { name: '저장', exact: true }).click()
    await expect(memberCard.getByText('내가 공유한 진도 0쪽 / 목표 50쪽', { exact: true })).toBeVisible()
    // Old-goal rows must disappear while the new-goal request is in flight.
    await expect(memberCard.locator('.reading-members li')).toHaveCount(0)
    releaseMembers()
    await expect(memberCard.locator('.reading-members li')).toHaveCount(2)
    await member.unroute('**/rest/v1/rpc/onmode_reading_members')
    expect((await load(f)).reading).toMatchObject({ targetPage: 50, participants: 2, achieved: 1, mine: { page: 120 } })
    const privateState = (dataOf(await f.owner.rpc('onmode_snapshot')) as View).snapshot
    expect(privateState.activities).toEqual([source])
    expect(privateState.journal[0].text).toBe('비공개 독서 노트')
    expect(privateState.records).toEqual([])
    expect((dataOf(await f.member.rpc('onmode_snapshot')) as View).snapshot.activities).toEqual([])
    expect(dataOf(await f.owner.from('reward_transactions').select('coins'))).toEqual([])
    await member.reload()
    await member.getByRole('article').filter({ has: member.getByRole('heading', { name: '온모드 집중 스터디', exact: true }) }).getByRole('button', { name: '보기' }).click()
    await expect(memberCard.getByText('내가 공유한 진도 0쪽 / 목표 50쪽', { exact: true })).toBeVisible()
    await ownerCard.getByRole('button', { name: '독서 목표 해제' }).click()
    await page.getByRole('dialog', { name: '독서 목표 해제' }).getByRole('button', { name: '해제 확정' }).click()
    await expect(memberCard.getByText('그룹장이 독서 목표를 정하면 진도를 공유할 수 있어요.', { exact: true })).toBeVisible()
    expect(f.sql("select count(*) from public.group_reading_progress where group_id = '" + f.groupId + "'")).toBe('0')
    expect((dataOf(await f.owner.rpc('onmode_snapshot')) as View).snapshot.activities).toEqual([source])
  } finally { releaseMembers(); await context.close(); await f.cleanup() }
})

test('goal and progress versions enforce ownership, privacy, retries, conflicts and fresh membership', async ({ page }) => {
  test.setTimeout(120000)
  const f = await studyFixture()
  try {
    const { id, source } = await publish(f)
    const goalRequest = randomUUID()
    const goal = (app: Fixture['owner'], revision: number, targetPage: unknown, requestId = randomUUID()) => change(f, app, 'reading_goal', { id, revision, targetPage, requestId })
    for (const target of [0, 201, -1, 1.5, '10', {}, [], undefined]) expect((await goal(f.owner, 0, target)).error?.code).toBe('22023')
    expect((await goal(f.member, 0, 100)).error?.code).toBe('42501')
    for (const app of [f.outsider, f.anon]) {
      expect((await goal(app, 0, 100)).error?.code).toBe('42501')
      expect((await app.rpc('onmode_reading_members', { group_id: f.groupId, book_id: id })).error?.code).toBe('42501')
    }
    dataOf(await goal(f.owner, 0, 100, goalRequest))
    const original = (await load(f)).reading!
    dataOf(await goal(f.owner, 0, 100, goalRequest))
    expect((await load(f)).reading).toEqual(original)
    expect((await goal(f.owner, 0, 120, goalRequest)).error?.code).toBe('22023')
    expect((await goal(f.owner, 0, 100)).error?.code).toBe('40001')
    const memberGoal = (await load(f, f.member)).reading!
    const payload = progressPayload(id, memberGoal, 30)
    for (const invalid of [undefined, 'bad', null]) expect((await change(f, f.member, 'reading_progress', { ...payload, requestId: invalid })).error?.code).toBe('22023')
    for (const invalid of [undefined, '0', -1, 1.5, 2147483647]) expect((await change(f, f.member, 'reading_progress', { ...payload, revision: invalid })).error?.code).toBe('22023')
    for (const invalid of [-1, 201, 1.1, '1', {}, [], undefined]) expect((await change(f, f.member, 'reading_progress', { ...payload, page: invalid })).error?.code).toBe('22023')
    expect((await change(f, f.member, 'reading_progress', { ...payload, membershipSince: 'old' })).error?.code).toBe('40001')
    expect((await change(f, f.member, 'reading_progress', { ...payload, goalRevision: 0 })).error?.code).toBe('40001')
    for (const app of [f.outsider, f.anon]) expect((await change(f, app, 'reading_progress', payload)).error?.code).toBe('42501')
    const ownerId = (await f.owner.auth.getUser()).data.user!.id
    dataOf(await change(f, f.member, 'reading_progress', { ...payload, userId: ownerId }))
    expect((await load(f)).reading?.mine).toBeUndefined()
    expect((await load(f, f.member)).reading?.mine).toMatchObject({ page: 30, revision: 1 })
    const current = (await load(f, f.member)).reading!
    const choices = [progressPayload(id, current, 70), progressPayload(id, current, 90)]
    const race = await Promise.all(choices.map(p => change(f, f.member, 'reading_progress', p)))
    expect(race.filter(r => !r.error)).toHaveLength(1)
    expect(race.find(r => r.error)?.error?.code).toBe('40001')
    const winner = choices[race.findIndex(r => !r.error)]
    const published = (await load(f, f.member)).reading!
    dataOf(await change(f, f.member, 'reading_progress', winner))
    expect((await load(f, f.member)).reading).toEqual(published)
    expect((await change(f, f.member, 'reading_progress', { ...winner, page: 50 })).error?.code).toBe('22023')
    expect((await change(f, f.member, 'reading_progress', payload)).error?.code).toBe('40001')
    const withdrawn = progressPayload(id, published, null)
    dataOf(await change(f, f.member, 'reading_progress', withdrawn))
    const hidden = (await load(f, f.member)).reading!
    dataOf(await change(f, f.member, 'reading_progress', withdrawn))
    expect((await load(f, f.member)).reading).toEqual(hidden)
    expect(dataOf(await f.owner.from('group_reading_progress').select('user_id,current_page'))).toEqual([])
    expect(dataOf(await f.outsider.from('group_reading_progress').select('user_id'))).toEqual([])
    expect((await change(f, f.member, 'reading_progress', winner)).error?.code).toBe('40001')
    expect((await f.member.from('group_reading_progress').update({ current_page: 199 }).eq('book_id', id)).error?.code).toBe('42501')
    expect((await f.member.from('group_reading_progress').delete().eq('book_id', id)).error?.code).toBe('42501')
    expect((await f.member.from('group_reading_progress').insert({ book_id: id, group_id: f.groupId, user_id: ownerId, current_page: 199, last_request_id: randomUUID() })).error?.code).toBe('42501')
    dataOf(await change(f, f.member, 'reading_progress', progressPayload(id, hidden, 30)))
    await f.login(page, 1)
    const card = page.getByRole('region', { name: '공동 도서관', exact: true }).getByRole('article', { name: source.name, exact: true })
    await card.getByRole('button', { name: '공유 진도 수정' }).click()
    const dialog = page.getByRole('dialog', { name: '진도 공유', exact: true })
    await dialog.getByRole('spinbutton', { name: '공유할 현재 페이지' }).fill('60')
    dataOf(await goal(f.owner, 1, 150))
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(/독서 목표가 변경됐어요/)
    await expect(dialog.getByRole('spinbutton', { name: '공유할 현재 페이지' })).toHaveValue('60')
    await dialog.getByRole('button', { name: '취소하고 최신 독서 목표 보기' }).click()
    await expect(card.getByText('내가 공유한 진도 30쪽 / 목표 150쪽', { exact: true })).toBeVisible()
    const oldMembership = (await load(f, f.member)).reading!
    const oldRetry = { ...progressPayload(id, oldMembership, 99), revision: 0 }
    dataOf(await f.member.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await change(f, f.member, 'reading_progress', oldRetry)).error?.code).toBe('42501')
    expect((await f.member.rpc('onmode_reading_members', { group_id: f.groupId, book_id: id })).error?.code).toBe('42501')
    expect((await load(f)).reading?.participants).toBe(0)
    const code = dataOf(await f.owner.rpc('onmode_groups')).find((g: { id: string }) => g.id === f.groupId).inviteCode
    dataOf(await f.member.rpc('onmode_group_change', { action: 'invite', payload: { code } }))
    const rejoined = (await load(f, f.member)).reading!
    expect(rejoined.mine).toBeUndefined()
    expect(rejoined.membershipSince).not.toBe(oldMembership.membershipSince)
    expect((await change(f, f.member, 'reading_progress', oldRetry)).error?.code).toBe('40001')
    dataOf(await change(f, f.member, 'reading_progress', progressPayload(id, rejoined, 15)))
    dataOf(await f.owner.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await goal(f.owner, 2, 80)).error?.code).toBe('42501')
    dataOf(await goal(f.member, 2, 80))
    expect((await load(f, f.member)).reading).toMatchObject({ targetPage: 80, mine: { page: 15 } })
    const previousGoalReport = progressPayload(id, (await load(f, f.member)).reading!, 40)
    dataOf(await goal(f.member, 3, null))
    dataOf(await goal(f.member, 4, 120))
    expect((await load(f, f.member)).reading).toMatchObject({ targetPage: 120, participants: 0, achieved: 0 })
    expect((await load(f, f.member)).reading?.mine).toBeUndefined()
    expect((await change(f, f.member, 'reading_progress', previousGoalReport)).error?.code).toBe('40001')
    dataOf(await change(f, f.member, 'delete', { id }))
    expect(f.sql("select count(*) from public.group_reading_progress where book_id = '" + id + "'")).toBe('0')
    expect((dataOf(await f.owner.rpc('onmode_snapshot')) as View).snapshot.activities).toEqual([source])
  } finally { await f.cleanup() }
})

test('member progress uses stable bounded pages and group removal cascades only shared rows', async ({ page }) => {
  test.setTimeout(90000)
  const f = await studyFixture()
  const seeded = Array.from({ length: 23 }, () => randomUUID())
  try {
    const { id, source } = await publish(f)
    dataOf(await change(f, f.owner, 'reading_goal', { id, revision: 0, targetPage: 100, requestId: randomUUID() }))
    // Local rows only: these identities have no credentials or sessions. Exercise
    // the real membership FKs, RLS and 20-row cursor without issuing 23 signups.
    f.sql('insert into auth.users(id) values ' + seeded.map(uid => "('" + uid + "')").join(','))
    f.sql('insert into public.profiles(user_id,name) values ' + seeded.map((uid, i) => "('" + uid + "','독서 멤버 " + (i + 1) + "')").join(','))
    f.sql('insert into public.group_members(group_id,user_id,role) values ' + seeded.map(uid => "('" + f.groupId + "','" + uid + "','member')").join(','))
    f.sql('insert into public.group_reading_progress(book_id,group_id,user_id,current_page,last_request_id) values ' + seeded.map((uid, i) => "('" + id + "','" + f.groupId + "','" + uid + "'," + i * 5 + ",gen_random_uuid())").join(','))
    const first = dataOf(await f.owner.rpc('onmode_reading_members', { group_id: f.groupId, book_id: id })) as ReadingMember[]
    expect(first).toHaveLength(21)
    const second = dataOf(await f.owner.rpc('onmode_reading_members', { group_id: f.groupId, book_id: id, cursor_user: first[19].userId })) as ReadingMember[]
    expect(second).toHaveLength(3)
    expect([...first.slice(0, 20), ...second].map(m => m.userId)).toEqual([...seeded].sort())
    expect((await load(f)).reading).toMatchObject({ participants: 23, achieved: 3 })
    await f.login(page, 0)
    const card = page.getByRole('region', { name: '공동 도서관', exact: true }).getByRole('article', { name: source.name, exact: true })
    await card.getByText('멤버별 공유 진도', { exact: true }).click()
    await expect(card.locator('.reading-members li')).toHaveCount(20)
    await card.getByRole('button', { name: '공유 진도 더 보기' }).click()
    await expect(card.locator('.reading-members li')).toHaveCount(23)
    f.sql("delete from public.study_groups where id = '" + f.groupId + "'")
    expect(f.sql("select count(*) from public.group_reading_progress where group_id = '" + f.groupId + "'")).toBe('0')
    expect((dataOf(await f.owner.rpc('onmode_snapshot')) as View).snapshot.activities).toEqual([source])
  } finally {
    try { await f.cleanup() }
    finally { f.sql('delete from auth.users where id in (' + seeded.map(uid => "'" + uid + "'").join(',') + ')') }
  }
})
