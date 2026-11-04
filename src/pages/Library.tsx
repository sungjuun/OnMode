import { useState, type FormEvent } from 'react'
import { BookOpen, GraduationCap, PencilLine, Play, Plus } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { dDay, dayKey, duration, percent, sum } from '../domain/stats'
import type { Activity, Certification } from '../domain/model'
import { useApp, useSnapshot } from '../state/context'
import { Card, CardTitle, Dialog, Empty, Field, PageTitle, Progress } from '../ui/base'
import { BookRegistrationDialog } from '../ui/BookRegistrationDialog'

type Editor = { kind: 'certification'; cert?: Certification } | { kind: 'subject'; cert: Certification } | { kind: 'book' } | { kind: 'log'; activity: Activity }
const resultNames = { pending: '준비 중', passed: '합격', failed: '불합격' }

export function Library() {
  const [params, setParams] = useSearchParams()
  const books = params.get('tab') === 'books'
  const [editor, setEditor] = useState<Editor | null>(null)
  const { now, run, busy } = useApp()
  const s = useSnapshot()
  const bookList = s.activities.filter(a => a.kind === 'book')
  const recordsFor = (a: Activity) => sum(s.records.filter(r => r.activityId === a.id))
  const close = () => setEditor(null)

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editor || editor.kind === 'book') return
    const form = new FormData(e.currentTarget)
    const value = (field: string) => String(form.get(field) ?? '').trim()
    const id = crypto.randomUUID()
    let success: boolean
    if (editor.kind === 'certification') {
      if (!value('name')) return
      success = await run({ type: 'certification', value: { id: editor.cert?.id ?? id, name: value('name'), examDate: value('date'), result: value('result') as Certification['result'] } }, '자격증을 저장했어요.')
    } else if (editor.kind === 'subject') {
      if (!value('name')) return
      success = await run({ type: 'activity', value: { id, kind: 'subject', name: value('name'), certificationId: editor.cert.id, goalMinutes: Number(value('goal')) } }, '과목을 추가했어요.')
    } else {
      success = await run({ type: 'journal', value: { id, activityId: editor.activity.id, date: dayKey(now), text: value('text'), amount: Number(value('amount')) } }, '기록을 저장했어요.')
    }
    if (success) close()
  }

  const add = <button className="btn btn-primary" onClick={() => setEditor({ kind: books ? 'book' : 'certification' })}><Plus size={17} />{books ? '도서 등록' : '등록'}</button>
  function activityRow(a: Activity) {
    const book = a.kind === 'book'
    const progress = book ? percent(a.currentPage ?? 0, a.pages ?? 0) : percent(recordsFor(a), (a.goalMinutes ?? 0) * 60)
    const logs = s.journal.filter(j => j.activityId === a.id)
    return <div className="activity-row" key={a.id}>
      <div className="activity-head"><div><h3>{a.name}</h3><p>{book ? a.author + ' · ' + (a.currentPage ?? 0) + ' / ' + a.pages + '쪽 · 일일 목표 ' + a.goalPages + '쪽' : duration(recordsFor(a)) + ' / ' + duration((a.goalMinutes ?? 0) * 60)}</p></div><span className="badge">{progress === 100 && book ? '완독' : progress + '%'}</span></div>
      <Progress label={a.name + ' 진행률'} value={progress} />
      {book && a.isbn && <p className="muted text-sm mt-2">ISBN {a.isbn}</p>}
      <div className="row-actions"><Link className="btn btn-soft" to={'/focus?activity=' + a.id}><Play size={15} />집중하기</Link><button className="btn btn-quiet" onClick={() => setEditor({ kind: 'log', activity: a })}><PencilLine size={15} />{book ? '독서 기록' : '학습 기록'}</button></div>
      {logs.length > 0 && <details className="activity-logs"><summary>저장한 기록 {logs.length}개</summary><ul className="data-list">{[...logs].reverse().map(j => <li key={j.id}><span><strong>{j.text || (book ? '진도 업데이트' : '문제 풀이')}</strong><small>{j.date}</small></span><span>{j.amount}{book ? '쪽' : '문제'}</span></li>)}</ul></details>}
    </div>
  }

  return <div className="page-stack">
    <PageTitle label="MY LIBRARY" title="학습·독서" description="개인공부와 독서 진도를 한곳에서 관리하세요." action={add} />
    <div className="segmented" aria-label="활동 유형"><button aria-pressed={!books} onClick={() => setParams({})}><GraduationCap size={17} />나의 공부</button><button aria-pressed={books} onClick={() => setParams({ tab: 'books' })}><BookOpen size={17} />나의 서재</button></div>
    {books ? bookList.length ? <div className="grid gap-4 md:grid-cols-2">{bookList.map(a => <Card key={a.id}>{activityRow(a)}</Card>)}</div> : <Card><Empty icon={BookOpen} title="서재가 비어 있어요" description="읽고 싶은 책을 등록하고 한 페이지씩 쌓아보세요." /></Card>
      : s.certifications.length ? <div className="grid gap-4 lg:grid-cols-2">{s.certifications.map(c => <Card key={c.id}>
        <CardTitle icon={GraduationCap} title={c.name} sub={c.examDate + ' · ' + resultNames[c.result]} action={<span className="badge">{dDay(c.examDate, now)}</span>} />
        <div className="row-actions"><button className="btn btn-soft" onClick={() => setEditor({ kind: 'subject', cert: c })}><Plus size={16} />과목 추가</button><button className="btn btn-quiet" onClick={() => setEditor({ kind: 'certification', cert: c })}><PencilLine size={15} />수정</button></div>
        {s.activities.some(a => a.certificationId === c.id) ? s.activities.filter(a => a.certificationId === c.id).map(activityRow) : <p className="muted text-sm mt-4">과목을 추가하면 집중 시간과 진도를 연결할 수 있어요.</p>}
      </Card>)}</div> : <Card><Empty icon={GraduationCap} title="등록된 자격증이 없어요" description="시험 날짜를 정하고 오늘 공부할 과목을 추가해 보세요." /></Card>}
    {editor?.kind === 'book' && <BookRegistrationDialog close={close} />}
    {editor && editor.kind !== 'book' && <Dialog title={editor.kind === 'certification' ? editor.cert ? '자격증 수정' : '자격증 등록' : editor.kind === 'subject' ? '과목 추가' : editor.activity.kind === 'book' ? '독서 기록' : '학습 기록'} close={close}>
      <form className="form-stack" onSubmit={e => void save(e)}>
        {editor.kind === 'certification' && <><Field label="자격증 이름"><input name="name" required maxLength={80} defaultValue={editor.cert?.name} placeholder="예: 정보처리기사" /></Field><Field label="시험일"><input name="date" type="date" required defaultValue={editor.cert?.examDate} /></Field><Field label="시험 결과"><select name="result" defaultValue={editor.cert?.result ?? 'pending'}>{Object.entries(resultNames).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></Field></>}
        {editor.kind === 'subject' && <><Field label="과목 이름"><input name="name" required maxLength={80} placeholder="예: 데이터베이스" /></Field><Field label="목표 시간 (분)"><input name="goal" type="number" min="1" max="100000" defaultValue="120" required /></Field></>}
        {editor.kind === 'log' && <><Field label={editor.activity.kind === 'book' ? '현재 읽은 페이지' : '푼 문제 수'}><input name="amount" type="number" min="0" max={editor.activity.pages ?? 100000} required defaultValue={editor.activity.currentPage ?? 0} /></Field><Field label={editor.activity.kind === 'book' ? '독서 노트 / 후기' : '공부한 내용'}><textarea name="text" rows={4} maxLength={2000} /></Field></>}
        <button className="btn btn-primary" disabled={busy}>저장</button>
      </form>
    </Dialog>}
  </div>
}
