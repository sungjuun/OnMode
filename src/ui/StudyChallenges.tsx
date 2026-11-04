import { useEffect, useState, type FormEvent } from 'react'
import { CalendarDays, Flag, Plus } from 'lucide-react'
import { challenges, type Challenge } from '../data/challenges'
import { dayKey, duration, percent, shiftDay } from '../domain/stats'
import { useApp } from '../state/context'
import { Dialog, Empty, ErrorState, Field, Loading, messageOf, Progress } from './base'

const statusLabels: Record<Challenge['status'], string> = {
  scheduled: '시작 예정', active: '진행 중', achieved: '목표 달성', ended: '기간 종료', cancelled: '취소됨',
}
type Editor = { kind: 'create'; id: string } | { kind: 'cancel'; challenge: Challenge }

export function StudyChallenges({ groupId, isOwner, revision }: { groupId: string; isOwner: boolean; revision: number }) {
  const { now, notify } = useApp()
  const [list, setList] = useState<Challenge[] | null>(null)
  const [issue, setIssue] = useState('')
  const [formIssue, setFormIssue] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = dayKey(now)
  useEffect(() => {
    let active = true
    void challenges.list(groupId).then(data => {
      if (active) { setList(data); setIssue('') }
    }).catch(error => {
      if (active) { setList(null); setIssue(messageOf(error)) }
    })
    return () => { active = false }
  }, [groupId, revision, refresh])

  function open(value: Editor) { setFormIssue(''); setEditor(value) }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || busy || !isOwner) return
    const form = new FormData(event.currentTarget)
    setFormIssue('')
    if (editor.kind === 'create' && !String(form.get('title')).trim()) {
      setFormIssue('챌린지 이름을 입력해 주세요.')
      return
    }
    if (editor.kind === 'create' && String(form.get('end')) < String(form.get('start'))) {
      setFormIssue('종료일은 시작일과 같거나 이후여야 해요.')
      return
    }
    setBusy(true)
    try {
      if (editor.kind === 'create') await challenges.create(groupId, {
        id: editor.id, title: String(form.get('title')).trim(), targetMinutes: Number(form.get('target')),
        startDate: String(form.get('start')), endDate: String(form.get('end')), timeZone,
      })
      else await challenges.cancel(groupId, editor.challenge.id)
      setEditor(null)
      setRefresh(n => n + 1)
      notify(editor.kind === 'create' ? '함께 도전할 챌린지를 만들었어요.' : '챌린지를 취소했어요.')
    } catch (error) { setFormIssue(messageOf(error)) }
    finally { setBusy(false) }
  }

  return <section className="challenges-section" aria-label="그룹 챌린지">
    <div className="challenges-heading"><div><h2><Flag size={17} aria-hidden />그룹 챌린지</h2><p className="muted text-sm">집중 기록으로 함께 목표를 채워요.</p></div>
      {isOwner && <button className="btn btn-soft" onClick={() => open({ kind: 'create', id: crypto.randomUUID() })}><Plus size={15} />챌린지 만들기</button>}
    </div>
    {issue ? <ErrorState message={issue} retry={() => setRefresh(n => n + 1)} />
      : list === null ? <Loading /> : list.length === 0 ? <Empty icon={Flag} title="아직 챌린지가 없어요" description={isOwner ? '기간과 공동 목표를 정해 첫 챌린지를 시작해 보세요.' : '그룹장이 챌린지를 만들면 멤버 모두 함께 도전해요.'} />
      : <div className="challenges-list">{list.map(challenge => <article key={challenge.id} className="challenge-card" aria-label={challenge.title}>
        <div className="challenge-title"><h3>{challenge.title}</h3><span className={'badge ' + (challenge.status === 'achieved' ? 'badge-mint' : '')}>{statusLabels[challenge.status]}</span></div>
        <p className="challenge-dates"><CalendarDays size={13} aria-hidden />{challenge.startDate} ~ {challenge.endDate}<span>· {challenge.timeZone}</span></p>
        <div className="metric-line"><strong>{duration(challenge.totalSeconds)}</strong><span>/ {duration(challenge.targetMinutes * 60)}</span><span className="badge ml-auto">{percent(challenge.totalSeconds, challenge.targetMinutes * 60)}%</span></div>
        <Progress value={percent(challenge.totalSeconds, challenge.targetMinutes * 60)} label={challenge.title + ' 달성률'} />
        <details className="challenge-members"><summary>멤버별 기여 시간</summary><ul className="data-list">
          {challenge.members.map(member => <li key={member.id}><span>{member.name}</span><strong>{duration(member.seconds)}</strong></li>)}
        </ul></details>
        {isOwner && challenge.canCancel && <button className="btn btn-quiet" onClick={() => open({ kind: 'cancel', challenge })}>챌린지 취소</button>}
      </article>)}</div>}
    <p className="muted text-xs mt-3">챌린지 생성·시작 후 시작해 종료일 안에 마친 집중만 합산해요. 집중 보상은 기존 규칙대로 지급돼요.</p>
    {editor && <Dialog title={editor.kind === 'create' ? '챌린지 만들기' : '챌린지 취소'} close={() => { if (!busy) setEditor(null) }}>
      <form className="form-stack" onSubmit={event => void submit(event)}>
        {formIssue && <ErrorState message={formIssue} />}
        {editor.kind === 'create' ? <>
          <Field label="챌린지 이름"><input name="title" required maxLength={60} placeholder="예: 이번 주 함께 10시간" disabled={busy} /></Field>
          <Field label="공동 집중 목표 (분)"><input name="target" type="number" required min="1" max="1000000" defaultValue={600} disabled={busy} /></Field>
          <div className="form-grid">
            <Field label="시작일"><input name="start" type="date" required min={today} defaultValue={today} disabled={busy} /></Field>
            <Field label="종료일"><input name="end" type="date" required min={today} defaultValue={dayKey(shiftDay(now, 6))} disabled={busy} /></Field>
          </div>
          <p className="muted text-sm">기간은 최대 90일이며 종료일을 포함해요. 시간대: {timeZone}</p>
        </> : <p className="muted text-sm"><strong>{editor.challenge.title}</strong>을 취소할까요? 현재까지의 기록은 남고, 이후 집중은 챌린지에 추가되지 않아요.</p>}
        <div className="row-actions">
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setEditor(null)}>돌아가기</button>
          <button className={'btn ' + (editor.kind === 'create' ? 'btn-primary' : 'btn-danger')} disabled={busy}>
            {busy ? '처리 중…' : editor.kind === 'create' ? '만들기' : '취소 확정'}
          </button>
        </div>
      </form>
    </Dialog>}
  </section>
}
