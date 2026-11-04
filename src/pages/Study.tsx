import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ChevronRight, Flag, Globe2, KeyRound, LockKeyhole, Plus, Search, Trophy, Users } from 'lucide-react'
import { Link } from 'react-router'
import { configured, groups, supabase, type Group, type Ranking } from '../data/supabase'
import { duration, percent } from '../domain/stats'
import { useApp } from '../state/context'
import { Card, CardTitle, Dialog, Empty, ErrorState, Field, IconBox, Loading, messageOf, PageTitle, Progress } from '../ui/base'
import { StudyChallenges } from '../ui/StudyChallenges'
import { StudyNotices } from '../ui/StudyNotices'
import { StudyChat } from '../ui/StudyChat'

type Editor = 'create' | 'invite' | 'goal' | 'leave'

export function Study() {
  const { session } = useApp()
  if (!session) return <div className="page-stack">
    <PageTitle label="STUDY TOGETHER" title="스터디" description="같은 목표를 가진 사람들과 집중 시간을 쌓아보세요." />
    <Card><Empty icon={Users} title="스터디 체험 안내" description={configured ? '계정에 로그인하면 실제 그룹을 만들고 참여할 수 있어요.' : '지금은 로컬 체험 모드예요. Supabase를 연결하고 로그인하면 그룹 기능이 열려요.'} action={<Link className="btn btn-primary" to="/account">{configured ? '계정 연결' : '연결 방법 보기'}<ChevronRight size={16} /></Link>} /></Card>
    <div className="metrics study-preview">{([[Globe2, '공개 스터디', '관심 있는 그룹을 검색하고 참여해요.'], [KeyRound, '초대 전용 그룹', '초대 코드를 받은 사람만 참여할 수 있어요.'], [Trophy, '함께 쌓는 기록', '집중 시간과 일간·주간 랭킹을 확인해요.']] as const).map(([Icon, title, copy]) =>
      <Card key={title}><IconBox icon={Icon} /><h2 className="mt-3">{title}</h2><p className="muted text-sm mt-1">{copy}</p></Card>
    )}</div>
  </div>
  return <ConnectedStudy />
}

