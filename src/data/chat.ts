import { supabase } from './supabase'

export interface ChatMessage {
  id: string; senderId: string; senderName: string; body: string | null;
  createdAt: string; deletedAt: string | null;
}
export type ChatCursor = { createdAt: string; id: string }
export interface ChatPage { items: ChatMessage[]; next: ChatCursor | null }

async function chatRequest<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw Error('Supabase 연결이 필요합니다.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) {
    if (['42501', '22023', 'P0001'].includes(error.code)) throw Error(error.message)
    throw Error('채팅에 연결하지 못했어요. 연결 상태를 확인하고 잠시 후 다시 시도해 주세요.')
  }
  return data as T
}

export const chat = {
  async list(groupId: string, cursor: ChatCursor | null = null): Promise<ChatPage> {
    const result = await chatRequest<ChatMessage[]>('onmode_chat_messages', {
      group_id: groupId, cursor_at: cursor?.createdAt ?? null, cursor_id: cursor?.id ?? null,
    })
    const items = result.slice(0, 30), last = items.at(-1)
    return { items, next: result.length > 30 && last ? { createdAt: last.createdAt, id: last.id } : null }
  },
  send: (groupId: string, id: string, body: string) => chatRequest<string>('onmode_chat_change', {
    group_id: groupId, action: 'send', payload: { id, body },
  }),
  delete: (groupId: string, id: string) => chatRequest<string>('onmode_chat_change', {
    group_id: groupId, action: 'delete', payload: { id },
  }),
}
