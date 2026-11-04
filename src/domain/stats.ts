import type { FocusRecord } from './model'

export function dayKey(timestamp: number | Date) {
  const d = new Date(timestamp)
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}
export function shiftDay(now: number, delta: number) {
  const d = new Date(now)
  d.setDate(d.getDate() + delta)
  return d.getTime()
}
export const monday = (now: number) => shiftDay(now, -((new Date(now).getDay() + 6) % 7))
export const sum = (records: FocusRecord[]) => records.reduce((n, r) => n + r.seconds, 0)
export function stats(records: FocusRecord[], now = Date.now()) {
  const today = dayKey(now)
  const totals = new Map<string, number>()
  for (const record of records) {
    const date = dayKey(record.endedAt)
    totals.set(date, (totals.get(date) ?? 0) + record.seconds)
  }
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = dayKey(shiftDay(monday(now), i))
    return { date, seconds: totals.get(date) ?? 0, today: date === today }
  })
  return { today: totals.get(today) ?? 0, week, weekly: week.reduce((n, d) => n + d.seconds, 0),
    monthly: sum(records.filter(r => dayKey(r.endedAt).startsWith(today.slice(0, 7)))), total: sum(records) }
}
export function streak(records: FocusRecord[], goalSeconds: number, now = Date.now()) {
  const totals = new Map<string, number>()
  for (const { endedAt, seconds } of records) {
    const key = dayKey(endedAt)
    totals.set(key, (totals.get(key) ?? 0) + seconds)
  }
  let day = (totals.get(dayKey(now)) ?? 0) >= goalSeconds ? 0 : -1
  let count = 0
  while ((totals.get(dayKey(shiftDay(now, day))) ?? 0) >= goalSeconds) { count++; day-- }
  return count
}
export function dDay(date: string, now = Date.now()) {
  const utc = (value: string) => new Date(value + 'T00:00:00Z').getTime()
  const days = Math.round((utc(date) - utc(dayKey(now))) / 86400000)
  return days === 0 ? 'D-DAY' : days > 0 ? 'D-' + days : 'D+' + Math.abs(days)
}
export function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60)
  if (!hours && !minutes && seconds > 0) return seconds + '초'
  return hours ? hours + '시간 ' + minutes + '분' : minutes + '분'
}
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const parts = s >= 3600 ? [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60] : [Math.floor(s / 60), s % 60]
  return parts.map(n => String(n).padStart(2, '0')).join(':')
}
export const percent = (value: number, goal: number) => goal > 0 ? Math.min(100, Math.floor(value / goal * 100)) : 0
