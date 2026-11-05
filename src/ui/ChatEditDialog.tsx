import { useRef, useState, type FormEvent } from 'react'
import { chat, ChatConflict, type ChatMessage } from '../data/chat'
import { Dialog, ErrorState, Field, messageOf } from './base'

export function ChatEditDialog({ groupId, message, close, saved }: {
  groupId: string; message: ChatMessage; close: () => void; saved: () => void;
}) {
  const [body, setBody] = useState(message.body ?? '')
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  const [conflict, setConflict] = useState(false)
  const pending = useRef<{ id: string; body: string } | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = body.trim()
    if (busy || conflict || !text || text === message.body) return
    if (pending.current?.body !== text) pending.current = { id: crypto.randomUUID(), body: text }
    setBusy(true); setIssue('')
    try {
      await chat.edit(groupId, message.id, message.version, pending.current.id, text)
      saved()
    } catch (error) { setIssue(messageOf(error)); setConflict(error instanceof ChatConflict) }
    finally { setBusy(false) }
  }
  return <Dialog title="메시지 수정" close={() => { if (!busy) close() }}>
    <form className="form-stack" onSubmit={event => void submit(event)}>
      <p className="muted text-sm">저장하면 그룹 멤버에게 수정된 내용이 표시돼요.</p>
      {issue && <ErrorState message={issue} />}
      <Field label="수정할 메시지"><textarea rows={5} required maxLength={2000} value={body} disabled={busy} onChange={event => setBody(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
      }} /></Field>
      <p className="muted text-xs">{body.length}/2,000 · Ctrl / ⌘ + Enter로 저장</p>
      {conflict ? <>
        <p className="muted text-sm">작성 중인 내용은 이 창에 남아 있어요. 필요한 내용을 복사한 뒤 최신 대화를 확인해 주세요.</p>
        <button type="button" className="btn btn-soft" onClick={close}>수정 취소하고 최신 대화 보기</button>
      </> : <div className="row-actions">
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={close}>취소</button>
        <button className="btn btn-primary" disabled={busy || !body.trim() || body.trim() === message.body}>{busy ? '저장 중…' : issue ? '다시 저장' : '저장'}</button>
      </div>}
    </form>
  </Dialog>
}
