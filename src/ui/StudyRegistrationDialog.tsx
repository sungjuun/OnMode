import { useState, type FormEvent } from 'react'
import type { Certification } from '../domain/model'
import { useApp } from '../state/context'
import { Dialog, ErrorState, Field } from './base'

export function StudyRegistrationDialog({ close }: { close: () => void }) {
  const { run, busy } = useApp()
  const [kind, setKind] = useState<'subject' | 'certification'>('subject')
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('120')
  const [certName, setCertName] = useState('')
  const [date, setDate] = useState('')
  const [result, setResult] = useState<Certification['result']>('pending')
  const [error, setError] = useState('')

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const title = (kind === 'subject' ? name : certName).trim()
    if (!title) { setError('이름을 입력해 주세요.'); return }
    setError('')
    const id = crypto.randomUUID()
    const success = kind === 'subject'
      ? await run({ type: 'activity', value: { id, kind: 'subject', name: title, goalMinutes: Number(goal) } }, '공부를 등록했어요.')
      : await run({ type: 'certification', value: { id, name: title, examDate: date, result } }, '자격증을 저장했어요.')
    if (success) close()
  }

  return <Dialog title="공부 등록" close={close}>
    <form className="form-stack" onSubmit={e => void save(e)}>
      <Field label="등록 유형"><select value={kind} disabled={busy} onChange={e => { setKind(e.target.value as typeof kind); setError('') }}><option value="subject">개인공부</option><option value="certification">자격증 준비</option></select></Field>
      {kind === 'subject' ? <>
        <p className="muted text-sm">시험일 없이 공부할 주제나 과목을 등록하고 집중 시간과 학습 기록을 쌓아보세요.</p>
        <Field label="공부 이름"><input required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="예: 영어 회화, 프로그래밍" disabled={busy} /></Field>
        <Field label="목표 시간 (분)"><input type="number" min="1" max="100000" step="1" required value={goal} onChange={e => setGoal(e.target.value)} disabled={busy} /></Field>
      </> : <>
        <p className="muted text-sm">자격증을 등록한 뒤 과목을 추가해 공부할 수 있어요.</p>
        <Field label="자격증 이름"><input required maxLength={80} value={certName} onChange={e => setCertName(e.target.value)} placeholder="예: 정보처리기사" disabled={busy} /></Field>
        <Field label="시험일"><input type="date" required value={date} onChange={e => setDate(e.target.value)} disabled={busy} /></Field>
        <Field label="시험 결과"><select value={result} onChange={e => setResult(e.target.value as Certification['result'])} disabled={busy}><option value="pending">준비 중</option><option value="passed">합격</option><option value="failed">불합격</option></select></Field>
      </>}
      {error && <ErrorState message={error} />}
      <button className="btn btn-primary" disabled={busy}>저장</button>
    </form>
  </Dialog>
}
