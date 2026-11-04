import { useState, type FormEvent } from 'react'
import { Activity, BookOpen, CalendarDays, Clock3, Flame, Settings, Trophy, UserRound } from 'lucide-react'
import { Link } from 'react-router'
import { methods } from '../domain/model'
import { duration, stats, streak, sum } from '../domain/stats'
import { webNotifications } from '../data/webNotifications'
import { useApp, useSnapshot } from '../state/context'
import { Card, CardTitle, Dialog, Field, IconBox, PageTitle, TextLink } from '../ui/base'
import { StatisticsCard } from '../ui/Statistics'

export function My() {
  const s = useSnapshot()
  const { now, run, busy, session, notify } = useApp()
  const [settings, setSettings] = useState(false)
  const time = stats(s.records, now)
  const activityTime = [[null, '자유 집중'], ...s.activities.map(a => [a.id, a.name] as const)] as const
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget), name = String(form.get('name')).trim()
    if (!name) { notify('닉네임을 입력해 주세요.', true); return }
    let notifications = form.get('notifications') === 'on'
    if (notifications) notifications = await webNotifications.request().catch(() => false)
    if (await run({ type: 'profile', value: { name, goalMinutes: Number(form.get('goal')), notifications } }, form.get('notifications') && !notifications ? '설정을 저장했어요. 브라우저 알림은 허용되지 않았어요.' : '설정을 저장했어요.')) setSettings(false)
  }
  return <div className="page-stack">
    <PageTitle label="MY WORKSPACE" title="MY" description="나의 집중 시간과 차곡차곡 쌓인 기록을 돌아보세요." action={<button className="btn btn-soft" onClick={() => setSettings(true)}><Settings size={17} />환경설정</button>} />
    <Card className="profile-card"><span className="avatar avatar-lg">{s.profile.name.slice(0, 1)}</span><div><h2>{s.profile.name}</h2><p className="muted">{session?.user.email ?? '로컬 체험 모드'} · 일일 목표 {duration(s.profile.goalMinutes * 60)}</p></div><Link className="btn btn-soft ml-auto" to="/account"><UserRound size={16} />계정 관리</Link></Card>
    <div className="metrics">{([[Clock3, '오늘', time.today], [CalendarDays, '이번 주', time.weekly], [Activity, '이번 달', time.monthly], [Trophy, '전체 누적', time.total]] as const).map(([Icon, label, seconds]) => <Card className="metric" key={label}><IconBox icon={Icon} /><div><p>{label}</p><strong>{duration(seconds)}</strong></div></Card>)}</div>
    <div className="dashboard-grid"><StatisticsCard records={s.records} now={now} link={false} /><Card><CardTitle icon={Flame} tone="peach" title="목표 달성" sub={'현재 목표 기준 · ' + streak(s.records, s.profile.goalMinutes * 60, now) + '일 연속'} />
      <h3 className="mt-5">활동별 집중 시간</h3><ul className="data-list">{activityTime.map(([id, title]) => <li key={id ?? 'free'}><span>{title}</span><strong>{duration(sum(s.records.filter(r => r.activityId === id)))}</strong></li>)}</ul><TextLink to="/library">학습·독서 기록</TextLink> <TextLink to="/growth">업적 보기</TextLink>
    </Card></div>
    <Card><CardTitle icon={BookOpen} title="집중 기록" sub={s.records.length + '회 기록'} />{s.records.length ? <ul className="data-list">{[...s.records].sort((a, b) => b.endedAt - a.endedAt).map(r => <li key={r.id}><span><strong>{s.activities.find(a => a.id === r.activityId)?.name ?? '자유 집중'}</strong><small>{new Date(r.endedAt).toLocaleString('ko-KR')} · {methods[r.method].name} · +{r.xp} XP</small></span><strong>{duration(r.seconds)}</strong></li>)}</ul> : <p className="muted mt-4">아직 집중 기록이 없어요.</p>}</Card>
    {settings && <Dialog title="환경설정" close={() => setSettings(false)}><form className="form-stack" onSubmit={e => void save(e)}><Field label="닉네임"><input name="name" required maxLength={30} defaultValue={s.profile.name} /></Field><Field label="일일 목표 (분)"><input name="goal" type="number" min="1" max="1440" required defaultValue={s.profile.goalMinutes} /></Field><label className="checkbox"><input name="notifications" type="checkbox" defaultChecked={s.profile.notifications} />앱을 열어둔 동안 집중 완료 알림 받기</label><button className="btn btn-primary" disabled={busy}>저장</button></form></Dialog>}
  </div>
}
