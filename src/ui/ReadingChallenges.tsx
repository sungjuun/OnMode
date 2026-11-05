import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, Flag, Plus } from 'lucide-react'
import type { SharedBook } from '../data/groupLibrary'
import { readingChallenges, ReadingChallengeConflict, type ReadingChallenge } from '../data/readingChallenges'
import { dayKey, percent, shiftDay } from '../domain/stats'
import { useApp } from '../state/context'
import { Dialog, ErrorState, Field, Loading, messageOf, Progress } from './base'

const labels = { scheduled: '시작 예정', active: '진행 중', ended: '기간 종료', cancelled: '취소됨' }
type Editor = { kind: 'create'; id: string } | { kind: 'progress' | 'withdraw' | 'cancel'; challenge: ReadingChallenge }
const titles = { create: '독서 도전 만들기', progress: '도전 진도 기록', withdraw: '도전 진도 삭제', cancel: '독서 도전 취소' }

export function ReadingChallenges({ groupId, isOwner, books, revision }: {
  groupId: string; isOwner: boolean; books: SharedBook[]; revision: number;
}) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [list, setList] = useState<ReadingChallenge[] | null>(null)
  const [issue, setIssue] = useState('')
  const [pages, setPages] = useState(1)
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const update = () => setRefresh(n => n + 1)
  useEffect(() => {
    let live = true
    setLoading(true)
    async function load() {
      const items: ReadingChallenge[] = []
      let cursor: ReadingChallenge | undefined
      for (let i = 0; i < pages; i++) {
        const result = await readingChallenges.list(groupId, cursor)
        if (!live) return
        items.push(...result.items)
        cursor = result.next
        if (!cursor) break
      }
      setList(items); setMore(!!cursor); setIssue('')
    }
    void load().catch(error => { if (live) { setList(null); setMore(false); setIssue(messageOf(error)) } })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [groupId, pages, revision, refresh])

  return <section className="challenges-section" aria-label="기간별 독서 도전">
    <div className="challenges-heading">
      <div><h2><Flag size={17} aria-hidden />기간별 독서 도전</h2><p className="muted text-sm">기간을 정하고 같은 책의 목표 페이지까지 함께 읽어요.</p></div>
      {isOwner && <button className="btn btn-soft" onClick={() => setEditor({ kind: 'create', id: crypto.randomUUID() })}><Plus size={15} />독서 도전 만들기</button>}
    </div>
    {issue ? <ErrorState message={issue} retry={update} /> : list === null ? <Loading /> : list.length === 0
      ? <p className="muted text-sm mt-3">아직 등록된 독서 도전이 없어요.</p>
      : <div className="challenges-list">{list.map(challenge => <article className="challenge-card" key={challenge.id} aria-label={challenge.bookName + ' 독서 도전'}>
        <div className="challenge-title"><h3>{challenge.bookName}</h3><span className={'badge ' + (challenge.status === 'active' ? 'badge-mint' : '')}>{labels[challenge.status]}</span></div>
        <p className="challenge-dates"><CalendarDays size={13} aria-hidden />{challenge.startDate} ~ {challenge.endDate}<span>· {challenge.timeZone}</span></p>
        <p className="text-sm mt-3"><strong>{challenge.targetPage}쪽까지 함께 읽기</strong> · {challenge.participants}명 참여 · {challenge.achieved}명 달성</p>
        <Progress value={percent(challenge.achieved, challenge.participants)} label={challenge.bookName + ' 도전 참여자 달성률'} />
        <p className="muted text-sm mt-3">{challenge.myPage === null ? '내가 기록한 도전 진도가 없어요.' : `내 도전 진도 ${challenge.myPage}쪽 / ${challenge.targetPage}쪽${challenge.myPage >= challenge.targetPage ? ' · 달성' : ''}`}</p>
        <div className="row-actions">
          {challenge.status === 'active' && <button className="btn btn-soft" onClick={() => setEditor({ kind: 'progress', challenge })}>{challenge.myPage === null ? '도전 진도 기록' : '도전 진도 수정'}</button>}
          {challenge.myPage !== null && <button className="btn btn-quiet" onClick={() => setEditor({ kind: 'withdraw', challenge })}>도전 진도 삭제</button>}
          {isOwner && (challenge.status === 'active' || challenge.status === 'scheduled') && <button className="btn btn-quiet" onClick={() => setEditor({ kind: 'cancel', challenge })}>독서 도전 취소</button>}
        </div>
      </article>)}</div>}
    {more && <button className="btn btn-soft mt-3" disabled={loading} onClick={() => setPages(n => n + 1)}>독서 도전 더 보기</button>}
    {editor && <ReadingChallengeDialog groupId={groupId} books={books} editor={editor} close={() => { setEditor(null); update() }} />}
  </section>
}

