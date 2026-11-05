import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { GroupAchievement } from '../../src/data/groupAchievements'
import type { View } from '../../src/domain/model'
import { dataOf, studyFixture } from '../support/studyFixture'

type Fixture = Awaited<ReturnType<typeof studyFixture>>
const list = async (f: Fixture, app = f.owner, groupId = f.groupId) => dataOf(await app.rpc('onmode_group_achievements', { group_id: groupId })) as GroupAchievement[]
async function start(f: Fixture, app: Fixture['owner'], seconds: number) {
  const id = randomUUID()
  dataOf(await app.rpc('onmode_command', { command: { type: 'start', value: { id, method: 'flow', activityId: null, targetSeconds: null, restSeconds: 0 } } }))
  // Local clock fixture only. Public commands never receive time or reward values.
  f.sql("update public.focus_sessions set active_since = active_since - interval '" + seconds + " seconds' where id = '" + id + "'")
  return id
}
async function complete(f: Fixture, app: Fixture['owner'], seconds = 65) {
  const id = await start(f, app, seconds)
  const command = { type: 'finish', id }
  dataOf(await app.rpc('onmode_command', { command }))
  dataOf(await app.rpc('onmode_command', { command }))
  return id
}
function seedCompleted(f: Fixture, userId: string, groups: string[], count: number, seconds: number) {
  f.sql("with completed as (insert into public.focus_sessions(id,user_id,method,target_seconds,rest_seconds,started_at,active_since,elapsed_ms,ended_at,seconds) " +
    "select gen_random_uuid(),'" + userId + "','flow',null,0,clock_timestamp() - " + seconds + " * interval '1 second',null," + seconds * 1000 + ",clock_timestamp()," + seconds + " from generate_series(1," + count + ") returning id,ended_at,seconds) " +
    'insert into public.group_contributions(group_id,session_id,ended_at,seconds) select g.id,c.id,c.ended_at,c.seconds from completed c cross join (values ' + groups.map(id => "('" + id + "'::uuid)").join(',') + ') g(id)')
}

test('members see permanent group trophies live with verified progress and no extra rewards', async ({ page, browser }) => {
  test.setTimeout(90000)
  const f = await studyFixture()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  try {
    const initial = await list(f)
    expect(initial).toHaveLength(6)
    expect(initial.every(a => a.value === 0 && a.earnedAt === null)).toBe(true)
    await f.login(page, 0)
    const member = await context.newPage()
    await f.login(member, 1)
    const ownerView = page.getByRole('region', { name: '그룹 업적', exact: true })
    const memberView = member.getByRole('region', { name: '그룹 업적', exact: true })
    await expect(memberView.getByText('달성 0/6', { exact: true })).toBeVisible()
    const id = await complete(f, f.owner)
    await expect(memberView.getByRole('article', { name: '함께하는 첫 집중', exact: true }).getByText('달성 완료', { exact: true })).toBeVisible()
    await expect(ownerView.getByText('달성 1/6', { exact: true })).toBeVisible()
    const first = (await list(f)).find(a => a.id === 'first_focus')!
    expect(first.earnedAt).not.toBeNull()
    expect(first.value).toBe(1)
    dataOf(await f.owner.rpc('onmode_command', { command: { type: 'finish', id, seconds: 99999, coins: 99999 } }))
    expect((await list(f)).find(a => a.id === 'first_focus')).toEqual(first)
    await complete(f, f.member)
    const code = dataOf(await f.owner.rpc('onmode_groups')).find((g: { id: string }) => g.id === f.groupId).inviteCode
    dataOf(await f.outsider.rpc('onmode_group_change', { action: 'invite', payload: { code } }))
    await complete(f, f.outsider)
    await expect(memberView.getByRole('article', { name: '함께하는 세 사람', exact: true }).getByText('달성 완료', { exact: true })).toBeVisible()
    await expect(memberView.getByText('달성 2/6', { exact: true })).toBeVisible()
    expect((await list(f)).find(a => a.id === 'three_contributors')?.value).toBe(3)
    for (const app of [f.owner, f.member, f.outsider]) expect(dataOf(await app.from('reward_transactions').select('coins,xp'))).toEqual([{ coins: 1, xp: 5 }])
    expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await memberView.getByRole('article', { name: '함께하는 첫 집중', exact: true }).screenshot({ path: test.info().outputPath('group-achievement-mobile-dark.png'), scale: 'css' })
    await ownerView.screenshot({ path: test.info().outputPath('group-achievements-desktop.png'), scale: 'css' })
    await member.reload()
    await member.getByRole('article').filter({ has: member.getByRole('heading', { name: '온모드 집중 스터디', exact: true }) }).getByRole('button', { name: '보기' }).click()
    await expect(memberView.getByText('달성 2/6', { exact: true })).toBeVisible()
    dataOf(await f.owner.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await f.owner.rpc('onmode_group_achievements', { group_id: f.groupId })).error?.code).toBe('42501')
    expect((await list(f, f.member)).find(a => a.id === 'first_focus')?.earnedAt).toBe(first.earnedAt)
  } finally { await context.close(); await f.cleanup() }
})

