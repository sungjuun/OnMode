import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { StudySeason } from '../../src/data/studySeasons'
import { dataOf, studyFixture } from '../support/studyFixture'

type Fixture = Awaited<ReturnType<typeof studyFixture>>
const read = (f: Fixture, app = f.owner, month?: string) =>
  app.rpc('onmode_study_season', { group_id: f.groupId, month_start: month ?? null })
const season = async (f: Fixture, app = f.owner, month?: string) => dataOf(await read(f, app, month)) as StudySeason

test('monthly goals and standings update live and members can browse past seasons', async ({ page, browser }) => {
  test.setTimeout(90000)
  const f = await studyFixture()
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true, timezoneId: 'America/Los_Angeles',
  })
  try {
    dataOf(await f.owner.rpc('onmode_command', { command: { type: 'profile', value: { name: '시즌 집중러', goalMinutes: 120, notifications: false } } }))
    const initial = await season(f)
    expect(initial).toMatchObject({ totalSeconds: 0, sessions: 0, contributors: 0, ranking: [], mine: null })
    await f.login(page, 0)
    const member = await mobile.newPage()
    await f.login(member, 1)
    const ownerPanel = page.getByRole('region', { name: '스터디 시즌' })
    const panel = member.getByRole('region', { name: '스터디 시즌' })
    await expect(panel.getByRole('progressbar', { name: '1시간 시즌 목표 진행률' })).toHaveAttribute('aria-valuenow', '0')
    const id = randomUUID()
    dataOf(await f.owner.rpc('onmode_command', { command: { type: 'start', value: { id, method: 'flow', activityId: null, targetSeconds: null, restSeconds: 0 } } }))
    f.sql("update public.focus_sessions set active_since = active_since - interval '3601 seconds' where id = '" + id + "'")
    const command = { type: 'finish', id, seconds: 43200, xp: 99999, coins: 99999 }
    dataOf(await f.owner.rpc('onmode_command', { command }))
    const result = await season(f)
    expect(result.totalSeconds).toBeGreaterThanOrEqual(3600)
    expect(result.totalSeconds).toBeLessThan(3700)
    expect(result).toMatchObject({ month: initial.month, sessions: 1, contributors: 1, mine: { rank: 1, sessions: 1, seconds: result.totalSeconds } })
    dataOf(await f.owner.rpc('onmode_command', { command }))
    expect(await season(f)).toEqual(result)
    expect(dataOf(await f.owner.from('reward_transactions').select('coins,xp'))).toEqual([{ coins: 60, xp: 300 }])
    await expect(panel.getByText('1시간 달성', { exact: true })).toBeVisible()
    await expect(panel.getByRole('progressbar', { name: '10시간 시즌 목표 진행률' })).toHaveAttribute('aria-valuenow', '10')
    await expect(ownerPanel.getByText(/내 시즌 기록 · 1위/)).toBeVisible()
    await expect(panel.getByText('이 시즌에 내가 기여한 집중 기록이 없어요.')).toBeVisible()
    await panel.getByText('시즌 순위 · 현재 멤버 상위 20명').click()
    await expect(panel.getByRole('list', { name: '시즌 집중 순위' }).getByText('시즌 집중러', { exact: true })).toBeVisible()
    expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await panel.screenshot({ path: test.info().outputPath('study-season-mobile-dark.png'), scale: 'css' })
    const picker = panel.getByLabel('시즌 선택')
    await expect(picker.locator('option')).toHaveCount(12)
    await picker.selectOption(initial.months[1])
    await expect(panel.getByText('시즌 종료', { exact: true })).toBeVisible()
    await expect(panel.getByText('1시간 목표', { exact: true })).toBeVisible()
    await expect(panel.getByText('시즌 집중러', { exact: true })).toHaveCount(0)
    await picker.selectOption('')
    await expect(panel.getByText('1시간 달성', { exact: true })).toBeVisible()
  } finally { await mobile.close(); await f.cleanup() }
})

test('season windows use Seoul midnight, verify source records, and keep ranking member-only', async () => {
  const f = await studyFixture()
  try {
    for (const app of [f.anon, f.outsider]) expect((await read(f, app)).error?.code).toBe('42501')
    const initial = await season(f)
    const [month, previous] = initial.months
    expect(initial.months).toHaveLength(12)
    const [future, tooOld] = f.sql("select (date '" + month + "' + interval '1 month')::date,(date '" + month + "' - interval '12 months')::date").split('|')
    for (const invalid of [future, tooOld, month.slice(0, -2) + '02']) {
      expect((await read(f, f.member, invalid)).error?.code).toBe('22023')
    }
    const ownerId = (await f.owner.auth.getUser()).data.user!.id
    const memberId = (await f.member.auth.getUser()).data.user!.id
    const boundary = "'" + month + " 00:00:00+09'::timestamptz"
    // Seed exact server timestamps, including a session that starts in the previous season.
    f.sql(`with source as materialized (
      select gen_random_uuid() as id,* from (values
        ('${ownerId}'::uuid,${boundary} - interval '1 microsecond',90,90),
        ('${ownerId}'::uuid,${boundary},120,120),
        ('${memberId}'::uuid,${boundary},120,120),
        ('${memberId}'::uuid,${boundary},59,59),
        ('${memberId}'::uuid,${boundary},120,121),
        ('${ownerId}'::uuid,${boundary},400,null),
        ('${ownerId}'::uuid,clock_timestamp() + interval '2 minutes',300,300)
      ) v(user_id,ended_at,seconds,group_seconds)
    ), completed as (
      insert into public.focus_sessions(id,user_id,method,target_seconds,rest_seconds,started_at,active_since,elapsed_ms,ended_at,seconds)
      select id,user_id,'flow',null,0,ended_at - seconds * interval '1 second',null,seconds * 1000,ended_at,seconds from source
      returning id,ended_at
    )
    insert into public.group_contributions(group_id,session_id,ended_at,seconds)
    select '${f.groupId}',c.id,c.ended_at,s.group_seconds from completed c join source s using(id) where s.group_seconds is not null`)
    expect(await season(f, f.member, previous)).toMatchObject({ month: previous, totalSeconds: 90, sessions: 1, contributors: 1, mine: null })
    const current = await season(f, f.member)
    expect(current).toMatchObject({ month, totalSeconds: 240, sessions: 2, contributors: 2, mine: { rank: 1, seconds: 120, sessions: 1 } })
    expect(current.ranking.map(row => [row.id, row.rank])).toEqual([[ownerId, 1], [memberId, 1]])
    expect(await season(f, f.owner, initial.months.at(-1))).toMatchObject({ totalSeconds: 0, sessions: 0, contributors: 0 })
    expect((await f.member.from('group_contributions').select('seconds')).error?.code).toBe('42501')
    expect((await f.member.from('group_contributions').update({ seconds: 43200 }).eq('group_id', f.groupId)).error?.code).toBe('42501')
    dataOf(await f.member.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await read(f, f.member)).error?.code).toBe('42501')
    expect(await season(f)).toMatchObject({ totalSeconds: 240, contributors: 2, ranking: [{ id: ownerId, rank: 1 }] })
  } finally { await f.cleanup() }
})
