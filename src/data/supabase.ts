import { createClient } from '@supabase/supabase-js'
import type { Command, Repository, View } from '../domain/model'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const configured = Boolean(url && key?.startsWith('sb_publishable_'))
export const supabase = configured ? createClient(url!, key!) : null

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
