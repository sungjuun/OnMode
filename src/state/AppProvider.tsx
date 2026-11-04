import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { cloudRepository, supabase } from '../data/supabase'
import { loadBreak, localRepository, saveBreak } from '../data/local'
import { type BreakTimer, type Command, type View } from '../domain/model'
import { duration } from '../domain/stats'
import { isDue, nextBreak } from '../domain/timer'
import { webNotifications } from '../data/webNotifications'
import { messageOf, Toast } from '../ui/base'
import { AppContext } from './context'

const local = localRepository()

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!supabase)
  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => {
      setSession(current)
      setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])
  return <Workspace key={session?.user.id ?? 'guest'} session={session} ready={ready}>{children}</Workspace>
}

function Workspace({ children, session, ready }: { children: ReactNode; session: Session | null; ready: boolean }) {
  const repo = session ? cloudRepository : local
  const connected = !!session
  const key = session?.user.id ?? 'guest'
  const [snapshot, setSnapshot] = useState<View['snapshot'] | null>(null)
  const [now, setNow] = useState(Date.now)
  const [issue, setIssue] = useState('')
  const [rest, setRest] = useState<BreakTimer | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null)
  const inFlight = useRef(false)
  const loadSequence = useRef(0)
  const autoRetry = useRef(0)
  const channel = useRef<BroadcastChannel | null>(null)
  const clock = useRef<{ server: number; monotonic: number } | null>(null)
  const getNow = useCallback(() => clock.current ? clock.current.server + performance.now() - clock.current.monotonic : Date.now(), [])
  const invalidate = useCallback(() => { loadSequence.current++ }, [])
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), [])
  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 5200)
    return () => window.clearTimeout(timeout)
  }, [toast])
  const apply = useCallback((view: View, sent: number) => {
    if (view.serverTime !== undefined) clock.current = { server: view.serverTime + (performance.now() - sent) / 2, monotonic: performance.now() }
    setNow(getNow())
    setSnapshot(view.snapshot)
    setIssue('')
  }, [getNow])
  const reload = useCallback(() => {
    if (!ready || inFlight.current) return
    const sequence = ++loadSequence.current, sent = performance.now()
    void Promise.all([repo.load(), loadBreak(key).catch(() => undefined)]).then(([view, savedBreak]) => {
      if (sequence !== loadSequence.current) return
      apply(view, sent)
      setRest(savedBreak && savedBreak.endAt > getNow() ? savedBreak : null)
    }).catch(e => { if (sequence === loadSequence.current) setIssue(messageOf(e)) })
  }, [ready, repo, key, apply, getNow])
  useEffect(() => {
    reload()
    const sync = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('onmode:' + key)
      channel.current.onmessage = reload
    }
    const poll = connected ? window.setInterval(sync, 30000) : undefined
    return () => {
      invalidate()
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
      channel.current?.close()
      channel.current = null
      window.clearInterval(poll)
    }
  }, [connected, invalidate, key, reload])
  useEffect(() => {
    const tick = window.setInterval(() => setNow(getNow()), snapshot?.timer || rest ? 250 : 15000)
    return () => window.clearInterval(tick)
  }, [getNow, snapshot?.timer, rest])
  const endRest = useCallback(() => {
    setRest(null)
    void saveBreak(key, null).then(() => channel.current?.postMessage('change')).catch(e => notify(messageOf(e), true))
  }, [key, notify])
  const run = useCallback(async (command: Command, success?: string) => {
    if (inFlight.current) return false
    inFlight.current = true
    loadSequence.current++
    setBusy(true)
    const sent = performance.now()
    try {
      const view = await repo.execute(command)
      apply(view, sent)
      if (command.type === 'finish' && snapshot?.timer?.id === command.id && view.snapshot.timer?.id !== command.id) {
        const record = view.snapshot.records.find(r => r.id === command.id)
        const following = nextBreak(snapshot.timer, view.snapshot)
        if (following && following.endAt > getNow()) {
          setRest(following)
          await saveBreak(key, following).catch(() => undefined)
        }
        if (record) notify(duration(record.seconds) + ' 기록 완료 · +' + record.xp + ' XP · +' + record.coins + ' 코인')
        else notify('집중 시간이 1초 미만이라 기록하지 않았어요.')
        if (record && isDue(snapshot.timer, getNow()) && view.snapshot.profile.notifications) webNotifications.finished()
      } else if (success) notify(success)
      channel.current?.postMessage('change')
      return true
    } catch (e) {
      autoRetry.current = Date.now() + 5000
      notify(messageOf(e), true)
      return false
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }, [apply, getNow, key, notify, repo, snapshot])
  useEffect(() => {
    if (rest && now >= rest.endAt) endRest()
    if (snapshot?.timer && isDue(snapshot.timer, now) && Date.now() >= autoRetry.current) {
      void run({ type: 'finish', id: snapshot.timer.id })
    }
  }, [endRest, now, rest, run, snapshot?.timer])
  return <AppContext.Provider value={{ session, authReady: ready, snapshot, now, busy, issue, rest, reload, run, endRest, notify }}>
    {children}{toast && <Toast {...toast} close={() => setToast(null)} />}
  </AppContext.Provider>
}
