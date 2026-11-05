import { expect, it } from 'vitest'
import { applyLocal } from '../../src/data/local'
import { emptySnapshot } from '../../src/domain/model'
import { constrainPosition, movableItems, normalizePositions, normalizeTransforms, roomBounds, roomItems, sameTransforms, sharedRoomItems, type RoomTransforms } from '../../src/domain/room'

it('keeps every supported rotation and size inside the room, including tall rotated desks', () => {
  for (const id of movableItems) for (const rotation of [0, 90, 180, 270]) for (const scale of [50, 60, 70, 80, 90, 100, 110, 120]) {
    const shape = { rotation, scale }, b = roomBounds(id, shape), item = roomItems[id]
    expect(b.minX).toBeLessThanOrEqual(b.maxX)
    expect(b.minY).toBeLessThanOrEqual(b.maxY)
    const shapes = normalizeTransforms({ [id]: shape })
    for (const p of [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]) {
      expect(normalizePositions({ [id]: p }, shapes)).toBeDefined()
      const width = (rotation % 180 ? item.height : item.width) * scale / 100
      const height = (rotation % 180 ? item.width : item.height) * scale / 100
      const cx = item.x + item.width / 2 + p.x, cy = item.y + item.height / 2 + p.y
      expect(cx - width / 2).toBeGreaterThanOrEqual(12 - 1e-9)
      expect(cx + width / 2).toBeLessThanOrEqual(628 + 1e-9)
      expect(cy - height / 2).toBeGreaterThanOrEqual(12 - 1e-9)
      expect(cy + height / 2).toBeLessThanOrEqual(344 + 1e-9)
    }
    expect(() => normalizePositions({ [id]: { x: b.maxX + 1, y: b.minY } }, shapes)).toThrow('방 안')
    expect(constrainPosition(id, { x: 9999, y: -9999 }, shape)).toEqual({ x: b.maxX, y: b.minY })
  }
})

it('rejects malformed shapes and enforces the personal and shared palettes', () => {
  for (const shape of [null, [], {}, { rotation: 45, scale: 100 }, { rotation: 360, scale: 100 }, { rotation: -90, scale: 100 }, { rotation: 0, scale: 125 }, { rotation: 0, scale: 49 }, { rotation: 0, scale: 110.5 }, { rotation: '90', scale: 100 }, { rotation: 0, scale: 100, x: 0 }]) expect(() => normalizeTransforms({ desk: shape })).toThrow('회전과 크기')
  for (const value of [null, [], { wall: { rotation: 0, scale: 100 } }]) expect(() => normalizeTransforms(value)).toThrow('회전과 크기')
  expect(() => normalizeTransforms({ laptop: { rotation: 90, scale: 100 } }, sharedRoomItems)).toThrow()
  expect(normalizeTransforms({ desk: { rotation: 0, scale: 100 } })).toEqual({})
  expect(sameTransforms(undefined, { desk: { rotation: 0, scale: 100 } })).toBe(true)
  expect(sameTransforms({}, { desk: { rotation: 90, scale: 100 } })).toBe(false)
  expect(() => normalizePositions({ desk: { x: 0, y: 0, z: 0 } } as never)).toThrow('위치')
  expect(() => normalizePositions({}, { desk: { rotation: 90, scale: 120 } })).toThrow('방 안')
})

it('saves shapes atomically with positions and layers, retaining legacy clients and idempotent retries', () => {
  const base = emptySnapshot(), shapes: RoomTransforms = { desk: { rotation: 90, scale: 120 } }
  const positions = { desk: constrainPosition('desk', { x: 0, y: 0 }, shapes.desk) }
  const first = applyLocal(base, { type: 'room_layout', revision: 0, positions, transforms: shapes }, 0)
  expect(first.room).toEqual({ revision: 1, positions, transforms: shapes })
  expect(base.room).toEqual({ revision: 0, positions: {} })
  expect(applyLocal(first, { type: 'room_layout', revision: 0, positions, transforms: shapes }, 0)).toBe(first)
  // A legacy position-only save retains the shape rather than silently resetting it.
  const moved = applyLocal(first, { type: 'room_layout', revision: 1, positions: { desk: { ...positions.desk, x: 5 } } }, 0)
  expect(moved.room.transforms).toEqual(shapes)
  expect(moved.room.revision).toBe(2)
  expect(() => applyLocal(moved, { type: 'room_layout', revision: 1, positions, transforms: shapes }, 0)).toThrow('다른 곳')
  const reset = applyLocal(moved, { type: 'room_layout', revision: 2, positions: {}, transforms: {}, order: [] }, 0)
  expect(reset.room).toEqual({ revision: 3, positions: {} })
  expect(() => applyLocal(base, { type: 'room_layout', revision: 0, positions: {}, transforms: { lamp: { rotation: 0, scale: 100 } } }, 0)).toThrow('보유하지 않은')
  expect(moved.inventory).toEqual(base.inventory)
  expect(moved.records).toEqual([])
})
