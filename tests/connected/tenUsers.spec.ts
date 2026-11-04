import { randomUUID } from 'node:crypto'
import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test'
import type { View } from '../../src/domain/model'
import type { Group, Ranking } from '../../src/data/supabase'
import type { Challenge } from '../../src/data/challenges'
import type { ChatMessage } from '../../src/data/chat'
import type { Notice } from '../../src/data/notices'
import type { SharedBook } from '../../src/data/groupLibrary'
import type { RoomLayout } from '../../src/domain/room'
import { dataOf } from '../support/studyFixture'
import { tenUserFixture } from '../support/tenUserFixture'

test('ten independent accounts exercise study membership, live updates, rewards and shared resources', async ({ browser, baseURL }, info) => {
  test.setTimeout(240000)
  const f = await tenUserFixture()
  const contexts: BrowserContext[] = [], pages: Page[] = []
  const checks: string[] = []
  const owner = f.clients[0], last = f.clients[9]
  const ranking = (client = owner) => client.rpc('onmode_ranking', { group_id: f.privateId, zone: 'Asia/Seoul' })
  const snapshot = async (index: number) => (dataOf(await f.clients[index].rpc('onmode_snapshot')) as View).snapshot
  const groupChange = (index: number, action: string, payload: Record<string, unknown>) => f.clients[index].rpc('onmode_group_change', { action, payload })
  const library = async (index: number) => dataOf(await f.clients[index].rpc('onmode_library', { group_id: f.privateId })) as { room: RoomLayout; books: SharedBook[] }
  const date = (days = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86400000))
  const invite = async (page: Page) => {
    await page.getByRole('button', { name: '초대 코드', exact: true }).click()
    await page.getByLabel('초대 코드', { exact: true }).fill(f.inviteCode)
    await page.getByRole('button', { name: '참여하기', exact: true }).click()
    await expect(page.getByText('실시간 연결', { exact: true })).toBeVisible({ timeout: 20000 })
  }
  try {
    await test.step('create ten users and check non-member boundaries', async () => {
      expect(f.counts()).toEqual({ users: 10, groups: 2 })
      expect(new Set(f.userIds).size).toBe(10)
      const discovery = dataOf(await last.rpc('onmode_groups')) as Group[]
      expect(discovery.some(group => group.id === f.privateId)).toBe(false)
      expect(discovery.find(group => group.id === f.publicId)).toMatchObject({ isPublic: true, role: null })
      expect((await groupChange(9, 'join', { id: f.privateId })).error?.code).toBe('42501')
      for (const client of [last, f.anonymous]) {
        for (const rpc of ['onmode_notices', 'onmode_challenges', 'onmode_chat_messages', 'onmode_library']) expect((await client.rpc(rpc, { group_id: f.privateId })).error?.code).toBe('42501')
        expect((await ranking(client)).error?.code).toBe('42501')
      }
      checks.push('10 distinct users; public discovery and private non-member access control')
    })

    await test.step('join both groups and connect ten isolated browsers', async () => {
      // The first invited member is deterministic for the later ownership transfer.
      dataOf(await groupChange(1, 'invite', { code: f.inviteCode }))
      await Promise.all(f.clients.slice(2, 9).map(async client => dataOf(await client.rpc('onmode_group_change', { action: 'invite', payload: { code: f.inviteCode } }))))
      await Promise.all(f.clients.slice(1, 9).map(async client => dataOf(await client.rpc('onmode_group_change', { action: 'join', payload: { id: f.publicId } }))))
      const bookId = randomUUID()
      dataOf(await owner.rpc('onmode_command', { command: { type: 'activity', value: { id: bookId, kind: 'book', name: '열 명이 함께 읽는 책', author: '테스트 작가', pages: 200, currentPage: 70, goalPages: 10, isbn: '9780140328721' } } }))
      dataOf(await owner.rpc('onmode_command', { command: { type: 'journal', value: { id: randomUUID(), activityId: bookId, date: date(), text: '개인 서재에만 남기는 노트', amount: 70 } } }))
      for (let i = 0; i < 10; i++) {
        const context = await browser.newContext({ ...devices[i < 5 ? 'Desktop Chrome' : 'Pixel 7'], baseURL, timezoneId: 'Asia/Seoul', colorScheme: i < 5 ? 'light' : 'dark' })
        contexts.push(context); pages.push(await context.newPage())
      }
      await Promise.all(pages.map((page, index) => f.login(page, index)))
      const publicCard = pages[9].getByRole('article').filter({ has: pages[9].getByRole('heading', { name: f.publicName, exact: true }) })
      await pages[9].getByRole('button', { name: '공개 그룹', exact: true }).click()
      await publicCard.getByRole('button', { name: '가입', exact: true }).click()
      await expect(pages[9].getByRole('heading', { name: '멤버 랭킹', exact: true })).toBeVisible()
      await invite(pages[9])
      await Promise.all(pages.slice(0, 9).map(page => f.select(page)))
      await Promise.all(pages.map(page => expect(page.locator('ol.data-list>li')).toHaveCount(10, { timeout: 15000 })))
      for (let i = 0; i < 10; i++) {
        const groups = dataOf(await f.clients[i].rpc('onmode_groups')) as Group[]
        expect(groups.find(group => group.id === f.privateId)).toMatchObject({ members: 10, role: i === 0 ? 'owner' : 'member' })
        expect(groups.find(group => group.id === f.publicId)?.members).toBe(10)
        if (i !== 0) expect(groups.find(group => group.id === f.privateId)?.inviteCode).toBeUndefined()
      }
      await Promise.all(f.clients.map(async client => dataOf(await client.rpc('onmode_group_change', { action: 'invite', payload: { code: f.inviteCode } }))))
      expect((dataOf(await ranking()) as Ranking).members).toHaveLength(10)
      checks.push('10 browser sessions (5 desktop, 5 mobile); public/invite joins; membership retries')
    })

    const challengeId = randomUUID()
    const noticeTitle = '10인 동시 접속 공지'
    await test.step('broadcast notices and messages and enforce member permissions', async () => {
      dataOf(await owner.rpc('onmode_challenge_change', { group_id: f.privateId, action: 'create', payload: { id: challengeId, title: '열 명의 공동 집중', targetMinutes: 55, startDate: date(), endDate: date(1), timeZone: 'Asia/Seoul' } }))
      await pages[0].getByRole('button', { name: '공지 작성', exact: true }).click()
      const dialog = pages[0].getByRole('dialog', { name: '공지 작성', exact: true })
      await dialog.getByLabel('공지 제목').fill(noticeTitle)
      await dialog.getByLabel('공지 내용').fill('열 명의 독립 계정에서 함께 확인하는 공지입니다.')
      await dialog.getByRole('button', { name: '저장', exact: true }).click()
      await Promise.all(pages.map(page => expect(page.getByRole('article', { name: noticeTitle, exact: true })).toBeVisible({ timeout: 15000 })))
      const notice = (dataOf(await owner.rpc('onmode_notices', { group_id: f.privateId })) as Notice[])[0]
      await Promise.all(f.clients.slice(1).map(async client => {
        expect((await client.rpc('onmode_group_change', { action: 'goal', payload: { id: f.privateId, goalMinutes: 1 } })).error?.code).toBe('42501')
        expect((await client.rpc('onmode_notice_change', { group_id: f.privateId, action: 'edit', payload: { ...notice, body: 'unauthorized' } })).error?.code).toBe('42501')
        expect((await client.rpc('onmode_challenge_change', { group_id: f.privateId, action: 'cancel', payload: { id: challengeId } })).error?.code).toBe('42501')
      }))
      const messages = f.clients.map((_, i) => ({ id: randomUUID(), body: '10인 검증 메시지 ' + String(i + 1).padStart(2, '0') }))
      await Promise.all(f.clients.map(async (client, i) => {
        const request = { group_id: f.privateId, action: 'send', payload: messages[i] }
        dataOf(await client.rpc('onmode_chat_change', request)); dataOf(await client.rpc('onmode_chat_change', request))
      }))
      const saved = dataOf(await owner.rpc('onmode_chat_messages', { group_id: f.privateId })) as ChatMessage[]
      expect(saved).toHaveLength(10)
      expect(new Set(saved.map(message => message.senderId)).size).toBe(10)
      await Promise.all(pages.map(page => expect(page.getByRole('region', { name: '그룹 채팅', exact: true }).locator('[data-message-id]')).toHaveCount(10, { timeout: 15000 })))
      checks.push('notice visible in 10 browsers; 10 concurrent chat senders and duplicate retries; 9 member role denials')
    })

    let totalSeconds = 0
    await test.step('start, pause, resume and finish ten timers with server-calculated rewards', async () => {
      const sessions = f.clients.map(() => randomUUID())
      await Promise.all(f.clients.map(async (client, i) => dataOf(await client.rpc('onmode_command', { command: { type: 'start', value: { id: sessions[i], method: 'flow', activityId: null, targetSeconds: null, restSeconds: 0 } } }))))
      const focusing = (page: Page) => page.locator('ol.data-list>li').filter({ hasText: '집중 중 ·' })
      await Promise.all(pages.map(page => expect(focusing(page)).toHaveCount(10, { timeout: 15000 })))
      await Promise.all(f.clients.slice(0, 5).map(async (client, i) => dataOf(await client.rpc('onmode_command', { command: { type: 'pause', id: sessions[i] } }))))
      await Promise.all(pages.map(page => expect(focusing(page)).toHaveCount(5, { timeout: 15000 })))
      await Promise.all(f.clients.slice(0, 5).map(async (client, i) => dataOf(await client.rpc('onmode_command', { command: { type: 'resume', id: sessions[i] } }))))
      await Promise.all(pages.map(page => expect(focusing(page)).toHaveCount(10, { timeout: 15000 })))
      // Only disposable local rows get controlled elapsed times; HTTP clients send no duration or reward.
      f.sql('begin; ' + sessions.map((id, i) => "update public.focus_sessions set active_since = clock_timestamp() - interval '" + (65 + i * 60) + " seconds' where id = '" + id + "';").join(' ') + ' commit;')
      await Promise.all(f.clients.map(async (client, i) => {
        const command = { type: 'finish', id: sessions[i] }
        dataOf(await client.rpc('onmode_command', { command })); dataOf(await client.rpc('onmode_command', { command }))
      }))
      for (let i = 0; i < 10; i++) {
        const view = await snapshot(i)
        expect(view.timer).toBeNull(); expect(view.records).toHaveLength(1)
        expect(view.records[0]).toMatchObject({ coins: i + 1, xp: (i + 1) * 5 })
        totalSeconds += view.records[0].seconds
      }
      const rank = dataOf(await ranking()) as Ranking
      expect(rank.members).toHaveLength(10)
      expect(rank.total).toBe(totalSeconds); expect(rank.week).toBe(totalSeconds)
      const challenges = dataOf(await owner.rpc('onmode_challenges', { group_id: f.privateId })) as Challenge[]
      expect(challenges.find(challenge => challenge.id === challengeId)).toMatchObject({ status: 'achieved', totalSeconds })
      await Promise.all(pages.map(async page => {
        await expect(focusing(page)).toHaveCount(0, { timeout: 15000 })
        await expect(page.locator('ol.data-list>li').first()).toContainText(f.names[9])
        await expect(page.getByRole('article', { name: '열 명의 공동 집중', exact: true }).getByText('목표 달성', { exact: true })).toBeVisible()
      }))
      await pages[9].locator('ol.data-list').screenshot({ path: info.outputPath('ten-user-ranking.png'), scale: 'css' })
      checks.push('10 live timers; 5 pauses/resumes; 10 unique focus records; 55 total coins / 275 XP; challenge and rankings')
    })

    await test.step('share one book and race ten shared-room edits', async () => {
      await pages[0].getByRole('button', { name: '공동 도서 등록', exact: true }).click()
      await pages[0].getByRole('dialog', { name: '공동 도서 등록', exact: true }).getByRole('button', { name: '공유하기', exact: true }).click()
      await Promise.all(pages.map(page => expect(page.getByRole('region', { name: '공동 도서관', exact: true }).getByRole('article', { name: '열 명이 함께 읽는 책', exact: true })).toBeVisible({ timeout: 15000 })))
      const book = (await library(0)).books[0]
      await Promise.all(f.clients.map(async client => {
        const request = { group_id: f.privateId, action: 'import', payload: { id: book.id, activityId: randomUUID() } }
        const first = dataOf(await client.rpc('onmode_library_change', request))
        const retry = dataOf(await client.rpc('onmode_library_change', { ...request, payload: { ...request.payload, activityId: randomUUID() } }))
        expect(retry.id).toBe(first.id)
      }))
      for (let i = 0; i < 10; i++) {
        const view = await snapshot(i)
        expect(view.activities).toHaveLength(1)
        expect(view.activities[0].currentPage).toBe(i === 0 ? 70 : 0)
        expect(view.journal).toHaveLength(i === 0 ? 1 : 0)
        expect(dataOf(await f.clients[i].from('activities').select('id'))).toHaveLength(1)
        expect(view.room).toEqual({ revision: 0, positions: {} })
      }
      const requests = f.clients.map((_, i) => ({ group_id: f.privateId, action: 'layout', payload: { revision: 0, positions: { desk: { x: 20 + i, y: 0 } } } }))
      const attempts = await Promise.all(f.clients.map((client, i) => client.rpc('onmode_library_change', requests[i])))
      expect(attempts.filter(result => !result.error)).toHaveLength(1)
      expect(attempts.filter(result => result.error?.code === '40001')).toHaveLength(9)
      const winner = attempts.findIndex(result => !result.error)
      dataOf(await f.clients[winner].rpc('onmode_library_change', requests[winner]))
      expect((await library(0)).room).toEqual({ revision: 1, positions: { desk: { x: 20 + winner, y: 0 } } })
      await Promise.all(pages.map(page => expect(page.getByRole('region', { name: '공동 도서관', exact: true }).locator('[data-room-item="desk"]')).toHaveAttribute('transform', 'translate(' + (20 + winner) + ' 0)', { timeout: 15000 })))
      checks.push('10 private book imports; private progress/notes; 1 successful layout + 9 version conflicts; retry and live update')
    })

    await test.step('leave, rejoin and transfer ownership without privilege retention', async () => {
      const leave = async (page: Page) => {
        await page.getByRole('button', { name: '그룹 탈퇴', exact: true }).click()
        await page.getByRole('dialog', { name: '그룹 탈퇴', exact: true }).getByRole('button', { name: '탈퇴하기', exact: true }).click()
        await expect(page.getByRole('dialog', { name: '그룹 탈퇴', exact: true })).not.toBeVisible()
      }
      await leave(pages[9])
      expect((await ranking(last)).error?.code).toBe('42501')
      expect((await last.rpc('onmode_chat_messages', { group_id: f.privateId })).error?.code).toBe('42501')
      expect((await last.rpc('onmode_library', { group_id: f.privateId })).error?.code).toBe('42501')
      expect(dataOf(await last.from('group_library_books').select('id'))).toEqual([])
      expect((dataOf(await ranking()) as Ranking).total).toBe(totalSeconds)
      await invite(pages[9])
      expect((dataOf(await ranking()) as Ranking).members.find(member => member.id === f.userIds[9])).toMatchObject({ today: 0, week: 0 })
      await leave(pages[0])
      await expect(pages[1].getByRole('button', { name: '공동 목표 수정', exact: true })).toBeVisible({ timeout: 15000 })
      expect((await owner.rpc('onmode_notice_change', { group_id: f.privateId, action: 'create', payload: { id: randomUUID(), title: 'old owner', body: 'denied' } })).error?.code).toBe('42501')
      await pages[1].getByRole('button', { name: '공동 목표 수정', exact: true }).click()
      await pages[1].getByRole('dialog', { name: '공동 목표 수정', exact: true }).getByLabel('주간 공동 목표 (분)').fill('120')
      await pages[1].getByRole('dialog', { name: '공동 목표 수정', exact: true }).getByRole('button', { name: '저장', exact: true }).click()
      await invite(pages[0])
      await expect(pages[0].getByRole('button', { name: '공동 목표 수정', exact: true })).toHaveCount(0)
      const roles = dataOf(await ranking(f.clients[1])) as Ranking
      expect(roles.members.find(member => member.id === f.userIds[1])?.role).toBe('owner')
      expect(roles.members.find(member => member.id === f.userIds[0])?.role).toBe('member')
      expect(roles.total).toBe(totalSeconds)
      checks.push('leaver access revoked; rejoin starts a new ranking period; ownership transfers and old owner rejoins as member')
    })

    await test.step('delete empty groups and clean all ten temporary accounts', async () => {
      for (const groupId of [f.privateId, f.publicId]) await Promise.all(f.clients.map(async client => dataOf(await client.rpc('onmode_group_change', { action: 'leave', payload: { id: groupId } }))))
      expect(f.counts().groups).toBe(0)
      expect(f.sql("select count(*) from public.group_library_books where group_id = '" + f.privateId + "'")).toBe('0')
      expect(f.sql("select count(*) from public.group_library_layouts where group_id = '" + f.privateId + "'")).toBe('0')
      expect(f.sql("select count(*) from public.group_notices where group_id = '" + f.privateId + "'")).toBe('0')
      expect(f.sql("select count(*) from public.group_messages where group_id = '" + f.privateId + "'")).toBe('0')
      expect((await snapshot(9)).activities).toHaveLength(1)
      await f.cleanup()
      expect(f.counts()).toEqual({ users: 0, groups: 0 })
      checks.push('empty group cascades; imported personal book retained; all 10 accounts and 2 groups cleaned')
    })
    await info.attach('ten-user-summary', { body: JSON.stringify({ accounts: 10, browsers: 10, desktop: 5, mobile: 5, groups: 2, totalFocusSeconds: totalSeconds, checks, remainingFixtureUsers: 0, remainingFixtureGroups: 0 }, null, 2), contentType: 'application/json' })
  } finally { await Promise.all(contexts.map(context => context.close())); await f.cleanup() }
})
