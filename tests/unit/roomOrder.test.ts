import { expect, it } from 'vitest'
import { defaultRoomOrder, moveLayer, normalizeOrder, roomOrder, sameOrder, sharedRoomItems } from '../../src/domain/room'

it('moves across visible furniture while retaining hidden layer slots and input values', () => {
  const original = [...defaultRoomOrder]
  const order = moveLayer(original, 'desk', 1, ['desk', 'chair'])
  expect(order).toEqual(['shelf', 'frame', 'chair', 'lamp', 'laptop', 'desk', 'plant'])
  expect(original).toEqual(defaultRoomOrder)
  expect(roomOrder(order, ['desk', 'chair'])).toEqual(['chair', 'desk'])
  expect(roomOrder(order, ['desk', 'chair', 'lamp'])).toEqual(['chair', 'lamp', 'desk'])
  expect(moveLayer(order, 'desk', 1, ['desk', 'chair'])).toEqual(order)
  expect(moveLayer(order, 'desk', -1, ['desk', 'chair'])).toEqual([])
  expect(moveLayer(order, 'plant', -1, ['desk', 'chair'])).toEqual(order)
})

it('normalizes complete palettes and rejects malformed, duplicate and unknown entries', () => {
  expect(normalizeOrder(defaultRoomOrder)).toEqual([])
  expect(normalizeOrder(sharedRoomItems, sharedRoomItems)).toEqual([])
  for (const order of [null, {}, ['desk'], [...defaultRoomOrder, 'desk'], defaultRoomOrder.map(() => 'desk'), [...defaultRoomOrder.slice(1), 'wall']]) expect(() => normalizeOrder(order)).toThrow('겹침 순서')
  expect(() => normalizeOrder(defaultRoomOrder, sharedRoomItems)).toThrow('겹침 순서')
  const group = moveLayer([], 'desk', 1, sharedRoomItems, sharedRoomItems)
  expect(group).toEqual(['shelf', 'lamp', 'desk', 'chair', 'plant'])
  expect(sameOrder([], undefined)).toBe(true)
  expect(sameOrder([], group, sharedRoomItems)).toBe(false)
})
