import { useState, type FormEvent } from 'react'
import { Capacitor } from '@capacitor/core'
import { ArrowRight, Database, KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { supabase } from '../data/supabase'
import { saveBreak } from '../data/local'
import { requestPasswordReset } from '../data/recovery'
import { useApp } from '../state/context'
import { Card, CardTitle, ErrorState, Field, PageTitle, messageOf } from '../ui/base'
import { DeleteAccountDialog } from '../ui/DeleteAccountDialog'

export function Account() {
  const { authReady, session, snapshot, notify } = useApp()
  const navigate = useNavigate()
  const { state } = useLocation()
  const [params, setParams] = useSearchParams()
  const resetting = !!supabase && !Capacitor.isNativePlatform() && params.get('mode') === 'reset'
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  const [sent, setSent] = useState(false)
  const [deleting, setDeleting] = useState(false)
  function showReset(open: boolean) {
    setIssue(''); setSent(false)
    setParams(open ? { mode: 'reset' } : {}, { replace: true })
  }
  async function sendReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    const email = String(new FormData(e.currentTarget).get('email')).trim()
    setIssue(''); setBusy(true)
    try {
      await requestPasswordReset(email)
      setSent(true)
    } catch {
      setIssue('메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally { setBusy(false) }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!supabase) return
    const data = new FormData(e.currentTarget), email = String(data.get('email')).trim(), password = String(data.get('password'))
    setIssue(''); setBusy(true)
    try {
      const response = mode === 'login' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
      if (response.error) throw response.error
      notify(response.data.session ? '계정이 연결됐어요.' : '확인 이메일을 보냈어요. 이메일 인증을 완료해 주세요.')
    } catch (e) { setIssue(messageOf(e)) } finally { setBusy(false) }
  }
  async function signOut() {
    if (!supabase) return
    setBusy(true); setIssue('')
    try { const { error } = await supabase.auth.signOut({ scope: 'local' }); if (error) throw error }
    catch (e) { setIssue(messageOf(e)) } finally { setBusy(false) }
  }
  async function finishDeletion() {
    if (!supabase || !session) return
    void saveBreak(session.user.id, null).catch(() => undefined)
    const signedOut = await supabase.auth.signOut({ scope: 'local' }).catch(() => ({ error: true }))
    setDeleting(false)
    if (signedOut.error) setIssue('계정은 삭제됐어요. 브라우저의 계정 연결을 해제하려면 로그아웃을 다시 시도해 주세요.')
    else void navigate('/account', { replace: true, state: { accountDeleted: true } })
  }
  return <div className="page-stack account-page"><PageTitle label="YOUR ACCOUNT" title="계정 관리" description="계정을 연결하면 기록을 서버에 저장하고 스터디에 참여할 수 있어요." />
    <Card><CardTitle icon={resetting ? KeyRound : session ? ShieldCheck : Database} title={resetting ? '비밀번호 재설정 메일 받기' : session ? '계정 연결됨' : supabase ? '온모드 계정' : '로컬 체험 모드'} sub={resetting ? undefined : session?.user.email} />
      {issue && <ErrorState message={issue} />}
      {!session && state?.accountDeleted && <p className="muted mt-4" role="status">계정이 삭제됐어요. 체험 모드는 계속 이용할 수 있어요.</p>}
      {resetting ? <div className="form-stack">
        {sent ? <p className="muted" role="status">가입된 이메일이면 재설정 링크가 발송됩니다. 메일함을 확인하고, 요청한 브라우저에서 링크를 열어 주세요.</p>
          : <form className="grid gap-3" onSubmit={e => void sendReset(e)}>
            <Field label="가입 이메일"><input name="email" type="email" autoComplete="email" required /></Field>
            <button className="btn btn-primary justify-self-start" disabled={busy}>{busy ? '보내는 중…' : '재설정 링크 보내기'}</button>
          </form>}
        <button className="btn btn-quiet" disabled={busy} onClick={() => showReset(false)}>계정 화면으로</button>
      </div>
        : session ? <><p className="muted mt-4">로컬 체험 기록과 계정 기록은 각각 보관돼요. 로그아웃하면 체험 기록으로 돌아갑니다.</p><button className="btn btn-soft mt-5" disabled={busy || !!snapshot?.timer} onClick={() => void signOut()}><LogOut size={17} />로그아웃</button>{snapshot?.timer && <p className="muted mt-2">집중을 종료한 뒤 로그아웃할 수 있어요.</p>}</>
        : supabase ? <><div className="segmented mt-5"><button disabled={busy} aria-pressed={mode === 'login'} onClick={() => { setIssue(''); setMode('login') }}>로그인</button><button disabled={busy} aria-pressed={mode === 'signup'} onClick={() => { setIssue(''); setMode('signup') }}>회원가입</button></div><form className="form-stack" onSubmit={e => void submit(e)}><Field label="이메일"><input name="email" type="email" autoComplete="email" required /></Field><Field label="비밀번호"><input name="password" type="password" minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></Field><button className="btn btn-primary" disabled={!authReady || busy || !!snapshot?.timer}>{mode === 'login' ? '로그인' : '가입하기'}</button>{snapshot?.timer && <p className="muted">체험 중인 집중을 종료한 뒤 계정을 연결해 주세요.</p>}</form>{mode === 'login' && !Capacitor.isNativePlatform() && <button className="btn btn-quiet mt-2" disabled={busy} onClick={() => showReset(true)}>비밀번호를 잊었나요?</button>}</>
        : <div className="connection-help"><p>집중, 학습·독서, 공부방 기록은 이 브라우저에 저장돼요.</p><details><summary>개발 환경에서 계정 연결하기</summary><p>Supabase에 저장소의 SQL 마이그레이션을 적용하고 <code>.env.local</code>에 <code>VITE_SUPABASE_URL</code>과 <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>를 설정한 뒤 개발 서버를 다시 시작하세요.</p></details><Link className="btn btn-primary" to="/">체험 계속하기<ArrowRight size={17} /></Link></div>}
    </Card>
    {!resetting && session?.user.email && <Card>
      <CardTitle title="계정 삭제" sub="계정과 서버에 저장된 개인 기록을 영구 삭제합니다." />
      <button className="btn btn-danger-soft mt-4" disabled={busy} onClick={() => setDeleting(true)}>계정 삭제 시작</button>
      {deleting && <DeleteAccountDialog user={{ id: session.user.id, email: session.user.email }} close={() => setDeleting(false)} complete={finishDeletion} />}
    </Card>}
  </div>
}
