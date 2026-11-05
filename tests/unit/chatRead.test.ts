import { expect, it } from 'vitest'
import { readableTail } from '../../src/domain/chatRead'

const clip = { top: 100, bottom: 440, left: 10, right: 400 }
it('acknowledges a short message only when its complete ending is in the clipped viewport', () => {
  expect(readableTail({ top: 120, bottom: 170, left: 20, right: 300 }, clip)).toEqual({ top: 120, bottom: 170, left: 20, right: 300 })
  for (const message of [
    { top: 90, bottom: 150, left: 20, right: 300 },
    { top: 410, bottom: 450, left: 20, right: 300 },
    { top: 120, bottom: 170, left: 0, right: 300 },
    { top: 120, bottom: 170, left: 20, right: 401 },
  ]) expect(readableTail(message, clip)).toBeNull()
})
it('supports long messages by requiring the final 80 pixels and rejects offscreen or invalid geometry', () => {
  expect(readableTail({ top: -200, bottom: 400, left: 20, right: 300 }, clip)).toEqual({ top: 320, bottom: 400, left: 20, right: 300 })
  expect(readableTail({ top: -200, bottom: 150, left: 20, right: 300 }, clip)).toBeNull()
  expect(readableTail({ top: 120, bottom: 120, left: 20, right: 300 }, clip)).toBeNull()
  expect(readableTail({ top: 120, bottom: 200, left: 300, right: 20 }, clip)).toBeNull()
  expect(readableTail({ top: 120, bottom: Infinity, left: 20, right: 300 }, clip)).toBeNull()
  expect(readableTail({ top: 120, bottom: 170, left: 20, right: 300 }, { ...clip, bottom: 50 })).toBeNull()
})
