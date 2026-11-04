import { useState } from 'react'
import { BookOpen, Coffee, Crosshair, Hourglass, Pause, Play, Settings2, Square, Timer, Zap } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { methods, type Method } from '../domain/model'
import { clock, duration, percent } from '../domain/stats'
import { elapsed } from '../domain/timer'
import { useApp, useSnapshot } from '../state/context'
import { Card, CardTitle, Field, PageTitle, TextLink } from '../ui/base'

const choices = [['pomodoro', Timer], ['flow', Hourglass], ['deep', Zap], ['custom', Settings2]] as const

export function Focus() {
  const { timer, activities, records } = useSnapshot()
  const { now, run, busy, rest, endRest } = useApp()
  const [params] = useSearchParams()
  const [method, setMethod] = useState<Method>('pomodoro')
  const [activity, setActivity] = useState(params.get('activity') ?? '')
  const [focus, setFocus] = useState(30)
  const [breakMinutes, setBreak] = useState(5)
  const selected = timer?.method ?? method
  const chosen = methods[selected]
  const elapsedMs = timer ? elapsed(timer, now) : 0
  const target = timer ? timer.targetSeconds : selected === 'custom' ? focus * 60 : chosen.focus === null ? null : chosen.focus * 60
  const seconds = rest ? Math.ceil((rest.endAt - now) / 1000) : target === null ? Math.floor(elapsedMs / 1000) : Math.max(0, Math.ceil(target - elapsedMs / 1000))
  const progress = rest ? 100 : target ? percent(elapsedMs, target * 1000) : timer ? 100 : 0
  const activityName = activities.find(a => a.id === timer?.activityId)?.name ?? '자유 집중'
  const valid = selected !== 'custom' || (Number.isInteger(focus) && focus >= 1 && focus <= 180 && Number.isInteger(breakMinutes) && breakMinutes >= 0 && breakMinutes <= 60)
  const recent = [...records].sort((a,b) => b.endedAt - a.endedAt).slice(0, 4)

  return <div className="page-stack">
    <PageTitle label="FOCUS STUDIO" title="집중" description="나에게 맞는 리듬으로, 지금 할 일에 몰입해 보세요." />
    <div className="focus-grid">
      <Card className="timer-card">
        <span className="badge timer-status"><i />{rest ? rest.long ? '긴 휴식' : '휴식' : timer ? timer.activeSince === null ? '일시정지' : '집중 중' : '집중 준비'}</span>
        <div className="timer-dial"><svg viewBox="0 0 220 220" aria-hidden><circle cx="110" cy="110" r="101" /><circle cx="110" cy="110" r="101" pathLength="100" strokeDasharray={progress + ' 100'} /></svg><div><p>{rest ? 'BREATH & RESET' : 'ONMODE TIMER'}</p><strong aria-label="타이머">{clock(seconds)}</strong><span>{rest ? '잠깐 쉬어가요' : timer ? activityName : chosen.name}</span></div></div>
        <div className="timer-actions">
          {rest ? <button className="btn btn-primary" onClick={endRest}><Coffee size={18} />휴식 종료</button>
            : timer ? <><button disabled={busy} className="btn btn-primary" onClick={() => void run({ type: timer.activeSince === null ? 'resume' : 'pause', id: timer.id })}>
              {timer.activeSince === null ? <><Play size={18} />재개</> : <><Pause size={18} />일시정지</>}</button>
              <button disabled={busy} className="btn btn-soft" onClick={() => void run({ type: 'finish', id: timer.id })}><Square size={16} />종료하고 저장</button></>
            : <button disabled={busy || !valid} className="btn btn-primary" onClick={() => void run({ type: 'start', value: { id: crypto.randomUUID(), method: selected, targetSeconds: target, activityId: activities.some(a => a.id === activity) ? activity : null, restSeconds: (selected === 'custom' ? breakMinutes : chosen.rest) * 60 } })}><Play size={17} fill="currentColor" />집중 시작</button>}
        </div>
        <p className="muted text-sm">집중 1분마다 <strong>5 XP · 1 코인</strong>을 받아요.</p>
      </Card>
      <Card className="settings-card">
        <CardTitle icon={Crosshair} title="집중 방식" sub="시작하기 전에 설정하세요" />
        <div className="methods">{choices.map(([id, Icon]) => <button key={id} type="button" disabled={!!timer || !!rest} aria-pressed={id === selected} className={'method ' + (id === selected ? 'selected' : '')} onClick={() => setMethod(id)}><Icon size={18} /><span><strong>{methods[id].name}</strong><small>{methods[id].detail}</small></span><i /></button>)}</div>
        {selected === 'custom' && !timer && <div className="form-grid"><Field label="집중 (분)"><input type="number" min="1" max="180" value={focus || ''} onChange={e => setFocus(Number(e.target.value))} /></Field><Field label="휴식 (분)"><input type="number" min="0" max="60" value={breakMinutes} onChange={e => setBreak(Number(e.target.value))} /></Field></div>}
        <Field label="집중할 활동"><select disabled={!!timer || !!rest} value={timer?.activityId ?? (timer ? '' : activity)} onChange={e => setActivity(e.target.value)}><option value="">자유 집중</option>{activities.map(a => <option key={a.id} value={a.id}>{a.kind === 'book' ? '독서' : '공부'} · {a.name}</option>)}</select></Field>
        <TextLink to="/library">활동 관리</TextLink>
      </Card>
    </div>
    <Card><CardTitle icon={BookOpen} title="최근 집중 기록" action={<TextLink to="/my">기록 보기</TextLink>} />
      {recent.length ? <ul className="data-list">{recent.map(r => <li key={r.id}><span><strong>{activities.find(a => a.id === r.activityId)?.name ?? '자유 집중'}</strong><small>{methods[r.method].name}</small></span><strong>{duration(r.seconds)}</strong></li>)}</ul> : <p className="muted mt-4">첫 집중을 마치면 기록이 이곳에 쌓여요. <Link className="text-link" to="/library">활동 추가</Link></p>}
    </Card>
  </div>
}
