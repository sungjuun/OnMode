import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { ReadingChallenge } from '../../src/data/readingChallenges'
import type { Activity, View } from '../../src/domain/model'
import { dataOf, studyFixture } from '../support/studyFixture'

type Fixture = Awaited<ReturnType<typeof studyFixture>>
const bookName = '기간을 정해 함께 읽는 책'

async function publish(f: Fixture) {
  const source: Activity = { id: randomUUID(), kind: 'book', name: bookName, author: '온모드 저자', pages: 200, currentPage: 87, goalPages: 10 }
  const bookId = randomUUID()
  dataOf(await f.owner.rpc('onmode_command', { command: { type: 'activity', value: source } }))
  dataOf(await f.owner.rpc('onmode_library_change', { group_id: f.groupId, action: 'create', payload: { id: bookId, activityId: source.id } }))
  return { source, bookId }
}

const write = (f: Fixture, app: Fixture['owner'], action: string, payload: Record<string, unknown>) =>
  app.rpc('onmode_reading_challenge_change', { group_id: f.groupId, action, payload })
const read = (f: Fixture, app = f.owner, cursor?: ReadingChallenge) =>
  app.rpc('onmode_reading_challenges', { group_id: f.groupId, cursor_at: cursor?.createdAt ?? null, cursor_id: cursor?.id ?? null })
const cards = async (f: Fixture, app = f.owner) => dataOf(await read(f, app)) as ReadingChallenge[]
const progress = (challenge: ReadingChallenge, page: number | null) => ({
  id: challenge.id, membershipSince: challenge.membershipSince, revision: challenge.myRevision, requestId: randomUUID(), page,
})

test('members see reading challenge results live without exposing individual pages', async ({ page, browser }) => {
  test.setTimeout(90000)
  const f = await studyFixture()
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' })
  try {
    const { bookId, source } = await publish(f)
    dataOf(await f.owner.rpc('onmode_library_change', {
      group_id: f.groupId, action: 'reading_goal', payload: { id: bookId, revision: 0, requestId: randomUUID(), targetPage: 100 },
    }))
    await f.login(page, 0)
    const member = await mobile.newPage()
    await f.login(member, 1)
    const ownerPanel = page.getByRole('region', { name: '기간별 독서 도전' })
    const memberPanel = member.getByRole('region', { name: '기간별 독서 도전' })
    await expect(memberPanel.getByRole('button', { name: '독서 도전 만들기' })).toHaveCount(0)
    await ownerPanel.getByRole('button', { name: '독서 도전 만들기' }).click()
    const create = page.getByRole('dialog', { name: '독서 도전 만들기' })
    await expect(create.getByLabel('도전에 사용할 공동 도서')).toHaveValue(bookId)
    await create.getByLabel('도전 목표 페이지').fill('100')
    const start = await create.getByLabel('시작일').inputValue()
    await create.getByLabel('종료일').fill(start)
    await create.getByRole('button', { name: '만들기', exact: true }).click()
    await expect(memberPanel.getByText('진행 중', { exact: true })).toBeVisible()
    await expect(memberPanel.getByText(/0명 참여 · 0명 달성/)).toBeVisible()
    await memberPanel.getByRole('button', { name: '도전 진도 기록' }).click()
    const dialog = member.getByRole('dialog', { name: '도전 진도 기록' })
    const input = dialog.getByLabel('도전에 기록할 현재 페이지')
    await expect(input).toHaveValue('0')
    await input.fill('110')
    const sent: unknown[] = []
    await member.route('**/rest/v1/rpc/onmode_reading_challenge_change', async route => {
      sent.push(route.request().postDataJSON())
      if (sent.length === 1) { await route.fetch(); await route.abort(); return }
      await route.continue()
    })
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText(/연결하지 못했어요/)
    await expect(input).toHaveValue('110')
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect(sent).toHaveLength(2)
    expect(sent[0]).toEqual(sent[1])
    await expect(memberPanel.getByText('내 도전 진도 110쪽 / 100쪽 · 달성', { exact: true })).toBeVisible()
    await expect(ownerPanel.getByText(/1명 참여 · 1명 달성/)).toBeVisible()
    await expect(ownerPanel.getByText(/110쪽/)).toHaveCount(0)
    expect(await cards(f)).toMatchObject([{ participants: 1, achieved: 1, myPage: null }])
    expect(await cards(f, f.member)).toMatchObject([{ myPage: 110, myRevision: 1 }])
    expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await memberPanel.screenshot({ path: test.info().outputPath('reading-challenge-mobile-dark.png'), scale: 'css' })
    await member.reload()
    await member.getByRole('article').filter({ has: member.getByRole('heading', { name: '온모드 집중 스터디', exact: true }) }).getByRole('button', { name: '보기' }).click()
    await expect(memberPanel.getByText('내 도전 진도 110쪽 / 100쪽 · 달성', { exact: true })).toBeVisible()
    await ownerPanel.getByRole('button', { name: '독서 도전 취소' }).click()
    await page.getByRole('dialog', { name: '독서 도전 취소' }).getByRole('button', { name: '취소 확정' }).click()
    await expect(memberPanel.getByText('취소됨', { exact: true })).toBeVisible()
    await expect(memberPanel.getByText(/1명 참여 · 1명 달성/)).toBeVisible()
    await expect(memberPanel.getByRole('button', { name: '도전 진도 수정' })).toHaveCount(0)
    await memberPanel.getByRole('button', { name: '도전 진도 삭제' }).click()
    await member.getByRole('dialog', { name: '도전 진도 삭제' }).getByRole('button', { name: '삭제 확정' }).click()
    await expect(ownerPanel.getByText(/0명 참여 · 0명 달성/)).toBeVisible()
    expect((dataOf(await f.owner.rpc('onmode_snapshot')) as View).snapshot.activities).toEqual([source])
    expect((dataOf(await f.member.rpc('onmode_snapshot')) as View).snapshot.activities).toEqual([])
    expect(dataOf(await f.member.from('reward_transactions').select('coins'))).toEqual([])
    expect(f.sql("select count(*) from public.group_reading_progress where book_id = '" + bookId + "'")).toBe('0')
  } finally { await mobile.close(); await f.cleanup() }
})

