import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Snapshot, Command, BreakTimer } from '../domain/model'

export interface AppState {
  session: Session | null; authReady: boolean; snapshot: Snapshot | null; now: number;
  busy: boolean; issue: string; rest: BreakTimer | null; reload: () => void;
  run: (command: Command, success?: string) => Promise<boolean>;
  endRest: () => void; notify: (message: string, error?: boolean) => void;
}
export const AppContext = createContext<AppState | null>(null)
export function useApp() {
  const state = useContext(AppContext)
  if (!state) throw Error('AppContext is missing')
  return state
}
export function useSnapshot() {
  const { snapshot } = useApp()
  if (!snapshot) throw Error('Snapshot is missing')
  return snapshot
}
