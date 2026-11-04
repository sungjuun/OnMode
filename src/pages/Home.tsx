import { ArrowRight, BookOpen, CalendarDays, ChevronRight, Coins, Flame, GraduationCap, Play, Sparkles, Target, Timer, Trophy, Users } from 'lucide-react'
import { Link } from 'react-router'
import { useApp, useSnapshot } from '../state/context'
import { useJoinedGroups } from '../state/useGroups'
import { dDay, duration, percent, stats, streak } from '../domain/stats'
import { levelFor, totals } from '../domain/model'
import { achievementsFor } from '../domain/achievements'
import { Card, CardTitle, IconBox, PageTitle, Progress, TextLink } from '../ui/base'
import { StatisticsCard } from '../ui/Statistics'

export function Home() {
  const s = useSnapshot()
  const { now, session } = useApp()
  const joined = useJoinedGroups(session?.user.id)
  const { today } = stats(s.records, now)
  const goal = percent(today, s.profile.goalMinutes * 60)
  const { xp, coins } = totals(s)
  const cert = [...s.certifications].filter(c => c.result === 'pending').sort((a, b) => a.examDate.localeCompare(b.examDate))[0]
  const book = s.activities.find(a => a.kind === 'book' && (a.currentPage ?? 0) < (a.pages ?? 0))
  const reward = [...s.records].sort((a,b) => b.endedAt - a.endedAt).find(r => r.xp > 0)
  const achievement = achievementsFor(s).filter(a => a.earned).at(-1)
  const date = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(now)

  return <div className="page-stack">
    <PageTitle label="OVERVIEW" title={'안녕하세요, ' + s.profile.name + '님!'} description="작은 집중이 모여 오늘의 성장이 돼요." action={<span className="date-chip"><CalendarDays size={16} />{date}</span>} />
    <section className="hero">
      <div className="hero-copy"><span className="hero-tag"><span />{s.timer ? 'FOCUS IN PROGRESS' : 'FOCUS MODE'}</span><h2>지금, 집중을 켜볼까요?</h2><p>당신의 페이스로, 한 번의 집중부터.</p><Link className="btn hero-button" to="/focus"><Play size={16} fill="currentColor" />{s.timer ? '타이머 열기' : '집중 시작하기'}<ArrowRight size={17} className="ml-2" /></Link></div>
      <div className="orbit-art" aria-hidden="true"><i className="orbit o1" /><i className="orbit o2" /><i className="orbit o3" /><i className="orbit o4" /><span className="orbit-spark a">✦</span><span className="orbit-spark b">✧</span><span className="orbit-spark c">·</span><span className="orbit-spark d">✦</span><div className="orbit-dial"><Timer size={66} strokeWidth={1.25} /></div></div>
      <span className="hero-index" aria-hidden>01 / YOUR FOCUS SPACE</span>
    </section>
    <div className="metrics">
      <Card className="metric"><IconBox icon={Timer} /><div><p>오늘의 집중</p><strong>{duration(today)}</strong><small>오늘 쌓은 집중 시간</small></div></Card>
      <Card className="metric"><IconBox icon={Target} tone="blue" /><div><p>일일 목표</p><strong>{goal}%</strong><Progress value={goal} label="일일 목표 달성률" tone="blue" /></div></Card>
      <Card className="metric"><IconBox icon={Flame} tone="peach" /><div><p>연속 달성</p><strong>{streak(s.records, s.profile.goalMinutes * 60, now)}일</strong><small>목표를 달성한 날</small></div></Card>
      <Card className="metric"><IconBox icon={Coins} tone="gold" /><div><p>보유 코인</p><strong>{coins.toLocaleString()} <em>코인</em></strong><small>Lv. {levelFor(xp)} · {xp} XP</small></div></Card>
    </div>
    <div className="dashboard-grid">
      <StatisticsCard records={s.records} now={now} />
      <Card className="routine-card">
        <CardTitle icon={BookOpen} title="나의 학습 루틴" sub="시험과 독서 진도를 한눈에" action={<TextLink to="/library">관리</TextLink>} />
        <Link className="routine-row" to="/library"><IconBox icon={GraduationCap} tone="blue" /><div><strong>{cert?.name ?? '자격증 공부'}</strong><p>{cert ? cert.examDate + ' 시험' : '시험일과 과목을 등록해 보세요'}</p></div>{cert ? <span className="badge">{dDay(cert.examDate, now)}</span> : <ChevronRight size={17} />}</Link>
        <Link className="routine-row" to="/library?tab=books"><IconBox icon={BookOpen} tone="mint" /><div><strong>{book?.name ?? '나의 독서'}</strong><p>{book ? (book.currentPage ?? 0) + ' / ' + book.pages + '쪽 · ' + percent(book.currentPage ?? 0, book.pages ?? 0) + '%' : '읽고 있는 책을 등록해 보세요'}</p></div><ChevronRight size={17} /></Link>
        <Link className="routine-row" to="/study"><IconBox icon={Users} tone="peach" /><div><strong>{joined?.[0]?.name ?? '스터디 그룹'}</strong><p>{session ? joined === undefined ? '참여 그룹 확인 중…' : joined === null ? '스터디에서 다시 확인해 주세요' : joined.length ? '참여 그룹 ' + joined.length + '개 · ' + joined[0].members + '명' : '아직 참여한 그룹이 없어요' : '계정을 연결하면 함께 집중할 수 있어요'}</p></div><ChevronRight size={17} /></Link>
      </Card>
    </div>
    <Card className="reward-strip"><IconBox icon={Trophy} tone="gold" /><div><strong>최근 보상과 업적</strong><p>{reward ? '집중 ' + duration(reward.seconds) + ' · +' + reward.xp + ' XP · +' + reward.coins + ' 코인' : '집중 1분마다 XP와 코인이 쌓여요.'}</p>{achievement && <p>달성 업적 · {achievement.title}</p>}</div><Link to="/growth" className="btn btn-soft ml-auto"><Sparkles size={16} /> 공부방</Link></Card>
  </div>
}
