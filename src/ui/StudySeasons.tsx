import { useEffect, useState } from 'react'
import { CalendarDays, Trophy } from 'lucide-react'
import { loadStudySeason, type StudySeason } from '../data/studySeasons'
import { duration, percent } from '../domain/stats'
import { ErrorState, Loading, messageOf, Progress } from './base'

const goals = [1, 10, 30]
function monthLabel(date: string) {
  const [year, month] = date.split('-')
  return `${year}년 ${Number(month)}월`
}

export function StudySeasons({ groupId, revision }: { groupId: string; revision: number }) {
  const [month, setMonth] = useState<string>()
  const [loaded, setLoaded] = useState<{ selected?: string; season: StudySeason } | null>(null)
  const [issue, setIssue] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    void loadStudySeason(groupId, month).then(season => {
      if (active) { setLoaded({ selected: month, season }); setIssue('') }
    }).catch(error => { if (active) setIssue(messageOf(error)) })
    return () => { active = false }
  }, [groupId, month, revision, retry])

  const season = loaded?.selected === month ? loaded?.season : null
  const choices = loaded?.season.months
  const nextGoal = season ? goals.find(hours => season.totalSeconds < hours * 3600) : undefined
  const selectMonth = (value: string) => {
    setIssue('')
    setMonth(value || undefined)
  }

  return <section className="challenges-section" aria-label="스터디 시즌">
    <div className="challenges-heading">
      <div><h2><Trophy size={17} aria-hidden />스터디 시즌</h2><p className="muted text-sm">매달 함께 쌓은 집중 시간과 순위를 확인해요.</p></div>
      {choices && <label className="field">
        <span>시즌 선택</span>
        <select value={month ?? ''} onChange={event => selectMonth(event.target.value)}>
          <option value="">이번 시즌 · {monthLabel(choices[0])}</option>
          {choices.slice(1).map(option => <option key={option} value={option}>{monthLabel(option)}</option>)}
        </select>
      </label>}
    </div>
    {issue ? <ErrorState message={issue} retry={() => setRetry(value => value + 1)} /> : !season ? <Loading /> :
      <article className="challenge-card mt-3" aria-label={monthLabel(season.month) + ' 시즌 결과'}>
        <div className="challenge-title">
          <h3>{monthLabel(season.month)} 시즌</h3>
          <span className={'badge ' + (season.month === season.currentMonth ? 'badge-mint' : '')}>
            {season.month === season.currentMonth ? '진행 중' : '시즌 종료'}
          </span>
        </div>
        <p className="challenge-dates"><CalendarDays size={13} aria-hidden />{season.month} ~ {season.endDate} · 한국 시간</p>
        <div className="metric-line"><strong>{duration(season.totalSeconds)}</strong><span>· 완료 {season.sessions.toLocaleString()}회 · 기여 {season.contributors.toLocaleString()}명</span></div>
        <div className="row-actions" role="group" aria-label="시즌 공동 목표">
          {goals.map(hours => {
            const achieved = season.totalSeconds >= hours * 3600
            return <span key={hours} className={'badge ' + (achieved ? 'badge-mint' : '')}>{hours}시간 {achieved ? '달성' : '목표'}</span>
          })}
        </div>
        {nextGoal !== undefined && <Progress value={percent(season.totalSeconds, nextGoal * 3600)} label={nextGoal + '시간 시즌 목표 진행률'} />}
        <p className="muted text-sm mt-3">{season.mine
          ? `내 시즌 기록 · ${season.mine.rank}위 · ${duration(season.mine.seconds)} · ${season.mine.sessions}회 완료`
          : '이 시즌에 내가 기여한 집중 기록이 없어요.'}</p>
        {season.ranking.length > 0 && <details className="challenge-members">
          <summary>시즌 순위 · 현재 멤버 상위 20명</summary>
          <ol className="data-list" aria-label="시즌 집중 순위">
            {season.ranking.map(member => <li key={member.id}><span className="badge">{member.rank}위</span><span className="grow">{member.name}</span><strong>{duration(member.seconds)}</strong></li>)}
          </ol>
        </details>}
      </article>}
    <p className="muted text-xs mt-3">그룹에 반영된 1분 이상 집중을 완료한 달에 집계해요. 순위는 현재 멤버만 표시해요.</p>
  </section>
}
