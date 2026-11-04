import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { deleteAccount, deletionConfirmation } from '../data/deleteAccount'
import { Dialog, ErrorState, Field, messageOf } from './base'

export function DeleteAccountDialog({ user, close, complete }: {
  user: { id: string; email: string }; close: () => void; complete: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [issue, setIssue] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || confirmation !== deletionConfirmation) return
    const password = String(new FormData(event.currentTarget).get('password'))
    setBusy(true); setIssue('')
    try {
      await deleteAccount(user, password, confirmation)
      await complete()
    } catch (error) { setIssue(messageOf(error)) }
    finally { setBusy(false) }
  }
  return <Dialog title="계정 영구 삭제" close={() => { if (!busy) close() }}>
    <p className="muted mt-3 text-sm">집중 기록, 학습·독서 기록, 보상, 그룹에 기여한 시간과 내가 보낸 채팅이 삭제됩니다. 그룹장은 다음 멤버에게 넘어가며, 공유 그룹의 공지는 남습니다. 혼자 남은 그룹은 삭제됩니다. 이 브라우저의 체험 기록은 계속 사용할 수 있습니다.</p>
    <form className="form-stack" onSubmit={e => void submit(e)}>
      {issue && <ErrorState message={issue} />}
      <Field label="현재 비밀번호"><input name="password" type="password" required autoComplete="current-password" disabled={busy} /></Field>
      <Field label="삭제 확인 문구"><input required autoComplete="off" placeholder={deletionConfirmation} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></Field>
      <p className="muted text-sm">삭제하려면 <strong>{deletionConfirmation}</strong>를 그대로 입력하세요.</p>
      <div className="row-actions">
        <button type="button" className="btn btn-quiet" onClick={close} disabled={busy}>취소</button>
        <button className="btn btn-danger" disabled={busy || confirmation !== deletionConfirmation}><Trash2 size={16} />{busy ? '삭제 중…' : '계정 영구 삭제'}</button>
      </div>
    </form>
  </Dialog>
}
