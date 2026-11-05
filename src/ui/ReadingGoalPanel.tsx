import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Flag, PencilLine } from 'lucide-react'
import { groupLibrary, LibraryConflict, type ReadingMember, type SharedBook } from '../data/groupLibrary'
import { percent } from '../domain/stats'
import { useApp } from '../state/context'
import { Dialog, ErrorState, Field, Loading, messageOf, Progress } from './base'

type Kind = 'goal' | 'progress' | 'clear' | 'withdraw'
type Editor = { kind: Kind; book: SharedBook }

export function ReadingGoalPanel({ groupId, book, isOwner, updateToken, changed }: {
  groupId: string; book: SharedBook; isOwner: boolean; updateToken: string; changed: () => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [open, setOpen] = useState(false)
  const [pages, setPages] = useState(1)
  const [membersFor, setMembersFor] = useState<{ revision: number; items: ReadingMember[] } | null>(null)
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [issue, setIssue] = useState('')
  const [retry, setRetry] = useState(0)
  const goal = book.reading, active = goal?.targetPage !== undefined
  const goalRevision = goal?.revision ?? 0
  const members = membersFor?.revision === goalRevision ? membersFor.items : null
  const mine = goal?.mine?.page
  useEffect(() => {
    if (!open || !active) return
    let live = true
    setLoading(true)
    async function load() {
      const items: ReadingMember[] = []
      let cursor: string | null = null
      for (let i = 0; i < pages; i++) {
        const next = await groupLibrary.readingMembers(groupId, book.id, cursor)
        if (!live) return
        items.push(...next.items); cursor = next.next
        if (!cursor) break
      }
      if (live) { setMembersFor({ revision: goalRevision, items }); setMore(!!cursor); setIssue('') }
    }
    void load().catch(error => { if (live) { setMembersFor(null); setIssue(messageOf(error)) } }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [open, active, groupId, book.id, goalRevision, updateToken, pages, retry])

  const edit = (kind: Kind) => setEditor({ kind, book })
  return <div className="reading-goal" role="group" aria-label="공유 독서 목표">
    {active && goal ? <>
      <div className="challenge-title"><h4><Flag size={14} aria-hidden />{goal.targetPage}쪽까지 함께 읽기</h4><span className="badge badge-mint">{goal.achieved}명 달성</span></div>
      <p className="muted text-xs">{goal.participants}명 참여 · 참여자 중 목표 달성 {goal.achieved}/{goal.participants}명</p>
      <Progress label={book.name + ' 공동 독서 목표 달성률'} value={percent(goal.achieved, goal.participants)} />
      <p className="text-sm">{mine === undefined ? '아직 공유한 진도가 없어요.' : `내가 공유한 진도 ${mine}쪽 / 목표 ${goal.targetPage}쪽`}</p>
      <div className="row-actions"><button className="btn btn-soft" onClick={() => edit('progress')}><PencilLine size={14} />{mine === undefined ? '진도 공유' : '공유 진도 수정'}</button>
        {mine !== undefined && <button className="btn btn-quiet" onClick={() => edit('withdraw')}>진도 공유 중단</button>}
      </div>
      <details className="reading-members" onToggle={event => setOpen(event.currentTarget.open)}><summary>멤버별 공유 진도</summary>
        {issue && <ErrorState message={issue} retry={() => setRetry(n => n + 1)} />}
        {members === null ? !issue && <Loading /> : !members.length ? <p className="muted text-sm">아직 공유된 진도가 없어요.</p> : <ul className="data-list">{members.map(member => <li key={member.userId}><span><strong>{member.name}</strong><small>{new Date(member.updatedAt).toLocaleString('ko-KR')}</small></span><span>{member.page}쪽{member.page >= goal.targetPage! ? ' · 달성' : ''}</span></li>)}</ul>}
        {more && <button className="btn btn-soft" disabled={loading} onClick={() => setPages(n => n + 1)}>{loading ? '불러오는 중…' : '공유 진도 더 보기'}</button>}
      </details>
    </> : <p className="muted text-sm">{isOwner ? '함께 읽을 목표 페이지를 정해 보세요.' : '그룹장이 독서 목표를 정하면 진도를 공유할 수 있어요.'}</p>}
    {isOwner && <div className="row-actions"><button className="btn btn-quiet" onClick={() => edit('goal')}>{active ? '독서 목표 수정' : '독서 목표 설정'}</button>{active && <button className="btn btn-quiet" onClick={() => edit('clear')}>독서 목표 해제</button>}</div>}
    {editor && <ReadingGoalDialog groupId={groupId} editor={editor} close={() => { setEditor(null); changed() }} saved={() => { setEditor(null); changed() }} />}
  </div>
}

function ReadingGoalDialog({ groupId, editor, close, saved }: {
  groupId: string; editor: Editor; close: () => void; saved: () => void;
}) {
  const { notify } = useApp()
  const { kind, book } = editor
  const [value, setValue] = useState(String(kind === 'goal' ? book.reading?.targetPage ?? book.pages : book.reading?.mine?.page ?? 0))
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  const [conflict, setConflict] = useState(false)
  const pending = useRef<{ value: number | null; id: string } | null>(null)
  const titles: Record<Kind, string> = { goal: '독서 목표 설정', progress: '진도 공유', clear: '독서 목표 해제', withdraw: '진도 공유 중단' }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || conflict) return
    const page = kind === 'clear' || kind === 'withdraw' ? null : Number(value)
    if (page !== null && (!value.trim() || !Number.isInteger(page) || page < (kind === 'goal' ? 1 : 0) || page > book.pages)) { setIssue('도서의 페이지 범위 안에서 입력해 주세요.'); return }
    if (!pending.current || pending.current.value !== page) pending.current = { value: page, id: crypto.randomUUID() }
    setBusy(true); setIssue('')
    try {
      if (kind === 'goal' || kind === 'clear') await groupLibrary.readingGoal(groupId, book.id, book.reading?.revision ?? 0, pending.current.id, page)
      else if (book.reading) await groupLibrary.readingProgress(groupId, book.id, book.reading, pending.current.id, page)
      else throw new LibraryConflict('독서 목표가 변경됐어요. 최신 목표를 확인해 주세요.')
      notify(kind === 'goal' ? '독서 목표를 저장했어요.' : kind === 'clear' ? '독서 목표를 해제했어요.' : kind === 'withdraw' ? '진도 공유를 중단했어요.' : '독서 진도를 공유했어요.')
      saved()
    } catch (error) { setIssue(messageOf(error)); setConflict(error instanceof LibraryConflict) }
    finally { setBusy(false) }
  }
  return <Dialog title={titles[kind]} close={() => { if (!busy) close() }}>
    <form className="form-stack" onSubmit={event => void submit(event)}>
      <p className="text-sm font-bold">{book.name}</p>
      {issue && <ErrorState message={issue} />}
      {kind === 'goal' ? <><p className="muted text-sm">멤버가 각자 도달할 목표 페이지예요. 목표를 바꿔도 직접 공유한 진도는 유지돼요.</p><Field label="함께 읽을 목표 페이지"><input type="number" min="1" max={book.pages} step="1" required disabled={busy} value={value} onChange={event => setValue(event.target.value)} /></Field></>
        : kind === 'progress' ? <><p className="muted text-sm">입력한 페이지와 내 닉네임을 현재 그룹 멤버에게 공개해요. 개인 서재의 진도와 노트는 바뀌지 않아요.</p><Field label="공유할 현재 페이지"><input type="number" min="0" max={book.pages} step="1" required disabled={busy} value={value} onChange={event => setValue(event.target.value)} /></Field><p className="muted text-xs">공동 도서의 총 {book.pages}쪽을 기준으로 입력해 주세요. 개인 독서 진도는 자동으로 가져오지 않아요.</p></>
          : kind === 'clear' ? <p className="muted text-sm">목표를 해제하면 이 책에 공유된 모든 진도가 삭제돼요. 개인 서재와 기록은 유지됩니다.</p>
            : <p className="muted text-sm">그룹에 공개한 내 페이지를 지우고 참여자 목록에서 빠집니다. 개인 서재와 기록은 유지됩니다.</p>}
      {conflict ? <><p className="muted text-sm">입력한 내용은 이 창에 남아 있어요. 최신 목표와 진도를 확인한 뒤 다시 열어 주세요.</p><button type="button" className="btn btn-soft" onClick={close}>취소하고 최신 독서 목표 보기</button></>
        : <div className="row-actions"><button type="button" className="btn btn-quiet" disabled={busy} onClick={close}>취소</button><button className={'btn ' + (kind === 'clear' || kind === 'withdraw' ? 'btn-danger' : 'btn-primary')} disabled={busy}>{busy ? '저장 중…' : kind === 'clear' ? '해제 확정' : kind === 'withdraw' ? '공유 중단 확정' : issue ? '다시 저장' : '저장'}</button></div>}
    </form>
  </Dialog>
}
