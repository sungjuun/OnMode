import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { useLocation } from 'react-router'
import { historyRange, selectFocusHistory, type HistoryOrder, type HistoryPeriod } from '../domain/focusHistory'
import { methods, type Activity, type FocusRecord, type Method } from '../domain/model'
import { duration, sum } from '../domain/stats'
import { Card, CardTitle, ErrorState, Field } from './base'

export const focusHistoryAnchor = 'focus-records'
const pageSize = 20
const periodLabels: Record<HistoryPeriod, string> = {
  all: '전체 기간', today: '오늘', week: '최근 7일', month: '최근 30일', custom: '직접 선택',
}
type Filters = {
  period: HistoryPeriod
  start: string
  end: string
  activity: string
  method: '' | Method
  order: HistoryOrder
}
const defaults: Filters = { period: 'all', start: '', end: '', activity: '', method: '', order: 'newest' }

export function FocusHistory({ records, activities, now }: { records: FocusRecord[]; activities: Activity[]; now: number }) {
  const { hash } = useLocation()
  const target = useRef<HTMLElement>(null)
  const [filters, setFilters] = useState(defaults)
  const [page, setPage] = useState(1)
  const { period, start, end, activity, method, order } = filters
  const { from, to } = historyRange(period, now, start, end)
  const invalidDates = !!from && !!to && from > to
  const activityId = activity === 'free' ? null : activity || undefined
  const byId = useMemo(() => new Map(activities.map(item => [item.id, item.name])), [activities])
  const result = useMemo(() => {
    const items = selectFocusHistory(records, { from, to, activityId, method: method || undefined, order })
    return { items, seconds: sum(items) }
  }, [records, from, to, activityId, method, order])
  const pageCount = Math.max(1, Math.ceil(result.items.length / pageSize))
  const shownPage = Math.min(page, pageCount)
  const visible = result.items.slice((shownPage - 1) * pageSize, shownPage * pageSize)

  useEffect(() => {
    if (hash !== '#' + focusHistoryAnchor) return
    const frame = window.requestAnimationFrame(() => {
      target.current?.focus({ preventScroll: true })
      target.current?.scrollIntoView({ block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [hash])

  function change<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters(current => ({ ...current, [key]: value }))
    setPage(1)
  }

  return <section id={focusHistoryAnchor} ref={target} tabIndex={-1} aria-label="집중 기록" className="focus-history">
    <Card>
      <CardTitle icon={BookOpen} title="집중 기록" sub={records.length + '회 기록'} />
      {records.length === 0 ? <p className="muted mt-4">아직 집중 기록이 없어요.</p> : <>
        <div className="history-filters" role="group" aria-label="집중 기록 필터">
          <Field label="기간"><select value={period} onChange={event => change('period', event.target.value as HistoryPeriod)}>
            {Object.entries(periodLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></Field>
          <Field label="활동"><select value={activity} onChange={event => change('activity', event.target.value)}>
            <option value="">모든 활동</option><option value="free">자유 집중</option>
            {activities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></Field>
          <Field label="집중 방식"><select value={method} onChange={event => change('method', event.target.value as Filters['method'])}>
            <option value="">모든 방식</option>
            {Object.entries(methods).map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}
          </select></Field>
          <Field label="정렬"><select value={order} onChange={event => change('order', event.target.value as HistoryOrder)}>
            <option value="newest">최근 기록부터</option><option value="oldest">오래된 기록부터</option>
          </select></Field>
          {period === 'custom' && <>
            <Field label="시작일"><input type="date" value={start} aria-invalid={invalidDates} onChange={event => change('start', event.target.value)} /></Field>
            <Field label="종료일"><input type="date" value={end} aria-invalid={invalidDates} onChange={event => change('end', event.target.value)} /></Field>
          </>}
        </div>
        <div className="row-actions">
          {!invalidDates && <p className="muted text-sm" aria-live="polite">조건에 맞는 기록 {result.items.length}회 · {duration(result.seconds)}</p>}
          <button className="btn btn-quiet" disabled={period === 'all' && !activity && !method && order === 'newest'}
            onClick={() => { setFilters(defaults); setPage(1) }}>필터 초기화</button>
        </div>
        {invalidDates ? <ErrorState message="종료일은 시작일과 같거나 이후여야 해요." />
          : visible.length === 0 ? <p className="muted mt-3">조건에 맞는 집중 기록이 없어요.</p>
            : <>
              {pageCount > 1 && <nav className="row-actions" aria-label="집중 기록 페이지">
                <button className="btn btn-soft" disabled={shownPage === 1} onClick={() => setPage(shownPage - 1)}>이전 페이지</button>
                <span className="muted text-sm" aria-live="polite">{shownPage} / {pageCount} 페이지</span>
                <button className="btn btn-soft" disabled={shownPage === pageCount} onClick={() => setPage(shownPage + 1)}>다음 페이지</button>
              </nav>}
              <ul className="data-list" aria-label="집중 기록 목록">{visible.map(record => <li key={record.id}>
                <span className="grow"><strong>{record.activityId === null ? '자유 집중' : byId.get(record.activityId) ?? '이름을 찾을 수 없는 활동'}</strong>
                  <small>{new Date(record.endedAt).toLocaleString('ko-KR')} · {methods[record.method].name} · +{record.xp} XP</small></span>
                <strong>{duration(record.seconds)}</strong>
              </li>)}</ul>
            </>}
      </>}
    </Card>
  </section>
}
