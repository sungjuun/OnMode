import { rpc } from './supabase'

export interface GroupAchievement {
  id: string; title: string; description: string; metric: 'seconds' | 'sessions' | 'contributors';
  target: number; value: number; earnedAt: string | null;
}
export const groupAchievements = {
  list: (groupId: string) => rpc<GroupAchievement[]>('onmode_group_achievements', { group_id: groupId }),
}
