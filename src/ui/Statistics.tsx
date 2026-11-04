import { BarChart3 } from 'lucide-react'
import { Card, CardTitle, TextLink } from './base'
import { duration, stats } from '../domain/stats'
import type { FocusRecord } from '../domain/model'

const days = ['월', '화', '수', '목', '금', '토', '일']
export function StatisticsCard({ records, now, link = true }: { records: FocusRecord[]; now: number; link?: boolean }) {
  const { week, weekly } = stats(records, now)
  const maxMinutes = Math.max(60, Math.ceil(Math.max(...week.map(day => day.seconds)) / 3600) * 60)
  return <Card className="stats-card"><CardTitle icon={BarChart3} title="이번 주 집중" sub="월요일부터 일요일까지" action={link && <TextLink to="/my">통계 보기</TextLink>} />
    <div className="stats-total"><strong>{duration(weekly)}</strong><span> 주간 누적</span></div>
    <div className="chart" role="img" aria-label={week.map((day, i) => days[i] + '요일 ' + duration(day.seconds)).join(', ')}>
      <div className="chart-labels" aria-hidden><span>{maxMinutes}분</span><span>{maxMinutes / 2}분</span><span>0분</span></div>
      <div className="chart-body" aria-hidden><div className="chart-lines"><i /><i /><i /></div><div className="bars">{week.map((day, i) => <div className={day.today ? 'today' : ''} key={day.date}><span style={{ height: Math.max(4, day.seconds / (maxMinutes * 60) * 100) + '%' }} title={duration(day.seconds)} /><small>{days[i]}</small></div>)}</div></div>
    </div>
  </Card>
}
