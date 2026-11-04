import { useEffect, useState, type FormEvent } from 'react'
import { BookOpen, Plus, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { groupLibrary, LibraryConflict, type LibraryPage, type SharedBook } from '../data/groupLibrary'
import { useApp, useSnapshot } from '../state/context'
import { Dialog, Empty, ErrorState, Field, Loading, messageOf } from './base'
import { SharedLibraryRoom } from './SharedLibraryRoom'

type Editor = { kind: 'create'; id: string } | { kind: 'delete'; book: SharedBook }

export function StudyLibrary({ groupId, isOwner, revision }: { groupId: string; isOwner: boolean; revision: number }) {
  const { notify, reload } = useApp()
  const snapshot = useSnapshot()
  const [data, setData] = useState<LibraryPage | null>(null)
  const [pages, setPages] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [issue, setIssue] = useState('')
  const [formIssue, setFormIssue] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState('')
  const [pendingImports] = useState(() => new Map<string, string>())
  const ownBooks = snapshot.activities.filter(a => a.kind === 'book')
  const update = () => setRefresh(n => n + 1)
  useEffect(() => {
    let active = true
    setLoading(true)
    async function load() {
      const visible = await groupLibrary.list(groupId)
      for (let i = 1; i < pages && visible.next; i++) {
        const page = await groupLibrary.list(groupId, visible.next)
        visible.items.push(...page.items); visible.next = page.next
      }
      if (active) { setData(visible); setIssue('') }
    }
    void load().catch(error => { if (active) setIssue(messageOf(error)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [groupId, pages, revision, refresh])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || busy || !isOwner) return
    const activityId = String(new FormData(event.currentTarget).get('activity') ?? '')
    setBusy(true); setFormIssue('')
    try {
      if (editor.kind === 'create') await groupLibrary.create(groupId, editor.id, activityId)
      else await groupLibrary.delete(groupId, editor.book.id)
      setEditor(null); update(); notify(editor.kind === 'create' ? '공동 도서관에 책을 등록했어요.' : '공동 도서 목록에서 제거했어요.')
    } catch (error) { setFormIssue(messageOf(error)) } finally { setBusy(false) }
  }
  async function bring(book: SharedBook) {
    if (importing) return
    setImporting(book.id); setIssue('')
    const id = pendingImports.get(book.id) ?? crypto.randomUUID()
    pendingImports.set(book.id, id)
    try {
      const result = await groupLibrary.import(groupId, book.id, id)
      setData(current => current ? { ...current, items: current.items.map(b => b.id === book.id ? { ...b, myActivityId: result.id } : b) } : current)
      reload(); notify('내 서재에 준비됐어요. 독서를 시작해 보세요.')
    } catch (error) { notify(messageOf(error), true); if (error instanceof LibraryConflict) update() }
    finally { setImporting('') }
  }
  return <section className="study-library" aria-label="공동 도서관">
    <div className="challenges-heading"><div><h2><BookOpen size={17} aria-hidden />공동 도서관</h2><p className="muted text-sm">함께 읽을 책을 모으고 같은 공간을 꾸며요.</p></div>
      {isOwner && <button className="btn btn-soft" onClick={() => { setFormIssue(''); setEditor({ kind: 'create', id: crypto.randomUUID() }) }}><Plus size={15} />공동 도서 등록</button>}
    </div>
    {issue && <ErrorState message={issue} retry={update} />}
    {!data ? !issue && <Loading /> : <>
      <SharedLibraryRoom groupId={groupId} room={data.room} saved={room => { setData(current => current ? { ...current, room } : current); update() }} refresh={update} />
      {data.items.length === 0 ? <Empty icon={BookOpen} title="함께 읽을 책을 등록해 보세요" description={isOwner ? '내 서재에서 책을 골라 그룹 멤버와 공유할 수 있어요.' : '그룹장이 등록한 책을 내 서재로 가져와 함께 읽을 수 있어요.'} />
        : <div className="shared-books">{data.items.map(book => <article className="shared-book" key={book.id} aria-label={book.name}>
          <h3>{book.name}</h3><p>{book.author} · {book.pages}쪽</p>{book.isbn && <p className="muted text-xs">ISBN {book.isbn}</p>}
          <div className="row-actions">{book.myActivityId ? <><span className="badge badge-mint">내 서재에 있음</span>{snapshot.activities.some(a => a.id === book.myActivityId) ? <Link className="btn btn-soft" to={'/focus?activity=' + book.myActivityId}>이 책으로 집중</Link> : <button className="btn btn-soft" onClick={reload}>서재 다시 불러오기</button>}</>
            : <button className="btn btn-soft" disabled={!!importing} onClick={() => void bring(book)}>{importing === book.id ? '가져오는 중…' : '내 서재로 가져오기'}</button>}
            {isOwner && <button className="btn btn-quiet" onClick={() => { setFormIssue(''); setEditor({ kind: 'delete', book }) }}><Trash2 size={14} />공동 도서 제거</button>}</div>
        </article>)}</div>}
      {data.next && <button className="btn btn-soft mt-3" disabled={loading} onClick={() => setPages(n => n + 1)}>공동 도서 더 보기</button>}
      <p className="muted text-xs mt-3">가져온 책의 독서 진도와 노트는 개인 서재에서 관리해요.</p>
    </>}
    {editor && <Dialog title={editor.kind === 'create' ? '공동 도서 등록' : '공동 도서 제거'} close={() => { if (!busy) setEditor(null) }}>
      <form className="form-stack" onSubmit={event => void submit(event)}>
        {formIssue && <ErrorState message={formIssue} />}
        {editor.kind === 'create' ? <><p className="muted text-sm">선택한 책의 제목·저자·페이지 수·ISBN을 그룹 멤버에게 공유합니다.</p>
          {ownBooks.length ? <Field label="공유할 내 서재 도서"><select name="activity" required disabled={busy}>{ownBooks.map(book => <option key={book.id} value={book.id}>{book.name} · {book.author}</option>)}</select></Field> : <p>내 서재에 등록한 도서가 없어요. <Link className="text-link" to="/library?tab=books">서재에서 도서 등록</Link></p>}</>
          : <p>공동 목록에서 <strong>{editor.book.name}</strong>을 제거할까요? 멤버가 개인 서재로 가져온 책과 기록은 유지됩니다.</p>}
        <div className="row-actions"><button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setEditor(null)}>취소</button><button className={'btn ' + (editor.kind === 'delete' ? 'btn-danger' : 'btn-primary')} disabled={busy || editor.kind === 'create' && !ownBooks.length}>{busy ? '처리 중…' : editor.kind === 'create' ? '공유하기' : '제거 확정'}</button></div>
      </form>
    </Dialog>}
  </section>
}