function ReadingChallengeDialog({ groupId, books, editor, close }: {
  groupId: string; books: SharedBook[]; editor: Editor; close: () => void;
}) {
  const { now, notify } = useApp()
  const [bookId, setBookId] = useState(books[0]?.id ?? '')
  const [target, setTarget] = useState(String(books[0]?.pages ?? ''))
  const [issue, setIssue] = useState('')
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef<{ page: number | null; id: string } | null>(null)
  const book = books.find(item => item.id === bookId)
  const today = dayKey(now)
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || conflict) return
    const form = new FormData(event.currentTarget)
    setBusy(true); setIssue('')
    try {
      if (editor.kind === 'create') {
        if (!book) throw Error('공동 도서를 선택해 주세요.')
        await readingChallenges.create(groupId, { id: editor.id, bookId, targetPage: Number(target),
          startDate: String(form.get('start')), endDate: String(form.get('end')), timeZone })
        notify('기간별 독서 도전을 만들었어요.')
      } else if (editor.kind === 'cancel') {
        await readingChallenges.cancel(groupId, editor.challenge.id)
        notify('독서 도전을 취소했어요.')
      } else {
        const page = editor.kind === 'withdraw' ? null : Number(form.get('page'))
        if (!pending.current || pending.current.page !== page) pending.current = { page, id: crypto.randomUUID() }
        await readingChallenges.progress(groupId, editor.challenge, pending.current.id, page)
        notify(page === null ? '내 도전 진도를 삭제했어요.' : '독서 도전 진도를 기록했어요.')
      }
      close()
    } catch (error) {
      setIssue(messageOf(error))
      setConflict(error instanceof ReadingChallengeConflict)
    } finally { setBusy(false) }
  }

  return <Dialog title={titles[editor.kind]} close={() => { if (!busy) close() }}>
    <form className="form-stack" onSubmit={event => void submit(event)}>
      {issue && <ErrorState message={issue} />}
      {editor.kind === 'create' ? <>
        <Field label="도전에 사용할 공동 도서"><select required value={bookId} disabled={busy} onChange={event => {
          const selected = books.find(item => item.id === event.target.value)
          if (selected) { setBookId(selected.id); setTarget(String(selected.pages)) }
        }}><option value="" disabled>책을 선택하세요</option>{books.map(item => <option key={item.id} value={item.id}>{item.name} · {item.author}</option>)}</select></Field>
        <Field label="도전 목표 페이지"><input type="number" min="1" max={book?.pages} required value={target} disabled={busy} onChange={event => setTarget(event.target.value)} /></Field>
        <div className="form-grid">
          <Field label="시작일"><input name="start" type="date" required min={today} defaultValue={today} disabled={busy} /></Field>
          <Field label="종료일"><input name="end" type="date" required min={today} defaultValue={dayKey(shiftDay(now, 6))} disabled={busy} /></Field>
        </div>
        <p className="muted text-sm">종료일을 포함해 최대 90일이에요. 기간은 {timeZone} 시간대를 기준으로 계산해요.</p>
      </> : <>
        <p className="text-sm font-bold">{editor.challenge.bookName}</p>
        {editor.kind === 'progress' ? <>
          <p className="muted text-sm">지금까지 읽은 페이지를 직접 입력해 주세요. 멤버에게는 참여·달성 인원만 보여요.</p>
          <Field label="도전에 기록할 현재 페이지"><input name="page" type="number" min="0" max={editor.challenge.bookPages} required defaultValue={editor.challenge.myPage ?? 0} disabled={busy} /></Field>
        </> : <p className="muted text-sm">{editor.kind === 'withdraw' ? '내가 기록한 페이지를 지우고 이 도전의 참여·달성 집계에서 빠집니다.' : '도전을 취소하면 새 진도는 받을 수 없어요. 지금까지의 참여·달성 인원은 계속 확인할 수 있어요.'}</p>}
      </>}
      {conflict ? <button type="button" className="btn btn-soft" onClick={close}>닫고 최신 독서 도전 보기</button> : <div className="row-actions">
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={close}>돌아가기</button>
        <button className={'btn ' + (editor.kind === 'cancel' || editor.kind === 'withdraw' ? 'btn-danger' : 'btn-primary')} disabled={busy || editor.kind === 'create' && !book}>
          {busy ? '처리 중…' : editor.kind === 'create' ? '만들기' : editor.kind === 'cancel' ? '취소 확정' : editor.kind === 'withdraw' ? '삭제 확정' : '저장'}
        </button>
      </div>}
    </form>
  </Dialog>
}
