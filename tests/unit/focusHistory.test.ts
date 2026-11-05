import { expect, test } from 'vitest'
import { historyRange, selectFocusHistory } from '../../src/domain/focusHistory'
import type { FocusRecord } from '../../src/domain/model'

const time = (day: number, hour = 0) => new Date(2026, 2, day, hour).getTime()
const record = (id: string, endedAt: number, activityId: string | null = null, method: FocusRecord['method'] = 'flow'): FocusRecord =>
  ({ id, endedAt, activityId, method, seconds: 60, xp: 5, coins: 1 })

test('history ranges use inclusive calendar days and allow either custom bound', () => {
  expect(historyRange('today', time(9, 1), '', '')).toEqual({ from: '2026-03-09', to: '2026-03-09' })
  expect(historyRange('week', time(9, 1), '', '')).toEqual({ from: '2026-03-03', to: '2026-03-09' })
  expect(historyRange('month', time(9, 1), '', '')).toEqual({ from: '2026-02-08', to: '2026-03-09' })
  expect(historyRange('custom', time(9), '', '2026-03-08')).toEqual({ from: undefined, to: '2026-03-08' })
})

test('filters combine without changing stored records and timestamp ties are stable', () => {
  const records = [record('b', time(8)), record('after', time(9)), record('before', time(8) - 1),
    record('subject', time(8), 'book'), record('a', time(8)), record('other-method', time(8), null, 'custom')]
  const matching = selectFocusHistory(records, { from: '2026-03-08', to: '2026-03-08', activityId: null, method: 'flow', order: 'newest' })
  expect(matching.map(item => item.id)).toEqual(['a', 'b'])
  expect(selectFocusHistory(records, { order: 'oldest' }).at(0)?.id).toBe('before')
  expect(selectFocusHistory(records, { from: '2026-03-09', to: '2026-03-08', order: 'newest' })).toEqual([])
  expect(records.map(item => item.id)).toEqual(['b', 'after', 'before', 'subject', 'a', 'other-method'])
})
