import { useRef, useState, type FormEvent } from 'react'
import { BookSearchPanel } from './BookSearchPanel'
import { normalizeIsbn } from '../domain/isbn'
import { useApp, useSnapshot } from '../state/context'
import { Dialog, Field } from './base'

export function BookRegistrationDialog({ close }: { close: () => void }) {
  const { run, busy } = useApp()
  const snapshot = useSnapshot()
  const [id] = useState(() => crypto.randomUUID())
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ title: '', author: '', pages: '', isbn: '' })
  const title = useRef<HTMLInputElement>(null)
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const isbn = draft.isbn.trim() ? normalizeIsbn(draft.isbn) : undefined
    if (isbn === null) { setError('ISBN 10자리 또는 13자리와 마지막 확인 숫자를 확인해 주세요.'); return }
    if (!draft.title.trim() || !draft.author.trim() || draft.title.trim().length > 80 || draft.author.trim().length > 80) {
      setError('책 제목과 저자를 각각 1~80자로 입력해 주세요.'); return
    }
    if (isbn && snapshot.activities.some(a => a.isbn === isbn && a.id !== id)) { setError('이미 서재에 등록한 ISBN입니다.'); return }
    const goalPages = Number(new FormData(e.currentTarget).get('goal'))
    const success = await run({ type: 'activity', value: { id, kind: 'book', name: draft.title.trim(), author: draft.author.trim(), pages: Number(draft.pages), goalPages, currentPage: 0, ...(isbn ? { isbn } : {}) } }, '서재에 책을 추가했어요.')
    if (success) close()
    else setError('저장하지 못했어요. 입력 내용은 유지됩니다. 안내를 확인하고 다시 시도해 주세요.')
  }
  return <Dialog title="도서 등록" close={close}>
    <BookSearchPanel disabled={busy} onChoose={book => {
      setDraft({ title: book.title, author: book.author, pages: String(book.pages ?? ''), isbn: book.isbn ?? '' }); setError('')
      requestAnimationFrame(() => title.current?.focus())
    }} />
    <form className="form-stack" onSubmit={e => void save(e)}>
      <h3>도서 정보 직접 입력·확인</h3>
      <Field label="책 제목"><input ref={title} name="name" required maxLength={80} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></Field>
      <Field label="저자"><input name="author" required maxLength={80} value={draft.author} onChange={e => setDraft({ ...draft, author: e.target.value })} /></Field>
      <div className="form-grid"><Field label="총 페이지"><input name="pages" type="number" min="1" max="100000" required value={draft.pages} onChange={e => setDraft({ ...draft, pages: e.target.value })} /></Field><Field label="일일 목표 (쪽)"><input name="goal" type="number" min="1" max="100000" defaultValue="10" required /></Field></div>
      <Field label="ISBN (선택)"><input value={draft.isbn} onChange={e => setDraft({ ...draft, isbn: e.target.value })} maxLength={40} autoComplete="off" /></Field>
      <p className="muted text-sm">검색 정보는 판본에 따라 다를 수 있어요. 정보가 없으면 직접 입력하세요. ISBN 없이도 등록할 수 있어요.</p>
      {error && <p role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>저장</button>
    </form>
  </Dialog>
}
