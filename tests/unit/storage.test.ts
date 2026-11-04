import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { localRepository } from '../../src/data/local'
import { totals, type Command } from '../../src/domain/model'

describe('IndexedDB transactions', () => {
  it('serializes competing timer starts and rewards a session only once', async () => {
    let now = 10_000
    const first = localRepository(() => now, 'atomic')
    const other = localRepository(() => now, 'atomic')
    const start = (id: string): Command => ({ type: 'start', value: { id, method: 'flow', activityId: null, targetSeconds: null, restSeconds: 0 } })
    const attempts = await Promise.allSettled([first.execute(start('first')), other.execute(start('second'))])
    expect(attempts.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const id = (await other.load()).snapshot.timer!.id
    now += 61_000
    await Promise.all([first.execute({ type: 'finish', id }), other.execute({ type: 'finish', id })])
    const { snapshot } = await other.load()
    expect(snapshot.timer).toBeNull()
    expect(snapshot.records).toHaveLength(1)
    expect(totals(snapshot)).toEqual({ xp: 5, coins: 1 })
    await Promise.all([first.execute({ type: 'buy', id: 'lamp' }), other.execute({ type: 'buy', id: 'lamp' })])
    await other.execute({ type: 'place', id: 'lamp', placed: true })
    const reopened = (await first.load()).snapshot
    expect(reopened.inventory.filter(v => v === 'lamp')).toHaveLength(1)
    expect(reopened.placed).toContain('lamp')
    expect(totals(reopened)).toEqual({ xp: 5, coins: 0 })
  })
})
