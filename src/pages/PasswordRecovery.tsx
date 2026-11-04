import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { Link } from 'react-router'
import { openPasswordReset } from '../data/recovery'
import { Card, CardTitle, ErrorState, Field, Loading, PageTitle } from '../ui/base'

type Reset = Awaited<ReturnType<typeof openPasswordReset>>
const invalidLink = '링크가 만료됐거나 이미 사용됐어요. 재설정을 요청한 브라우저에서 새 링크를 열어 주세요.'

export function PasswordRecovery() {
  const [reset, setReset] = useState<Reset | null>(null)
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid' | 'done'>('checking')
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  useEffect(() => {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')
    const flowId = url.searchParams.get('sb_flow_id') ?? undefined
    window.history.replaceState(window.history.state, '', url.pathname)
    if (!code) { setStatus('invalid'); return }

    let active = true
    const pending = openPasswordReset(code, flowId)
    void pending.then(value => {
      if (active) { setReset(value); setStatus('ready') }
    }).catch(() => { if (active) setStatus('invalid') })
    return () => { active = false; void pending.then(value => value.close()).catch(() => undefined) }
  }, [])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!reset || busy) return
    const form = new FormData(e.currentTarget)
    const password = String(form.get('password'))
    if (password !== form.get('confirm')) { setIssue('두 비밀번호가 일치하지 않아요.'); return }
    setBusy(true); setIssue('')
    try {
      await reset.update(password)
      setStatus('done')
      void reset.close().catch(() => undefined)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
      if (code === 'session_not_found' || code === 'session_expired') setStatus('invalid')
      else setIssue(code === 'same_password' ? '기존 비밀번호와 다른 비밀번호를 입력해 주세요.'
        : code === 'weak_password' ? '보안 기준을 충족하는 새 비밀번호를 입력해 주세요.'
        : '비밀번호를 변경하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally { setBusy(false) }
  }

  return <div className="page-stack account-page">
    <PageTitle label="YOUR ACCOUNT" title="비밀번호 재설정" description="온모드 계정에서 사용할 새 비밀번호를 설정하세요." />
    <Card><CardTitle icon={KeyRound} title={status === 'done' ? '비밀번호를 변경했어요' : '비밀번호 변경'} />
      {status === 'checking' && <Loading />}
      {status === 'invalid' && <><ErrorState message={invalidLink} /><Link className="btn btn-primary mt-3" to="/account?mode=reset" replace>재설정 다시 요청</Link></>}
      {status === 'done' && <Link className="btn btn-primary mt-4" to="/account" replace>로그인 화면으로</Link>}
      {status === 'ready' && <form className="form-stack" onSubmit={e => void submit(e)}>
        {issue && <ErrorState message={issue} />}
        <Field label="새 비밀번호 (8자 이상)"><input type="password" name="password" required minLength={8} autoComplete="new-password" /></Field>
        <Field label="새 비밀번호 확인"><input type="password" name="confirm" required minLength={8} autoComplete="new-password" /></Field>
        <button className="btn btn-primary" disabled={busy}>{busy ? '변경 중…' : '비밀번호 변경'}</button>
      </form>}
    </Card>
  </div>
}
