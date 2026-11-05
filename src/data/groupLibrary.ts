import type { SharedRoomLayout } from '../domain/room'
import { rpc, supabase } from './supabase'

export interface SharedBook {
  id: string; name: string; author: string; pages: number; isbn?: string; createdAt: string; myActivityId?: string;
  reading?: ReadingGoal;
}
export interface ReadingGoal {
  targetPage?: number; revision: number; updatedAt: string; membershipSince: string;
  mine?: { page?: number; revision: number; updatedAt: string };
  participants: number; achieved: number;
}
export interface ReadingMember { userId: string; name: string; page: number; updatedAt: string }
export interface LibraryCursor { createdAt: string; id: string }
export interface LibraryPage { items: SharedBook[]; next: LibraryCursor | null; room: SharedRoomLayout }
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
    const result = await rpc<{ books: SharedBook[]; room: SharedRoomLayout }>('onmode_library', {
      group_id: groupId, cursor_at: cursor?.createdAt ?? null, cursor_id: cursor?.id ?? null,
    })
    const items = result.books.slice(0, 20), last = items.at(-1)
    return { items, room: result.room, next: result.books.length > 20 && last ? { createdAt: last.createdAt, id: last.id } : null }
  },
  create: (groupId: string, id: string, activityId: string) => change<{ id: string }>(groupId, 'create', { id, activityId }),
  delete: (groupId: string, id: string) => change<{ id: string }>(groupId, 'delete', { id }),
  import: (groupId: string, id: string, activityId: string) => change<{ id: string }>(groupId, 'import', { id, activityId }),
  layout: (groupId: string, room: SharedRoomLayout) => change<{ room: SharedRoomLayout }>(groupId, 'layout', { ...room }),
  readingGoal: (groupId: string, id: string, revision: number, requestId: string, targetPage: number | null) => change<{ id: string }>(groupId, 'reading_goal', { id, revision, requestId, targetPage }),
  readingProgress: (groupId: string, id: string, goal: ReadingGoal, requestId: string, page: number | null) => change<{ id: string }>(groupId, 'reading_progress', {
    id, goalRevision: goal.revision, membershipSince: goal.membershipSince, revision: goal.mine?.revision ?? 0, requestId, page,
  }),
  async readingMembers(groupId: string, bookId: string, cursor: string | null = null) {
    const rows = await rpc<ReadingMember[]>('onmode_reading_members', { group_id: groupId, book_id: bookId, cursor_user: cursor })
    const items = rows.slice(0, 20)
    return { items, next: rows.length > 20 ? items.at(-1)!.userId : null }
  },
}
