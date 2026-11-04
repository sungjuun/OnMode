import { describe, expect, it } from 'vitest'
import { elapsed, isDue, nextBreak, pause, recordFor, resume } from '../../src/domain/timer'
import { emptySnapshot, type Timer } from '../../src/domain/model'

const start = new Date(2026, 10, 4, 10).getTime()
const timer: Timer = { id: 't', method: 'pomodoro', activityId: 'book', targetSeconds: 1500, restSeconds: 300, elapsedMs: 0, startedAt: start, activeSince: start }
describe('timestamp timer', () => {
  it('restores after long suspension and credits only the planned interval', () => {
    const restored: Timer = JSON.parse(JSON.stringify(timer))
    expect(isDue(restored, start + 9_000_000)).toBe(true)
    expect(recordFor(restored, start + 9_000_000)).toEqual({
      id: 't', method: 'pomodoro', activityId: 'book', seconds: 1500, endedAt: start + 1_500_000, xp: 125, coins: 25,
    })
  })
  it('excludes time paused and protects against a clock that moves backward', () => {
    const paused = pause(timer, start + 30_000)
    expect(elapsed(paused, start + 120_000)).toBe(30_000)
    const resumed = resume(paused, start + 120_000)
    expect(elapsed(resumed, start + 110_000)).toBe(30_000)
    expect(recordFor(resumed, start + 165_000)?.coins).toBe(1)
    expect(recordFor(resumed, start + 140_000)?.coins).toBe(0)
  })
  it('gives a long break after every fourth full Pomodoro on the same day', () => {
    const snapshot = emptySnapshot()
    const current = recordFor(timer, start + 1_500_000)!
    snapshot.records = [1, 2, 3].map(i => ({ ...current, id: 'past-' + i, endedAt: start - i * 2_000_000 }))
    expect(nextBreak(timer, snapshot)).toBeNull()
    snapshot.records.push(current)
    expect(nextBreak(timer, snapshot)).toEqual({ long: true, endAt: current.endedAt + 900_000 })
    snapshot.records.shift()
    expect(nextBreak(timer, snapshot)).toEqual({ long: false, endAt: current.endedAt + 300_000 })
  })
})
