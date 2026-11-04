import { rpc } from './supabase'

export interface Challenge {
  id: string; title: string; targetMinutes: number; startDate: string; endDate: string;
  timeZone: string; totalSeconds: number; canCancel: boolean;
  status: 'scheduled' | 'active' | 'achieved' | 'ended' | 'cancelled';
  members: { id: string; name: string; seconds: number }[];
}
export interface NewChallenge {
  id: string; title: string; targetMinutes: number; startDate: string; endDate: string; timeZone: string;
}
export const challenges = {
  list: (groupId: string) => rpc<Challenge[]>('onmode_challenges', { group_id: groupId }),
  create: (groupId: string, value: NewChallenge) => rpc<string>('onmode_challenge_change', { group_id: groupId, action: 'create', payload: value }),
  cancel: (groupId: string, id: string) => rpc<string>('onmode_challenge_change', { group_id: groupId, action: 'cancel', payload: { id } }),
}