function ConnectedStudy() {
  const { now, notify } = useApp()
  const [list, setList] = useState<Group[] | null>(null)
  const [rank, setRank] = useState<{ groupId: string; data: Ranking } | null>(null)
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'mine' | 'discover'>('mine')
  const [period, setPeriod] = useState<'today' | 'week'>('today')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  const [rankIssue, setRankIssue] = useState('')
  const [live, setLive] = useState(false)
  const [revision, setRevision] = useState(0)
  const group = list?.find(g => g.id === selected && g.role)
  const id = group?.id
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const load = useCallback(async () => {
    try { setList(await groups.list()); setIssue('') } catch (e) { setIssue(messageOf(e)) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!id) return
    let active = true, sequence = 0
    const refresh = () => {
      setRevision(n => n + 1)
      const request = ++sequence
      void groups.ranking(id, zone).then(data => {
        if (active && sequence === request) { setRank({ groupId: id, data }); setRankIssue('') }
      }).catch(e => { if (active && sequence === request) setRankIssue(messageOf(e)) })
    }
    refresh()
    const client = supabase
    const channel = client?.channel('group-changes:' + id, { config: { postgres_changes_options: { wait: true } } }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_updates', filter: 'group_id=eq.' + id }, () => { refresh(); void load() })
      .subscribe(status => { if (active) { setLive(status === 'SUBSCRIBED'); if (status === 'SUBSCRIBED') refresh() } })
    const poll = window.setInterval(() => { refresh(); void load() }, 20000)
    return () => { active = false; window.clearInterval(poll); if (channel) void client?.removeChannel(channel) }
  }, [id, zone, load])

  async function change(action: string, payload: Record<string, unknown>) {
    setBusy(true)
    try {
      const next = await groups.change(action, payload)
      await load()
      if (action === 'leave') setSelected('')
      else { if (next !== selected) { setLive(false); setRankIssue(''); setSelected(next) }; setTab('mine') }
      setEditor(null)
      notify(action === 'leave' ? '스터디에서 나왔어요.' : action === 'goal' ? '공동 목표를 바꿨어요.' : '스터디에 참여했어요.')
    } catch (e) { notify(messageOf(e), true) } finally { setBusy(false) }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    if (editor === 'create') void change('create', { name: String(form.get('name')).trim(), description: String(form.get('description')).trim(), isPublic: form.get('visibility') === 'public', goalMinutes: Number(form.get('goal')) })
    if (editor === 'invite') void change('invite', { code: String(form.get('code')).trim() })
    if (editor === 'goal' && id) void change('goal', { id, goalMinutes: Number(form.get('goal')) })
    if (editor === 'leave' && id) void change('leave', { id })
  }
  const filtered = list?.filter(g => (tab === 'mine' ? !!g.role : g.isPublic && !g.role) && (g.name + ' ' + g.description).toLowerCase().includes(query.trim().toLowerCase()))
  const ranking = rank?.groupId === id ? rank?.data : null
  const members = ranking?.members
  const groupWeek = ranking?.week ?? 0
  return <div className="page-stack">
    <PageTitle label="STUDY TOGETHER" title="스터디" description="혼자 집중하고, 함께 기록해요." action={<div className="row-actions"><button className="btn btn-soft" onClick={() => setEditor('invite')}><KeyRound size={16} />초대 코드</button><button className="btn btn-primary" onClick={() => setEditor('create')}><Plus size={17} />그룹 만들기</button></div>} />
    <div className="dashboard-grid study-grid">
      <Card><div className="segmented"><button aria-pressed={tab === 'mine'} onClick={() => setTab('mine')}>내 그룹</button><button aria-pressed={tab === 'discover'} onClick={() => setTab('discover')}>공개 그룹</button></div>
        <div className="search-field"><Search size={17} /><input aria-label="그룹 검색" placeholder="이름으로 검색" value={query} onChange={e => setQuery(e.target.value)} /></div>
        {issue && <ErrorState message={issue} retry={() => void load()} />}
        {filtered ? filtered.length ? <div className="group-list">{filtered.map(g => <article className={'group-card ' + (g.id === id ? 'selected' : '')} key={g.id}>
          <IconBox icon={g.isPublic ? Globe2 : LockKeyhole} /><div><h3>{g.name}</h3><p>{g.description || '스터디 그룹'} · {g.members}명</p></div>
          <button className="btn btn-soft" disabled={busy} onClick={() => { if (!g.role) void change('join', { id: g.id }); else if (g.id !== selected) { setLive(false); setRankIssue(''); setSelected(g.id) } }}>{g.role ? '보기' : '가입'}</button>
        </article>)}</div> : <Empty icon={Users} title={query ? '검색 결과가 없어요' : '표시할 그룹이 없어요'} description="공개 그룹을 찾아보거나 새 그룹을 만들어 보세요." /> : !issue && <Loading />}
      </Card>
      <Card>{group ? <><CardTitle icon={Flag} title={group.name} sub={group.description || '집중 스터디'} action={<span className={'badge ' + (live ? 'badge-mint' : '')}>{live ? '실시간 연결' : '주기적으로 갱신'}</span>} />
        <div className="metric-line"><strong>{duration(groupWeek)}</strong><span>/ {duration(group.goalMinutes * 60)} · 주간 공동 목표</span></div><Progress label="주간 공동 목표" value={percent(groupWeek, group.goalMinutes * 60)} />
        <p className="muted mt-3 text-sm">그룹 누적 {ranking ? duration(ranking.total) : '—'}{group.inviteCode ? ' · 초대 코드 ' + group.inviteCode : ''}</p>
        <div className="row-actions">{group.role === 'owner' && <button className="btn btn-soft" onClick={() => setEditor('goal')}>공동 목표 수정</button>}<button className="btn btn-quiet" onClick={() => setEditor('leave')}>그룹 탈퇴</button></div>
        <StudyNotices key={group.id + ':notices'} groupId={group.id} isOwner={group.role === 'owner'} revision={revision} />
        <div className="ranking-heading"><h2>멤버 랭킹</h2><div className="segmented"><button aria-pressed={period === 'today'} onClick={() => setPeriod('today')}>오늘</button><button aria-pressed={period === 'week'} onClick={() => setPeriod('week')}>이번 주</button></div></div>
        {rankIssue && <ErrorState message={rankIssue} />}
        {members ? <ol className="data-list">{[...members].sort((a, b) => b[period] - a[period] || a.name.localeCompare(b.name)).map((m, i) => <li key={m.id}><span className="badge">{i + 1}</span><span className="grow"><strong>{m.name}{m.role === 'owner' ? ' · 그룹장' : ''}</strong><small>{(m.focusingUntil ?? 0) > now ? '집중 중 · ' : ''}일일 목표 {percent(m.today, m.goalMinutes * 60)}%</small></span><strong>{duration(m[period])}</strong></li>)}</ol> : !rankIssue && <Loading />}
        <StudyChallenges key={group.id} groupId={group.id} isOwner={group.role === 'owner'} revision={revision} />
        <StudyChat key={group.id + ':chat'} groupId={group.id} isOwner={group.role === 'owner'} revision={revision} />
      </> : <Empty icon={Trophy} title="스터디를 선택하세요" description="참여 중인 스터디를 열면 공동 목표와 랭킹을 볼 수 있어요." />}</Card>
    </div>
    {editor && <Dialog close={() => setEditor(null)} title={{ create: '그룹 만들기', invite: '초대 코드로 참여', goal: '공동 목표 수정', leave: '그룹 탈퇴' }[editor]}>
      <form className="form-stack" onSubmit={submit}>
        {editor === 'create' && <><Field label="그룹 이름"><input name="name" required maxLength={60} /></Field><Field label="소개"><textarea name="description" rows={3} maxLength={300} /></Field><Field label="공개 범위"><select name="visibility"><option value="public">공개</option><option value="private">초대 전용</option></select></Field></>}
        {(editor === 'create' || editor === 'goal') && <Field label="주간 공동 목표 (분)"><input type="number" min="1" max="1000000" required name="goal" defaultValue={editor === 'goal' ? group?.goalMinutes : 600} /></Field>}
        {editor === 'invite' && <Field label="초대 코드"><input name="code" required minLength={16} maxLength={16} autoComplete="off" /></Field>}
        {editor === 'leave' && <p className="muted">{group?.role === 'owner' ? '다른 멤버가 있다면 가장 먼저 참여한 멤버에게 그룹장 권한을 넘겨요. 혼자라면 그룹이 삭제됩니다.' : '탈퇴하면 이 그룹의 비공개 정보와 랭킹을 볼 수 없어요.'}</p>}
        <button className="btn btn-primary" disabled={busy}>{editor === 'leave' ? '탈퇴하기' : editor === 'invite' ? '참여하기' : '저장'}</button>
      </form>
    </Dialog>}
  </div>
}
