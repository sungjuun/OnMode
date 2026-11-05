import { useEffect, useState } from 'react'
import { CircleCheck, Flag, Trophy } from 'lucide-react'
import { groupAchievements, type GroupAchievement } from '../data/groupAchievements'
import { duration, percent } from '../domain/stats'
import { ErrorState, Loading, messageOf, Progress } from './base'

const amount = (value: number, metric: GroupAchievement['metric']) => metric === 'seconds' ? duration(value) : value.toLocaleString() + (metric === 'sessions' ? '회' : '명')

export function StudyAchievements({ groupId, revision }: { groupId: string; revision: number }) {
  const [list, setList] = useState<GroupAchievement[] | null>(null)
  const [issue, setIssue] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    void groupAchievements.list(groupId).then(value => { if (active) { setList(value); setIssue('') } })
      .catch(error => { if (active) setIssue(messageOf(error)) })
    return () => { active = false }
  }, [groupId, revision, retry])
  return <section className="study-achievements" aria-label="그룹 업적">
    <div className="challenges-heading"><div><h2><Trophy size={17} aria-hidden />그룹 업적</h2><p className="muted text-sm">함께 쌓은 집중이 그룹의 기록이 돼요.</p></div>
      {list && <span className="badge badge-mint">달성 {list.filter(a => a.earnedAt).length}/{list.length}</span>}
    </div>
    {issue ? <ErrorState message={issue} retry={() => setRetry(n => n + 1)} /> : !list ? <Loading /> : <div className="group-achievements-grid">{list.map(achievement => <article key={achievement.id} aria-label={achievement.title} className={'group-achievement ' + (achievement.earnedAt ? 'group-achievement-earned' : '')}>
      <div className="challenge-title"><h3>{achievement.earnedAt ? <CircleCheck size={16} aria-hidden /> : <Flag size={16} aria-hidden />}{achievement.title}</h3><span className={'badge ' + (achievement.earnedAt ? 'badge-mint' : '')}>{achievement.earnedAt ? '달성 완료' : '도전 중'}</span></div>
      <p className="muted text-sm">{achievement.description}</p>
      {achievement.earnedAt ? <p className="achievement-date">달성 확인 {new Date(achievement.earnedAt).toLocaleDateString('ko-KR')}</p> : <>
        <p className="text-sm">{amount(achievement.value, achievement.metric)} / {amount(achievement.target, achievement.metric)}</p>
        <Progress label={achievement.title + ' 진행률'} value={percent(achievement.value, achievement.target)} />
      </>}
    </article>)}</div>}
    <p className="muted text-xs mt-3">그룹에 반영된 1분 이상 완료한 집중만 집계해요. 달성한 배지는 멤버 탈퇴·계정 삭제 후에도 남으며 추가 코인·XP는 지급하지 않아요.</p>
  </section>
}
