import { createClient } from '@supabase/supabase-js'
import type { Command, Repository, View } from '../domain/model'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const configured = Boolean(url && key?.startsWith('sb_publishable_'))
export const recoveryPath = '/account/recovery'
export const supabase = configured ? createClient(url!, key!, {
  auth: { detectSessionInUrl: window.location.pathname !== recoveryPath },
}) : null

export function createVerificationClient() {
  if (!configured) throw Error('Supabase 연결이 필요합니다.')
  return createClient(url!, key!, {
    auth: { storageKey: 'onmode-account-verification:' + crypto.randomUUID(), persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export function createRecoveryAuth() {
  if (!configured) throw Error('Supabase 연결이 필요합니다.')
  // Keep the PKCE verifier across the email navigation. Never persist a recovery session.
  const memory = new Map<string, string>()
  return createClient(url!, key!, {
    auth: {
      flowType: 'pkce',
      storageKey: 'onmode-recovery:' + new URL(url!).host,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: id => id.endsWith('-code-verifier') ? localStorage.getItem(id) : memory.get(id) ?? null,
        setItem: (id, value) => { if (id.endsWith('-code-verifier')) localStorage.setItem(id, value); else memory.set(id, value) },
        removeItem: id => { if (id.endsWith('-code-verifier')) localStorage.removeItem(id); else memory.delete(id) },
      },
    },
  }).auth
}

export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw Error('Supabase 연결이 필요합니다.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw Error(error.message)
  return data as T
}
export const cloudRepository: Repository = {
  load: () => rpc<View>('onmode_snapshot'),
  execute: (command: Command) => rpc<View>('onmode_command', { command }),
}
export interface Group {
  id: string; name: string; description: string; isPublic: boolean; role: 'owner' | 'member' | null;
  members: number; goalMinutes: number; inviteCode?: string;
}
export interface MemberRank {
  id: string; name: string; role: 'owner' | 'member'; today: number; week: number;
  total: number; goalMinutes: number; focusingUntil: number | null;
}
export interface Ranking { members: MemberRank[]; total: number; week: number }
export type PublicGroup = Pick<Group, 'id' | 'name' | 'description' | 'isPublic' | 'members'>
export type GroupCursor = Pick<PublicGroup, 'id' | 'name'>
export interface PublicGroupPage { items: PublicGroup[]; next?: GroupCursor }

export const groups = {
  mine: () => rpc<Group[]>('onmode_my_groups'),
  async search(query: string, cursor: GroupCursor | undefined, signal: AbortSignal): Promise<PublicGroupPage> {
    if (!supabase) throw Error('Supabase 연결이 필요합니다.')
    const { data, error } = await supabase.rpc('onmode_search_public_groups', {
      search_query: query, cursor_name: cursor?.name ?? null, cursor_id: cursor?.id ?? null,
    }).abortSignal(signal)
    if (error) throw Error(error.code ? error.message : '공개 그룹을 불러오지 못했어요. 다시 시도해 주세요.')
    const rows = data as PublicGroup[]
    const items = rows.slice(0, 20), last = items.at(-1)
    return { items, next: rows.length > 20 && last ? { id: last.id, name: last.name } : undefined }
  },
  ranking: (id: string, zone: string) => rpc<Ranking>('onmode_ranking', { group_id: id, zone }),
  change: (action: string, payload: Record<string, unknown>) => rpc<string>('onmode_group_change', { action, payload }),
}
