import { expect, test } from '@playwright/test'
import { emptySnapshot, type Activity, type FocusRecord } from '../../src/domain/model'

test.use({ timezoneId: 'America/Los_Angeles' })

test('history combines filters and pages across local midnight from the focus shortcut', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T19:00:00Z'))
  const activities: Activity[] = [
    { id: 'subject', name: 'SQL 기초', kind: 'subject', goalMinutes: 30 },
    { id: 'book', name: '집중 독서', kind: 'book', author: '온모드', pages: 120, currentPage: 30, goalPages: 10 },
  ]
  const record = (id: string, endedAt: number, activityId: string | null, method: FocusRecord['method'], seconds: number): FocusRecord =>
    ({ id, endedAt, activityId, method, seconds, xp: Math.floor(seconds / 60) * 5, coins: Math.floor(seconds / 60) })
  const records = [
    ...Array.from({ length: 21 }, (_, i) => record('study-' + i, Date.parse('2026-11-03T18:00:00Z') - i * 60_000, 'subject', 'flow', 60)),
    record('midnight', Date.parse('2026-11-04T08:00:00Z'), 'book', 'pomodoro', 120),
    record('before-midnight', Date.parse('2026-11-04T07:59:59.999Z'), null, 'custom', 180),
    record('recent-month', Date.parse('2026-10-09T16:00:00Z'), 'subject', 'deep', 600),
    record('oldest', Date.parse('2026-09-01T12:00:00Z'), 'book', 'flow', 240),
  ]
  await page.goto('/focus')
  await expect(page.getByRole('heading', { name: '최근 집중 기록' })).toBeVisible()
  // Seed previously stored history in the test origin without changing the app clock or timer.
  await page.evaluate(async snapshot => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('onmode', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('state', 'readwrite')
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); reject(tx.error) }
        tx.objectStore('state').put(snapshot, 'guest')
      }
    })
  }, { ...emptySnapshot(), activities, records })
  await page.reload()
  await page.getByRole('link', { name: '기록 보기', exact: true }).click()
  const history = page.getByRole('region', { name: '집중 기록', exact: true })
  const rows = history.getByRole('list', { name: '집중 기록 목록' }).getByRole('listitem')
  const summary = history.getByText(/조건에 맞는 기록 \d+회/)
  const period = history.getByRole('combobox', { name: '기간', exact: true })
  const method = history.getByRole('combobox', { name: '집중 방식', exact: true })
  const activity = history.getByRole('combobox', { name: '활동', exact: true })
  const order = history.getByRole('combobox', { name: '정렬', exact: true })
  await expect(page).toHaveURL(/\/my#focus-records$/)
  await expect(history).toBeFocused()
  await expect(history.getByText('25회 기록', { exact: true })).toBeVisible()
  await expect(rows).toHaveCount(20)
  await expect(rows.first()).toContainText('뽀모도로')
  await history.getByRole('button', { name: '다음 페이지' }).click()
  await expect(rows).toHaveCount(5)
  await expect(history.getByText('2 / 2 페이지', { exact: true })).toBeVisible()
  await history.getByRole('button', { name: '이전 페이지' }).click()
  await expect(rows).toHaveCount(20)
  await order.selectOption('oldest')
  await expect(rows.first()).toContainText('집중 독서')
  await expect(rows.first()).toContainText('플로우타임')

  await period.selectOption('today')
  await expect(summary).toHaveText('조건에 맞는 기록 1회 · 2분')
  await expect(rows.first()).toContainText('뽀모도로')
  await period.selectOption('week')
  await expect(summary).toContainText('23회')
  await period.selectOption('month')
  await expect(summary).toContainText('24회')

  await period.selectOption('custom')
  const start = history.getByLabel('시작일')
  const end = history.getByLabel('종료일')
  await start.fill('2026-11-04')
  await end.fill('2026-11-03')
  await expect(history.getByRole('alert')).toContainText('종료일은 시작일과 같거나 이후')
  await start.fill('2026-11-03')
  await expect(summary).toHaveText('조건에 맞는 기록 22회 · 24분')
  await activity.selectOption('free')
  await method.selectOption('custom')
  await expect(summary).toHaveText('조건에 맞는 기록 1회 · 3분')
  await expect(rows.first()).toContainText('자유 집중')
  await activity.selectOption('book')
  await expect(history.getByText('조건에 맞는 집중 기록이 없어요.')).toBeVisible()
  await history.getByRole('button', { name: '필터 초기화' }).click()
  await expect(rows).toHaveCount(20)
  await expect(rows.first()).toContainText('뽀모도로')
  await expect(history.getByRole('button', { name: '필터 초기화' })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
})
