import type { MovableItem, RoomLayout, RoomPositions } from '../domain/room'
import { rpc, supabase } from './supabase'

export interface SharedBook {
  id: string; name: string; author: string; pages: number; isbn?: string; createdAt: string; myActivityId?: string;
}
export interface LibraryCursor { createdAt: string; id: string }
export interface LibraryPage { items: SharedBook[]; next: LibraryCursor | null; room: RoomLayout }
export class LibraryConflict extends Error {}

async function change<T>(groupId: string, action: string, payload: Record<string, unknown>): Promise<T> {
  if (!supabase) throw Error('Supabase 연결이 필요합니다.')
  const { data, error } = await supabase.rpc('onmode_library_change', { group_id: groupId, action, payload })
  if (error?.code === '40001') throw new LibraryConflict(error.message)
  if (error) throw Error(error.code ? error.message : '공동 도서관에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.')
  return data as T
}

export const groupLibrary = {
  async list(groupId: string, cursor: LibraryCursor | null = null): Promise<LibraryPage> {
    const result = await rpc<{ books: SharedBook[]; room: RoomLayout }>('onmode_library', {
      group_id: groupId, cursor_at: cursor?.createdAt ?? null, cursor_id: cursor?.id ?? null,
    })
    const items = result.books.slice(0, 20), last = items.at(-1)
    return { items, room: result.room, next: result.books.length > 20 && last ? { createdAt: last.createdAt, id: last.id } : null }
  },
  create: (groupId: string, id: string, activityId: string) => change<{ id: string }>(groupId, 'create', { id, activityId }),
  delete: (groupId: string, id: string) => change<{ id: string }>(groupId, 'delete', { id }),
  import: (groupId: string, id: string, activityId: string) => change<{ id: string }>(groupId, 'import', { id, activityId }),
  layout: (groupId: string, revision: number, positions: RoomPositions, order?: MovableItem[]) => change<{ room: RoomLayout }>(groupId, 'layout', { revision, positions, ...(order === undefined ? {} : { order }) }),
}
