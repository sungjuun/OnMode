import { useState, type FormEvent } from 'react'
import { ArrowRight, Database, LogOut, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
import { supabase } from '../data/supabase'
import { useApp } from '../state/context'
import { Card, CardTitle, ErrorState, Field, PageTitle, messageOf } from '../ui/base'

export function Account() {
  const { session, snapshot, notify } = useApp()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
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
  return <div className="page-stack account-page"><PageTitle label="YOUR ACCOUNT" title="계정 관리" description="계정을 연결하면 기록을 서버에 저장하고 스터디에 참여할 수 있어요." />
    <Card><CardTitle icon={session ? ShieldCheck : Database} title={session ? '계정 연결됨' : supabase ? '온모드 계정' : '로컬 체험 모드'} sub={session?.user.email} />
      {issue && <ErrorState message={issue} />}
      {session ? <><p className="muted mt-4">로컬 체험 기록과 계정 기록은 각각 보관돼요. 로그아웃하면 체험 기록으로 돌아갑니다.</p><button className="btn btn-soft mt-5" disabled={busy || !!snapshot?.timer} onClick={() => void signOut()}><LogOut size={17} />로그아웃</button>{snapshot?.timer && <p className="muted mt-2">집중을 종료한 뒤 로그아웃할 수 있어요.</p>}</>
        : supabase ? <><div className="segmented mt-5"><button aria-pressed={mode === 'login'} onClick={() => setMode('login')}>로그인</button><button aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>회원가입</button></div><form className="form-stack" onSubmit={e => void submit(e)}><Field label="이메일"><input name="email" type="email" autoComplete="email" required /></Field><Field label="비밀번호"><input name="password" type="password" minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></Field><button className="btn btn-primary" disabled={busy || !!snapshot?.timer}>{mode === 'login' ? '로그인' : '가입하기'}</button>{snapshot?.timer && <p className="muted">체험 중인 집중을 종료한 뒤 계정을 연결해 주세요.</p>}</form></>
        : <div className="connection-help"><p>집중, 학습·독서, 공부방 기록은 이 브라우저에 저장돼요.</p><details><summary>개발 환경에서 계정 연결하기</summary><p>Supabase에 저장소의 SQL 마이그레이션을 적용하고 <code>.env.local</code>에 <code>VITE_SUPABASE_URL</code>과 <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>를 설정한 뒤 개발 서버를 다시 시작하세요.</p></details><Link className="btn btn-primary" to="/">체험 계속하기<ArrowRight size={17} /></Link></div>}
    </Card>
  </div>
}
