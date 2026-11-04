import { execFileSync, execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'
import type { Challenge, NewChallenge } from '../../src/data/challenges'

test.use({ timezoneId: 'Asia/Seoul' })
const zone = 'Asia/Seoul'
const date = (days = 0) => {
  const now = new Date(Date.now() + days * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
async function fixture() {
  const stack = JSON.parse(execSync('npx --yes supabase@3.0.0 status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  if (stack.API_URL !== 'http://127.0.0.1:56321') throw Error('Expected the isolated ONMODE stack.')
  const make = () => createClient(stack.API_URL, stack.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const clients = [make(), make(), make(), make()]
  const [owner, member, outsider, anon] = clients
  const emails = Array.from({ length: 3 }, () => 'onmode-' + randomUUID() + '@example.com')
  const password = 'LocalOnly!' + randomUUID()
  const groupName = '온모드 집중 스터디'
  const sql = (statement: string) => execFileSync('docker', ['exec', 'supabase_db_onmode', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', statement], { encoding: 'utf8' }).trim()
  const dataOf = <T,>(result: { data: T | null; error: { code?: string } | null }): T => {
    if (result.error || result.data === null) throw Error('Local fixture operation failed: ' + (result.error?.code ?? 'missing data'))
    return result.data
  }
  let gid: string | undefined
  async function cleanup() {
    if (gid) sql("delete from public.study_groups where id = '" + gid + "'")
    sql("delete from auth.users where email in (" + emails.map(email => "'" + email + "'").join(',') + ")")
    await Promise.all(clients.map(client => client.auth.dispose()))
  }
  try {
    for (let i = 0; i < 3; i++) dataOf(await clients[i].auth.signUp({ email: emails[i], password }))
    gid = dataOf(await owner.rpc('onmode_group_change', { action: 'create', payload: { name: groupName, description: '', isPublic: false, goalMinutes: 600 } })) as string
    const code = dataOf(await owner.rpc('onmode_groups')).find((g: { id: string }) => g.id === gid).inviteCode
    dataOf(await member.rpc('onmode_group_change', { action: 'invite', payload: { code } }))
    const groupId = gid
    const list = async () => dataOf(await owner.rpc('onmode_challenges', { group_id: groupId })) as Challenge[]
    const create = async (value: NewChallenge) => dataOf(await owner.rpc('onmode_challenge_change', { group_id: groupId, action: 'create', payload: value }))
    const focus = async (beforeFinish?: (id: string) => void) => {
      const id = randomUUID()
      dataOf(await owner.rpc('onmode_command', { command: { type: 'start', value: { id, method: 'flow', activityId: null, targetSeconds: null, restSeconds: 0 } } }))
      sql("update public.focus_sessions set active_since = active_since - interval '65 seconds' where id = '" + id + "'")
      beforeFinish?.(id)
      const command = { type: 'finish', id }
      dataOf(await owner.rpc('onmode_command', { command }))
      dataOf(await owner.rpc('onmode_command', { command }))
      return id
    }
    const login = async (page: Page, index: number) => {
      await page.goto('/account')
      await page.getByLabel('이메일', { exact: true }).fill(emails[index])
      await page.getByLabel('비밀번호', { exact: true }).fill(password)
      await page.getByRole('button', { name: '로그인', exact: true }).last().click()
      await page.getByRole('heading', { name: '계정 연결됨' }).waitFor()
      await page.goto('/study')
      await page.getByRole('article').filter({ has: page.getByRole('heading', { name: groupName }) }).getByRole('button', { name: '보기' }).click()
      await page.getByText('실시간 연결', { exact: true }).waitFor()
    }
    return { owner, member, outsider, anon, groupId, sql, dataOf, list, create, focus, login, cleanup }
  } catch (error) { await cleanup(); throw error }
}

test('group owners create and cancel challenges; members see verified progress live', async ({ page, browser }) => {
  const f = await fixture()
  const other = await browser.newContext({ timezoneId: zone, viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  try {
    await f.focus()
    await f.login(page, 0)
    await page.getByRole('button', { name: '챌린지 만들기' }).click()
    const dialog = page.getByRole('dialog', { name: '챌린지 만들기' })
    const title = '함께 집중 1분'
    await dialog.getByLabel('챌린지 이름').fill(title)
    await dialog.getByLabel('공동 집중 목표 (분)').fill('1')
    await dialog.getByLabel('종료일').fill(date())
    await dialog.getByRole('button', { name: '만들기', exact: true }).click()
    const card = page.getByRole('article', { name: title, exact: true })
    await expect(card.getByText('진행 중', { exact: true })).toBeVisible()
    const challenge = (await f.list())[0]
    expect(challenge.totalSeconds).toBe(0)
    const payload = { id: challenge.id, title, targetMinutes: 1, startDate: date(), endDate: date(), timeZone: zone }
    await Promise.all([f.create(payload), f.create(payload)])
    expect(await f.list()).toHaveLength(1)
    expect((await f.member.rpc('onmode_challenge_change', { group_id: f.groupId, action: 'create', payload: { ...payload, id: randomUUID() } })).error?.code).toBe('42501')
    expect((await f.member.rpc('onmode_challenge_change', { group_id: f.groupId, action: 'cancel', payload: { id: challenge.id } })).error?.code).toBe('42501')
    expect((await f.outsider.rpc('onmode_challenges', { group_id: f.groupId })).error?.code).toBe('42501')
    expect((await f.anon.rpc('onmode_challenges', { group_id: f.groupId })).error?.code).toBe('42501')
    expect(f.dataOf(await f.outsider.from('study_challenges').select('id').eq('group_id', f.groupId))).toEqual([])
    expect((await f.owner.from('study_challenges').update({ target_minutes: 0 }).eq('id', challenge.id)).error?.code).toBe('42501')

    const memberPage = await other.newPage()
    await f.login(memberPage, 1)
    const memberCard = memberPage.getByRole('article', { name: title, exact: true })
    await expect(memberPage.getByRole('button', { name: '챌린지 만들기' })).toHaveCount(0)
    await expect(memberCard.getByRole('button', { name: '챌린지 취소' })).toHaveCount(0)
    const focusId = await f.focus()
    await expect(memberCard.getByText('목표 달성', { exact: true })).toBeVisible()
    await expect(memberCard.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    const achieved = (await f.list())[0]
    expect(achieved.totalSeconds).toBeGreaterThanOrEqual(65)
    expect(achieved.totalSeconds).toBeLessThan(70)
    expect(achieved.members.reduce((sum, m) => sum + m.seconds, 0)).toBe(achieved.totalSeconds)
    expect(f.sql("select count(*) from public.group_contributions where session_id = '" + focusId + "'")).toBe('1')
    await memberCard.getByText('멤버별 기여 시간', { exact: true }).click()
    expect(await memberPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await memberPage.screenshot({ path: test.info().outputPath('challenge-mobile-dark.png'), fullPage: true, scale: 'css' })
    await page.getByRole('article', { name: title, exact: true }).getByRole('button', { name: '챌린지 취소' }).click()
    await page.getByRole('dialog', { name: '챌린지 취소' }).getByRole('button', { name: '취소 확정' }).click()
    await expect(memberCard.getByText('취소됨', { exact: true })).toBeVisible()
    await f.focus()
    expect((await f.list())[0].totalSeconds).toBe(achieved.totalSeconds)
    expect(f.dataOf(await f.owner.from('reward_transactions').select('coins')).reduce((sum: number, row: { coins: number }) => sum + row.coins, 0)).toBe(3)
    f.dataOf(await f.owner.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await f.owner.rpc('onmode_challenges', { group_id: f.groupId })).error?.code).toBe('42501')
    f.dataOf(await f.member.rpc('onmode_challenge_change', { group_id: f.groupId, action: 'create', payload: { ...payload, id: randomUUID(), title: '새 그룹장의 챌린지' } }))
  } finally { await other.close(); await f.cleanup() }
})

test('challenge windows use the group timezone and exclude sessions outside their boundaries', async () => {
  const f = await fixture()
  try {
    const base = { title: '기간 검증', targetMinutes: 10, startDate: date(), endDate: date(), timeZone: zone }
    expect((await f.owner.rpc('onmode_challenge_change', { group_id: f.groupId, action: 'create', payload: { ...base, id: randomUUID(), startDate: date(-1) } })).error?.code).toBe('22023')
    expect((await f.owner.rpc('onmode_challenge_change', { group_id: f.groupId, action: 'create', payload: { ...base, id: randomUUID(), timeZone: 'invalid' } })).error?.code).toBe('22023')
    const id = randomUUID()
    await f.create({ ...base, id })
    const boundaries = f.sql("select to_char(starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') || '|' || to_char(ends_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') from public.study_challenges where id = '" + id + "'")
    const utc = (value: string) => new Date(value + 'T00:00:00+09:00').toISOString().slice(0, 19).replace('T', ' ')
    expect(boundaries).toBe(utc(date()) + '|' + utc(date(1)))
    const focusId = await f.focus()
    const total = (await f.list()).find(c => c.id === id)!.totalSeconds
    expect(total).toBeGreaterThanOrEqual(65)
    // Boundary fixtures stay in the disposable local database; clients cannot edit these times.
    f.sql("update public.study_challenges set ends_at = (select ended_at from public.focus_sessions where id = '" + focusId + "') where id = '" + id + "'")
    const ended = (await f.list()).find(c => c.id === id)!
    expect(ended).toMatchObject({ totalSeconds: 0, status: 'ended', canCancel: false })
    const upcomingId = randomUUID()
    await f.create({ ...base, id: upcomingId, startDate: date(1), endDate: date(1) })
    expect((await f.list()).find(c => c.id === upcomingId)).toMatchObject({ totalSeconds: 0, status: 'scheduled' })
  } finally { await f.cleanup() }
})
