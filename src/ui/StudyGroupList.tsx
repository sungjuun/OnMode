import { useEffect, useState } from 'react'
import { Globe2, LockKeyhole, Search, Users } from 'lucide-react'
import { groups, type GroupCursor, type PublicGroup, type PublicGroupPage } from '../data/supabase'
import { GROUP_SEARCH_LIMIT } from '../domain/groupSearch'
import { Empty, ErrorState, IconBox, Loading, messageOf } from './base'

export function GroupSearchField({ query, change }: { query: string; change: (value: string) => void }) {
  return <div className="search-field">
    <Search size={17} aria-hidden />
    <input type="search" aria-label="그룹 검색" placeholder="이름 또는 소개로 검색"
      maxLength={GROUP_SEARCH_LIMIT} value={query} onChange={event => change(event.target.value)} />
  </div>
}

export function StudyGroupCard({ group, selected, busy, actionLabel, action }: {
  group: PublicGroup; selected?: boolean; busy: boolean; actionLabel: '보기' | '가입'; action: () => void;
}) {
  return <article className={'group-card' + (selected ? ' selected' : '')}>
    <IconBox icon={group.isPublic ? Globe2 : LockKeyhole} />
    <div><h3>{group.name}</h3><p>{group.description || '스터디 그룹'} · {group.members}명</p></div>
    <button className="btn btn-soft" disabled={busy} onClick={action}>{actionLabel}</button>
  </article>
}

// The caller keys this list by the normalized query so pending pages cannot
// appear under a newer search term.
export function PublicGroupResults({ query, busy, join }: { query: string; busy: boolean; join: (id: string) => void }) {
  const [request, setRequest] = useState<{ cursor?: GroupCursor }>({})
  const [page, setPage] = useState<PublicGroupPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [issue, setIssue] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void groups.search(query, request.cursor, controller.signal).then(next => {
        if (controller.signal.aborted) return
        setPage(current => {
          if (!request.cursor || !current) return next
          const ids = new Set(current.items.map(group => group.id))
          return { ...next, items: [...current.items, ...next.items.filter(group => !ids.has(group.id))] }
        })
      }).catch(error => {
        if (!controller.signal.aborted) setIssue(messageOf(error))
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    }, query && !request.cursor ? 250 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query, request])

  function load(cursor?: GroupCursor) {
    setIssue(''); setLoading(true); setRequest({ cursor })
  }

  return <>
    {issue && <ErrorState message={issue} retry={() => load(request.cursor)} />}
    {!page ? !issue && <Loading /> : page.items.length === 0 ?
      <Empty icon={Users} title={query ? '검색 결과가 없어요' : '참여할 공개 그룹이 없어요'}
        description={query ? '다른 이름이나 소개에 들어갈 단어로 검색해 보세요.' : '새 그룹을 만들거나 초대 코드로 참여할 수 있어요.'} /> :
      <>
        <p className="muted text-xs" aria-live="polite">공개 그룹 {page.items.length}개 표시 중</p>
        <div className="group-list">{page.items.map(group =>
          <StudyGroupCard key={group.id} group={group} busy={busy} actionLabel="가입" action={() => join(group.id)} />)}
        </div>
        {page.next && <button className="btn btn-soft mt-3" disabled={loading || !!issue || busy}
          onClick={() => load(page.next)}>{loading ? '불러오는 중…' : '공개 그룹 더 보기'}</button>}
      </>}
  </>
}
