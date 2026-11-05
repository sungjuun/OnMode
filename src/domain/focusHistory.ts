import type { FocusRecord, Method } from './model'
import { dayKey, shiftDay } from './stats'

export type HistoryPeriod = 'all' | 'today' | 'week' | 'month' | 'custom'
export type HistoryOrder = 'newest' | 'oldest'

export function historyRange(period: HistoryPeriod, now: number, start: string, end: string) {
  if (period === 'custom') return { from: start || undefined, to: end || undefined }
  if (period === 'all') return {}
  const daysAgo = { today: 0, week: 6, month: 29 }[period]
  return { from: dayKey(shiftDay(now, -daysAgo)), to: dayKey(now) }
}

export function selectFocusHistory(records: readonly FocusRecord[], criteria: {
  from?: string
  to?: string
  activityId?: string | null
  method?: Method
  order: HistoryOrder
}) {
  const { from, to, activityId, method, order } = criteria
  if (from && to && from > to) return []
  return records.filter(record => {
    if (activityId !== undefined && record.activityId !== activityId) return false
    if (method && record.method !== method) return false
    if (!from && !to) return true
    const day = dayKey(record.endedAt)
    return (!from || day >= from) && (!to || day <= to)
  }).sort((a, b) => {
    const difference = order === 'newest' ? b.endedAt - a.endedAt : a.endedAt - b.endedAt
    return difference || a.id.localeCompare(b.id)
  })
}
