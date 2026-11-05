import { rpc, supabase } from './supabase'

export interface ReadingChallenge {
  id: string
  bookName: string
  bookPages: number
  targetPage: number
  startDate: string
  endDate: string
  timeZone: string
  createdAt: string
  status: 'scheduled' | 'active' | 'ended' | 'cancelled'
  participants: number
  achieved: number
  myPage: number | null
  myRevision: number
  membershipSince: string
}

interface NewReadingChallenge {
  id: string
  bookId: string
  targetPage: number
  startDate: string
  endDate: string
  timeZone: string
}

export class ReadingChallengeConflict extends Error {}

async function change(groupId: string, action: string, payload: Record<string, unknown>) {
  if (!supabase) throw Error('Supabase 연결이 필요합니다.')
  const { error } = await supabase.rpc('onmode_reading_challenge_change', { group_id: groupId, action, payload })
  if (error?.code === '40001') throw new ReadingChallengeConflict(error.message)
  if (error) throw Error(error.code ? error.message : '독서 도전에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.')
}

export const readingChallenges = {
  async list(groupId: string, cursor?: Pick<ReadingChallenge, 'createdAt' | 'id'>) {
    const rows = await rpc<ReadingChallenge[]>('onmode_reading_challenges', {
      group_id: groupId, cursor_at: cursor?.createdAt ?? null, cursor_id: cursor?.id ?? null,
    })
    const items = rows.slice(0, 10)
    return { items, next: rows.length > 10 ? items.at(-1) : undefined }
  },
  create: (groupId: string, value: NewReadingChallenge) => change(groupId, 'create', { ...value }),
  cancel: (groupId: string, id: string) => change(groupId, 'cancel', { id }),
  progress: (groupId: string, challenge: ReadingChallenge, requestId: string, page: number | null) => change(groupId, 'progress', {
    id: challenge.id, membershipSince: challenge.membershipSince, revision: challenge.myRevision, requestId, page,
  }),
}
