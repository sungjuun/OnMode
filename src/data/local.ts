import { openDB, type DBSchema } from 'idb'
import { emptySnapshot, items, totals, type Snapshot, type Command, type Repository, type BreakTimer } from '../domain/model'
import { isDue, pause, recordFor, resume } from '../domain/timer'
import { emptyRoom, normalizePositions, samePositions } from '../domain/room'
import { normalizeIsbn } from '../domain/isbn'

interface OnmodeDB extends DBSchema { state: { key: string; value: Snapshot | BreakTimer } }
let db: ReturnType<typeof openDB<OnmodeDB>> | undefined
function database() {
  db ??= openDB<OnmodeDB>('onmode', 1, { upgrade(database) { database.createObjectStore('state') } })
  return db
}
function upsert<T extends { id: string }>(list: T[], value: T) {
  return list.some(item => item.id === value.id) ? list.map(item => item.id === value.id ? value : item) : [...list, value]
}
export function applyLocal(s: Snapshot, command: Command, now: number): Snapshot {
  switch (command.type) {
    case 'profile': return { ...s, profile: command.value }
    case 'certification': return { ...s, certifications: upsert(s.certifications, command.value) }
    case 'activity': {
      const value = command.value
      if (value.isbn !== undefined) {
        if (value.kind !== 'book' || normalizeIsbn(value.isbn) !== value.isbn) throw Error('올바른 ISBN 13자리를 입력해 주세요.')
        if (s.activities.some(a => a.id !== value.id && a.isbn === value.isbn)) throw Error('이미 서재에 등록한 ISBN입니다.')
      }
      return { ...s, activities: upsert(s.activities, value) }
    }
    case 'journal': {
      if (s.journal.some(j => j.id === command.value.id)) return s
      const a = s.activities.find(item => item.id === command.value.activityId)
      if (!a) throw Error('활동을 찾을 수 없습니다.')
      return { ...s, journal: [...s.journal, command.value],
        activities: a.kind === 'book' ? upsert(s.activities, { ...a, currentPage: command.value.amount }) : s.activities }
    }
    case 'start': {
      if (s.timer?.id === command.value.id || s.records.some(r => r.id === command.value.id)) return s
      if (s.timer) throw Error('이미 진행 중인 집중이 있습니다.')
      if (command.value.activityId && !s.activities.some(a => a.id === command.value.activityId)) throw Error('활동을 찾을 수 없습니다.')
      return { ...s, timer: { ...command.value, startedAt: now, activeSince: now, elapsedMs: 0 } }
    }
    case 'pause':
    case 'resume': {
      if (s.timer?.id !== command.id || isDue(s.timer, now)) return s
      return { ...s, timer: command.type === 'pause' ? pause(s.timer, now) : resume(s.timer, now) }
    }
    case 'finish': {
      if (s.timer?.id !== command.id) return s
      const record = recordFor(s.timer, now)
      return { ...s, timer: null, records: record ? upsert(s.records, record) : s.records }
    }
    case 'buy': {
      const item = items.find(i => i.id === command.id)
      if (!item || s.inventory.includes(item.id)) return s
      if (totals(s).coins < item.price) throw Error('코인이 부족합니다.')
      return { ...s, inventory: [...s.inventory, item.id] }
    }
    case 'place': {
      if (!s.inventory.includes(command.id)) throw Error('보유하지 않은 아이템입니다.')
      return { ...s, placed: command.placed ? [...new Set([...s.placed, command.id])] : s.placed.filter(id => id !== command.id) }
    }
    case 'room_layout': {
      const positions = normalizePositions(command.positions)
      if (Object.keys(command.positions).some(id => !s.inventory.includes(id))) throw Error('보유하지 않은 아이템입니다.')
      if (!Number.isInteger(command.revision) || command.revision < 0) throw Error('배치 정보를 다시 불러와 주세요.')
      if (samePositions(s.room.positions, positions)) return s
      if (s.room.revision !== command.revision) throw Error('다른 곳에서 배치가 변경됐어요. 최신 배치를 불러와 주세요.')
      return { ...s, room: { revision: s.room.revision + 1, positions } }
    }
  }
}
export function localRepository(clock = Date.now, key = 'guest'): Repository {
  return {
    async load() {
      const state = (await (await database()).get('state', key)) as Snapshot | undefined
      return { snapshot: state ? { ...state, room: state.room ?? emptyRoom() } : emptySnapshot() }
    },
    async execute(command) {
      const tx = (await database()).transaction('state', 'readwrite')
      const current = (await tx.store.get(key)) as Snapshot | undefined
      const upgraded = current ? { ...current, room: current.room ?? emptyRoom() } : emptySnapshot()
      const snapshot = applyLocal(upgraded, command, clock())
      await tx.store.put(snapshot, key)
      await tx.done
      return { snapshot }
    },
  }
}
export async function loadBreak(key: string) {
  return (await (await database()).get('state', 'break:' + key)) as BreakTimer | undefined
}
export async function saveBreak(key: string, value: BreakTimer | null) {
  const db = await database()
  if (value) await db.put('state', value, 'break:' + key)
  else await db.delete('state', 'break:' + key)
}
