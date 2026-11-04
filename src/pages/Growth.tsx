import { Armchair, Award, Coins, House, LampDesk, Laptop, LayoutTemplate, PictureInPicture, Sparkles, Target } from 'lucide-react'
import { items, levelFor, totals } from '../domain/model'
import { achievementsFor } from '../domain/achievements'
import { duration, percent, stats } from '../domain/stats'
import { useApp, useSnapshot } from '../state/context'
import { Card, CardTitle, IconBox, PageTitle, Progress } from '../ui/base'
import { Room } from '../ui/Room'

const icons = { desk: LayoutTemplate, chair: Armchair, lamp: LampDesk, frame: PictureInPicture, plant: Sparkles, shelf: LayoutTemplate, laptop: Laptop, wall: House }
export function Growth() {
  const s = useSnapshot()
  const { now, run, busy } = useApp()
  const { xp, coins } = totals(s)
  const { today } = stats(s.records, now)
  const goal = percent(today, s.profile.goalMinutes * 60)
  const achievements = achievementsFor(s)
  return <div className="page-stack">
    <PageTitle label="GROWTH SPACE" title="성장" description="집중으로 쌓은 보상으로 나만의 공간을 꾸며보세요." action={<span className="coin-chip"><Coins size={18} />{coins.toLocaleString()} 코인</span>} />
    <div className="dashboard-grid growth-grid">
      <Card className="room-card"><CardTitle icon={House} title="나만의 공부방" sub="집중하는 시간이 모여 완성되는 공간" /><Room placed={s.placed} /><div className="room-caption"><span>ONMODE ROOM / 01</span><span>{s.placed.length}개 배치됨</span></div></Card>
      <div className="page-stack">
        <Card className="level-card"><CardTitle icon={Sparkles} title={'레벨 ' + levelFor(xp)} sub="온모드의 집중러" /><strong>{xp.toLocaleString()} <small>XP</small></strong><Progress value={xp % 100} label="다음 레벨까지 경험치" /><p className="muted text-sm">다음 레벨까지 {100 - xp % 100} XP</p></Card>
        <Card><CardTitle icon={Target} tone="blue" title="오늘의 미션" sub="오늘 집중 목표 달성하기" /><div className="metric-line"><strong>{duration(today)}</strong><span>/ {duration(s.profile.goalMinutes * 60)}</span><span className="badge ml-auto">{goal === 100 ? '달성' : goal + '%'}</span></div><Progress value={goal} label="오늘의 미션" /></Card>
      </div>
    </div>
    <Card><CardTitle icon={Coins} tone="gold" title="공부방 아이템" sub="보유한 아이템은 원하는 때에 배치하거나 치울 수 있어요." />
      <div className="items-grid">{items.map(item => {
        const owned = s.inventory.includes(item.id), placed = s.placed.includes(item.id)
        return <article className="shop-item" key={item.id}><IconBox icon={icons[item.id]} tone={item.price ? 'purple' : 'mint'} /><div><h3>{item.name}</h3><p>{item.category} · {owned ? '보유 중' : item.price + ' 코인'}</p></div><button aria-label={item.name + ' ' + (placed ? '치우기' : owned ? '배치' : '구매')} className="btn btn-soft" disabled={busy || (!owned && coins < item.price)} onClick={() => void run(owned ? { type: 'place', id: item.id, placed: !placed } : { type: 'buy', id: item.id }, placed ? '공부방에서 치웠어요.' : owned ? '공부방에 배치했어요.' : '아이템을 구매했어요.')}>{placed ? '치우기' : owned ? '배치' : '구매'}</button></article>
      })}</div>
    </Card>
    <Card><CardTitle icon={Award} tone="gold" title="나의 업적" /><ul className="data-list">{achievements.map(({title, description, earned}) => <li key={title}><span><strong>{title}</strong><small>{description}</small></span><span className={'badge ' + (earned ? 'badge-mint' : '')}>{earned ? '달성' : '도전 중'}</span></li>)}</ul></Card>
  </div>
}
