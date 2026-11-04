import { rpc, supabase } from './supabase'

export interface Notice {
  id: string; title: string; body: string; version: number; createdAt: string; updatedAt: string;
}
export type NoticeCursor = { createdAt: string; id: string }
export interface NoticePage { items: Notice[]; next: NoticeCursor | null }
export class NoticeConflict extends Error {}

async function change(groupId: string, action: 'create' | 'edit' | 'delete', payload: {
  id: string; version?: number; title?: string; body?: string;
}) {
  if (!supabase) throw Error('Supabase 연결이 필요합니다.')
  const { data, error } = await supabase.rpc('onmode_notice_change', { group_id: groupId, action, payload })
  if (error?.code === '40001') throw new NoticeConflict(error.message)
  if (error) throw Error(error.message)
  return data as string
}

export const notices = {
  async list(groupId: string, cursor: NoticeCursor | null = null): Promise<NoticePage> {
    const result = await rpc<Notice[]>('onmode_notices', {
      group_id: groupId, cursor_at: cursor?.createdAt ?? null, cursor_id: cursor?.id ?? null,
    })
    const items = result.slice(0, 20), last = items.at(-1)
    return { items, next: result.length > 20 && last ? { createdAt: last.createdAt, id: last.id } : null }
  },
  create: (groupId: string, value: Pick<Notice, 'id' | 'title' | 'body'>) => change(groupId, 'create', value),
  edit: (groupId: string, value: Pick<Notice, 'id' | 'title' | 'body' | 'version'>) => change(groupId, 'edit', value),
  delete: (groupId: string, value: Pick<Notice, 'id' | 'version'>) => change(groupId, 'delete', value),
}