test('thresholds, simultaneous completions in overlapping groups, and readonly authorization stay atomic', async () => {
  test.setTimeout(120000)
  const f = await studyFixture()
  let otherGroup: string | undefined
  try {
    for (const app of [f.outsider, f.anon]) expect((await app.rpc('onmode_group_achievements', { group_id: f.groupId })).error?.code).toBe('42501')
    expect(dataOf(await f.outsider.from('group_achievements').select('achievement_id'))).toEqual([])
    expect((await f.owner.from('group_achievements').insert({ group_id: f.groupId, achievement_id: 'focus_ten_hours' })).error?.code).toBe('42501')
    await complete(f, f.owner, 45)
    const forged = await start(f, f.owner, 0)
    dataOf(await f.owner.rpc('onmode_command', { command: { type: 'finish', id: forged, seconds: 43200, xp: 99999, coins: 99999 } }))
    expect((await list(f)).every(a => a.earnedAt === null && a.value === 0)).toBe(true)
    // Create the second membership in the opposite user order, then complete
    // concurrently in both shared groups to exercise the common lock ordering.
    otherGroup = dataOf(await f.member.rpc('onmode_group_change', { action: 'create', payload: { name: '동시 완료 검증', description: '', isPublic: false, goalMinutes: 60 } })) as string
    const code = dataOf(await f.member.rpc('onmode_groups')).find((g: { id: string }) => g.id === otherGroup).inviteCode
    dataOf(await f.owner.rpc('onmode_group_change', { action: 'invite', payload: { code } }))
    const ownerId = (await f.owner.auth.getUser()).data.user!.id
    const groupIds = [f.groupId!, otherGroup]
    seedCompleted(f, ownerId, groupIds, 1, 3470)
    const [ownerFocus, memberFocus] = await Promise.all([start(f, f.owner, 65), start(f, f.member, 65)])
    const realSessions: string[] = [ownerFocus]
    const attempts = await Promise.all([f.owner, f.member].flatMap((app, i) => Array.from({ length: 3 }, () => app.rpc('onmode_command', { command: { type: 'finish', id: i === 0 ? ownerFocus : memberFocus } }))))
    expect(attempts.every(r => !r.error)).toBe(true)
    for (const gid of groupIds) {
      const achievements = await list(f, f.owner, gid)
      expect(achievements.find(a => a.id === 'focus_hour')?.earnedAt).not.toBeNull()
      expect(achievements.find(a => a.id === 'first_focus')?.value).toBe(3)
      expect(f.sql("select count(*) from public.group_achievements where group_id = '" + gid + "' and achievement_id = 'focus_hour'")).toBe('1')
    }
    const firstAwards = (await list(f)).filter(a => a.earnedAt).map(a => [a.id, a.earnedAt])
    seedCompleted(f, ownerId, groupIds, 6, 60)
    realSessions.push(await complete(f, f.owner))
    expect((await list(f)).find(a => a.id === 'ten_sessions')).toMatchObject({ value: 10 })
    expect((await list(f)).find(a => a.id === 'ten_sessions')?.earnedAt).not.toBeNull()
    expect((await list(f)).find(a => a.id === 'hundred_sessions')?.earnedAt).toBeNull()
    seedCompleted(f, ownerId, groupIds, 89, 60)
    realSessions.push(await complete(f, f.owner))
    expect((await list(f)).find(a => a.id === 'hundred_sessions')).toMatchObject({ value: 100 })
    expect((await list(f)).find(a => a.id === 'hundred_sessions')?.earnedAt).not.toBeNull()
    const seconds = (await list(f)).find(a => a.id === 'focus_ten_hours')!.value
    expect(seconds).toBeLessThan(36000)
    realSessions.push(await complete(f, f.owner, 36001 - seconds))
    expect((await list(f)).find(a => a.id === 'focus_ten_hours')?.earnedAt).not.toBeNull()
    expect((await list(f)).filter(a => a.earnedAt)).toHaveLength(5)
    for (const [id, at] of firstAwards) expect((await list(f)).find(a => a.id === id)?.earnedAt).toBe(at)
    const view = dataOf(await f.owner.rpc('onmode_snapshot')) as View
    const earned = view.snapshot.records.filter(r => realSessions.includes(r.id)).reduce((total, r) => total + Math.floor(r.seconds / 60), 0)
    expect(dataOf(await f.owner.from('reward_transactions').select('coins,xp')).reduce((total: number, r: { coins: number }) => total + r.coins, 0)).toBe(earned)
    expect((await f.owner.from('group_achievements').update({ earned_at: '2000-01-01T00:00:00Z' }).eq('group_id', f.groupId)).error?.code).toBe('42501')
    expect((await f.member.from('group_achievements').delete().eq('group_id', f.groupId)).error?.code).toBe('42501')
    f.sql("delete from public.study_groups where id = '" + otherGroup + "'")
    expect(f.sql("select count(*) from public.group_achievements where group_id = '" + otherGroup + "'")).toBe('0')
  } finally { if (otherGroup) f.sql("delete from public.study_groups where id = '" + otherGroup + "'"); await f.cleanup() }
})
