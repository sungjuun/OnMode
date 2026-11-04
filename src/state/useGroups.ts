import { useEffect, useState } from 'react'
import { groups, type Group } from '../data/supabase'

export function useJoinedGroups(userId: string | undefined) {
  const [result, setResult] = useState<{ id: string; groups: Group[] | null } | null>(null)
  useEffect(() => {
    if (!userId) return
    let active = true
    void groups.list().then(list => {
      if (active) setResult({ id: userId, groups: list.filter(group => group.role) })
    }).catch(() => { if (active) setResult({ id: userId, groups: null }) })
    return () => { active = false }
  }, [userId])
  return result?.id === userId ? result?.groups : undefined
}
