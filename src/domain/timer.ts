import { MAX_FOCUS_SECONDS, MIN_REWARD_SECONDS, type Timer, type FocusRecord, type Snapshot } from './model'
import { dayKey } from './stats'

export function elapsed(timer: Timer, now: number) {
  return Math.min((timer.targetSeconds ?? MAX_FOCUS_SECONDS) * 1000,
    timer.elapsedMs + (timer.activeSince === null ? 0 : Math.max(0, now - timer.activeSince)))
}
export const isDue = (timer: Timer, now: number) => elapsed(timer, now) >= (timer.targetSeconds ?? MAX_FOCUS_SECONDS) * 1000
export function pause(timer: Timer, now: number): Timer {
  return { ...timer, elapsedMs: elapsed(timer, now), activeSince: null }
}
export function resume(timer: Timer, now: number): Timer {
  return timer.activeSince === null ? { ...timer, activeSince: now } : timer
}
export function recordFor(timer: Timer, now: number): FocusRecord | null {
  const seconds = Math.floor(elapsed(timer, now) / 1000)
  if (!seconds) return null
  const minutes = Math.floor(seconds / MIN_REWARD_SECONDS)
  const end = timer.activeSince !== null && isDue(timer, now)
    ? timer.activeSince + Math.max(0, seconds * 1000 - timer.elapsedMs) : now
  return { id: timer.id, method: timer.method, activityId: timer.activityId,
    seconds, endedAt: end, xp: minutes * 5, coins: minutes }
}
export function nextBreak(timer: Timer, snapshot: Snapshot) {
  const done = snapshot.records.find(r => r.id === timer.id)
  if (!done || timer.targetSeconds !== done.seconds || !timer.restSeconds) return null
  const rounds = snapshot.records.filter(r => r.method === 'pomodoro' && r.seconds === 1500 &&
    dayKey(r.endedAt) === dayKey(done.endedAt) && r.endedAt <= done.endedAt).length
  const long = timer.method === 'pomodoro' && rounds % 4 === 0
  return { endAt: done.endedAt + (long ? 900 : timer.restSeconds) * 1000, long }
}
