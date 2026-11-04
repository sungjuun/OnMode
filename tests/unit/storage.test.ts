import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { localRepository } from '../../src/data/local'
import { emptySnapshot, totals, type Command, type Snapshot } from '../../src/domain/model'
import { openDB } from 'idb'

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

describe('room layout persistence', () => {
  it('upgrades saved experience data without replacing existing profile records', async () => {
    const repository = localRepository(Date.now, 'legacy-room')
    await repository.load()
    const legacy: Partial<Snapshot> = emptySnapshot()
    legacy.profile = { name: '이전 사용자', goalMinutes: 90, notifications: false }
    delete legacy.room
    const db = await openDB('onmode', 1)
    await db.put('state', legacy, 'legacy-room')
    db.close()
    const { snapshot } = await repository.load()
    expect(snapshot.profile.name).toBe('이전 사용자')
    expect(snapshot.room).toEqual({ revision: 0, positions: {} })
    await repository.execute({ type: 'room_layout', revision: 0, positions: { desk: { x: 20, y: 10 } } })
    expect((await repository.load()).snapshot.room).toEqual({ revision: 1, positions: { desk: { x: 20, y: 10 } } })
  })

  it('rejects stale and invalid layouts and keeps item ownership and rewards intact', async () => {
    const repository = localRepository(Date.now, 'room-race')
    const other = localRepository(Date.now, 'room-race')
    const choices: Command[] = [
      { type: 'room_layout', revision: 0, positions: { desk: { x: 30, y: 20 } } },
      { type: 'room_layout', revision: 0, positions: { chair: { x: -10, y: 5 } } },
    ]
    const attempts = await Promise.allSettled([repository.execute(choices[0]), other.execute(choices[1])])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const winner = attempts.findIndex(result => result.status === 'fulfilled')
    await repository.execute(choices[winner])
    const saved = (await other.load()).snapshot
    expect(saved.room.revision).toBe(1)
    expect(totals(saved)).toEqual({ xp: 0, coins: 0 })
    expect(saved.inventory).toEqual(['desk', 'chair'])
    await expect(other.execute({ type: 'room_layout', revision: 1, positions: { lamp: { x: 20, y: 0 } } })).rejects.toThrow('보유하지 않은')
    await expect(other.execute({ type: 'room_layout', revision: 1, positions: { desk: { x: 1000, y: 0 } } })).rejects.toThrow('방 안')
    await expect(other.execute({ type: 'room_layout', revision: 1, positions: { desk: { x: 0.5, y: 0 } } })).rejects.toThrow('위치')
    await repository.execute({ type: 'place', id: 'desk', placed: false })
    await repository.execute({ type: 'place', id: 'desk', placed: true })
    expect((await other.load()).snapshot.room).toEqual(saved.room)
    await other.execute({ type: 'room_layout', revision: 1, positions: {} })
    expect((await repository.load()).snapshot.room).toEqual({ revision: 2, positions: {} })
  })
})
