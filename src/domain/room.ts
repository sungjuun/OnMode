export interface RoomPosition { x: number; y: number }
export const roomItems = {
  desk: { x: 185, y: 203, width: 270, height: 90, minY: -33, maxY: 41 },
  chair: { x: 281, y: 224, width: 77, height: 80, minY: -44, maxY: 30 },
  shelf: { x: 51, y: 123, width: 100, height: 147, minY: -10, maxY: 64 },
  frame: { x: 444, y: 70, width: 64, height: 70, minY: -58, maxY: 90 },
  lamp: { x: 362, y: 126, width: 60, height: 78, minY: -34, maxY: 81 },
  laptop: { x: 277, y: 158, width: 83, height: 45, minY: -33, maxY: 82 },
  plant: { x: 510, y: 200, width: 55, height: 80, minY: -20, maxY: 54 },
} as const
// The SVG is 640 × 356. Keep these bounds aligned with room_item_bounds in SQL.
export type MovableItem = keyof typeof roomItems
export type RoomPositions = Partial<Record<MovableItem, RoomPosition>>
export interface RoomLayout { revision: number; positions: RoomPositions; order?: MovableItem[] }
export const emptyRoom = (): RoomLayout => ({ revision: 0, positions: {} })
export const movableItems = Object.keys(roomItems) as MovableItem[]
// SVG paint order, from back to front. Keep the SQL palettes in this order.
export const defaultRoomOrder: MovableItem[] = ['shelf', 'frame', 'desk', 'lamp', 'laptop', 'chair', 'plant']
export const sharedRoomItems: MovableItem[] = ['shelf', 'desk', 'lamp', 'chair', 'plant']
export function roomOrder(order: readonly MovableItem[] = [], available: readonly MovableItem[] = movableItems): MovableItem[] {
  return [...defaultRoomOrder.filter(id => available.includes(id) && !order.includes(id)), ...order.filter(id => available.includes(id))]
}
export function normalizeOrder(value: unknown, available: readonly MovableItem[] = movableItems): MovableItem[] {
  if (!Array.isArray(value) || value.some(id => !available.includes(id)) || new Set(value).size !== value.length || value.length !== 0 && value.length !== available.length) throw Error('가구 겹침 순서를 확인해 주세요.')
  const base = roomOrder([], available)
  return value.length === 0 || value.every((id, i) => id === base[i]) ? [] : [...value] as MovableItem[]
}
export function sameOrder(a: readonly MovableItem[] = [], b: readonly MovableItem[] = [], available: readonly MovableItem[] = movableItems) {
  const other = roomOrder(b, available)
  return roomOrder(a, available).every((id, i) => id === other[i])
}
export function moveLayer(order: readonly MovableItem[] | undefined, id: MovableItem, direction: -1 | 1, visible: readonly MovableItem[], available: readonly MovableItem[] = movableItems): MovableItem[] {
  const full = roomOrder(order, available), shown = full.filter(item => visible.includes(item))
  const target = shown[shown.indexOf(id) + direction]
  if (!shown.includes(id) || !target) return normalizeOrder(full, available)
  const from = full.indexOf(id), to = full.indexOf(target)
  const previous = full[from]
  full[from] = full[to]
  full[to] = previous
  return normalizeOrder(full, available)
}
export const isMovable = (id: string): id is MovableItem => Object.hasOwn(roomItems, id)
export const roomPosition = (positions: RoomPositions, id: MovableItem): RoomPosition => positions[id] ?? { x: 0, y: 0 }
export function roomBounds(id: MovableItem) {
  const item = roomItems[id]
  return { minX: 12 - item.x, maxX: 628 - item.x - item.width, minY: item.minY, maxY: item.maxY }
}
export function constrainPosition(id: MovableItem, point: RoomPosition): RoomPosition {
  const bounds = roomBounds(id)
  return {
    x: Math.round(Math.min(bounds.maxX, Math.max(bounds.minX, point.x))),
    y: Math.round(Math.min(bounds.maxY, Math.max(bounds.minY, point.y))),
  }
}
export function normalizePositions(positions: RoomPositions): RoomPositions {
  const result: RoomPositions = {}
  for (const id of Object.keys(positions)) {
    if (!isMovable(id)) throw Error('이동할 수 없는 아이템입니다.')
    const p = positions[id]
    if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y)) throw Error('아이템 위치를 확인해 주세요.')
    const safe = constrainPosition(id, p)
    if (safe.x !== p.x || safe.y !== p.y) throw Error('아이템을 방 안에 배치해 주세요.')
    if (p.x !== 0 || p.y !== 0) result[id] = { x: p.x, y: p.y }
  }
  return result
}
export const samePositions = (a: RoomPositions, b: RoomPositions) => movableItems.every(id => {
  const x = roomPosition(a, id), y = roomPosition(b, id)
  return x.x === y.x && x.y === y.y
})
