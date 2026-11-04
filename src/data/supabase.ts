import { createClient } from '@supabase/supabase-js'
import type { Command, Repository, View } from '../domain/model'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const configured = Boolean(url && key?.startsWith('sb_publishable_'))
export const recoveryPath = '/account/recovery'
export const supabase = configured ? createClient(url!, key!, {
  auth: { detectSessionInUrl: window.location.pathname !== recoveryPath },
}) : null

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
export const groups = {
  list: () => rpc<Group[]>('onmode_groups'),
  ranking: (id: string, zone: string) => rpc<Ranking>('onmode_ranking', { group_id: id, zone }),
  change: (action: string, payload: Record<string, unknown>) => rpc<string>('onmode_group_change', { action, payload }),
}
