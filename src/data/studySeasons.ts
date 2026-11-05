import { rpc } from './supabase'

interface SeasonContribution {
  rank: number
  seconds: number
  sessions: number
}

export interface StudySeason {
  month: string
  endDate: string
  currentMonth: string
  months: string[]
  totalSeconds: number
  sessions: number
  contributors: number
  ranking: (SeasonContribution & { id: string; name: string })[]
  mine: SeasonContribution | null
}

export const loadStudySeason = (groupId: string, month?: string) => rpc<StudySeason>('onmode_study_season', {
  group_id: groupId, month_start: month ?? null,
})