test('server enforces dates, group authority, conflict checks and membership lifetime', async () => {
  test.setTimeout(90000)
  const f = await studyFixture()
  try {
    const { bookId } = await publish(f)
    const timeZone = 'Asia/Seoul'
    const [yesterday, today, tomorrow, later] = f.sql("select d-1,d,d+1,d+90 from (select (now() at time zone 'Asia/Seoul')::date d) t").split('|')
    const active = { id: randomUUID(), bookId, targetPage: 100, startDate: today, endDate: today, timeZone }
    const scheduled = { ...active, id: randomUUID(), startDate: tomorrow, endDate: tomorrow }
    for (const app of [f.anon, f.outsider]) {
      expect((await read(f, app)).error?.code).toBe('42501')
      expect((await write(f, app, 'create', active)).error?.code).toBe('42501')
    }
    expect((await write(f, f.member, 'create', active)).error?.code).toBe('42501')
    for (const fields of [{ startDate: yesterday }, { endDate: later }, { endDate: yesterday }, { timeZone: 'invalid/zone' },
      { targetPage: 0 }, { targetPage: 201 }, { targetPage: '100' }, { bookId: randomUUID() }]) {
      expect((await write(f, f.owner, 'create', { ...active, ...fields })).error?.code).toBe('22023')
    }
    dataOf(await write(f, f.owner, 'create', active))
    const version = () => f.sql("select version from public.group_updates where group_id = '" + f.groupId + "'")
    const createdVersion = version()
    dataOf(await write(f, f.owner, 'create', active))
    expect(version()).toBe(createdVersion)
    expect((await write(f, f.owner, 'create', { ...active, targetPage: 150 })).error?.code).toBe('40001')
    expect((await write(f, f.owner, 'create', { ...active, id: randomUUID() })).error?.code).toBe('22023')
    dataOf(await write(f, f.owner, 'create', scheduled))
    const [future, current] = await cards(f, f.member)
    expect(future.status).toBe('scheduled')
    expect(current.status).toBe('active')
    expect((await write(f, f.member, 'progress', progress(future, 110))).error?.code).toBe('22023')
    expect((await write(f, f.member, 'cancel', { id: active.id })).error?.code).toBe('42501')
    expect((await write(f, f.member, 'progress', progress(current, 201))).error?.code).toBe('22023')
    const forged = { ...progress(current, 110), userId: (await f.owner.auth.getUser()).data.user!.id }
    expect((await write(f, f.outsider, 'progress', forged)).error?.code).toBe('42501')
    const requests = [forged, progress(current, 120)]
    const results = await Promise.all(requests.map(payload => write(f, f.member, 'progress', payload)))
    expect(results.filter(result => !result.error)).toHaveLength(1)
    expect(results.find(result => result.error)?.error?.code).toBe('40001')
    const winner = requests[results.findIndex(result => !result.error)]
    expect((await cards(f)).find(item => item.id === active.id)).toMatchObject({ participants: 1, achieved: 1, myPage: null })
    expect((await cards(f, f.member)).find(item => item.id === active.id)).toMatchObject({ myPage: winner.page, myRevision: 1 })
    const publishedVersion = version()
    dataOf(await write(f, f.member, 'progress', winner))
    expect(version()).toBe(publishedVersion)
    expect((await write(f, f.member, 'progress', { ...winner, page: 50 })).error?.code).toBe('22023')
    dataOf(await f.member.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await read(f, f.member)).error?.code).toBe('42501')
    expect((await cards(f)).find(item => item.id === active.id)).toMatchObject({ participants: 0, achieved: 0 })
    const { inviteCode } = dataOf(await f.owner.rpc('onmode_groups')).find((group: { id: string }) => group.id === f.groupId)
    dataOf(await f.member.rpc('onmode_group_change', { action: 'invite', payload: { code: inviteCode } }))
    expect((await write(f, f.member, 'progress', winner)).error?.code).toBe('40001')
    const fresh = (await cards(f, f.member)).find(item => item.id === active.id)!
    const finalRecord = progress(fresh, 100)
    dataOf(await write(f, f.member, 'progress', finalRecord))
    // Move the window into the past to exercise expiry without waiting for midnight.
    f.sql("update onmode_private.reading_challenges set starts_at = now() - interval '1 day', ends_at = now() - interval '1 millisecond' where id = '" + active.id + "'")
    const ended = (await cards(f, f.member)).find(item => item.id === active.id)!
    expect(ended).toMatchObject({ status: 'ended', myPage: 100, participants: 1, achieved: 1 })
    dataOf(await write(f, f.member, 'progress', finalRecord))
    expect((await write(f, f.member, 'progress', progress(ended, 80))).error?.code).toBe('22023')
    expect((await write(f, f.owner, 'cancel', { id: active.id })).error?.code).toBe('22023')
    dataOf(await write(f, f.member, 'progress', progress(ended, null)))
    expect((await cards(f)).find(item => item.id === active.id)).toMatchObject({ status: 'ended', participants: 0, achieved: 0 })
    expect((await write(f, f.member, 'progress', finalRecord)).error?.code).toBe('40001')
    const count = () => f.sql("select count(*) from onmode_private.reading_challenges where group_id = '" + f.groupId + "'")
    expect(count()).toBe('2')
    dataOf(await f.owner.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await read(f)).error?.code).toBe('42501')
    dataOf(await write(f, f.member, 'cancel', { id: scheduled.id }))
    expect((await cards(f, f.member))[0].status).toBe('cancelled')
    dataOf(await f.member.rpc('onmode_library_change', { group_id: f.groupId, action: 'delete', payload: { id: bookId } }))
    expect(count()).toBe('0')
    expect(await cards(f, f.member)).toEqual([])
  } finally { await f.cleanup() }
})
