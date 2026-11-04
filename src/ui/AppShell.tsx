import { BookOpen, ChevronDown, ChevronRight, CircleUserRound, House, LayoutDashboard, Timer, Users, Zap } from 'lucide-react'
import { NavLink, Link, Outlet, useLocation } from 'react-router'
import { useEffect } from 'react'
import { useApp } from '../state/context'
import { ErrorState, Loading } from './base'
import { levelFor, totals } from '../domain/model'
import { recoveryPath } from '../data/supabase'

const navigation = [
  { to: '/', name: '홈', icon: LayoutDashboard },
  { to: '/focus', name: '집중', icon: Timer },
  { to: '/study', name: '스터디', icon: Users },
  { to: '/growth', name: '성장', icon: House },
  { to: '/my', name: 'MY', icon: CircleUserRound },
]
function Brand() {
  return <Link className="brand" to="/" aria-label="ONMODE 홈"><span className="brand-mark"><Zap size={21} fill="currentColor" /></span>ONMODE<span className="brand-dot">.</span></Link>
}
function Nav({ mobile = false }: { mobile?: boolean }) {
  return <nav className={mobile ? 'bottom-nav' : 'sidebar-nav'} aria-label={mobile ? '하단 메뉴' : '주 메뉴'}>
    {navigation.map(({ to, name, icon: Icon }) => <NavLink end={to === '/'} key={to} to={to} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
      <Icon size={20} strokeWidth={1.85} aria-hidden /><span>{name}</span>{!mobile && <ChevronRight className="nav-chevron" size={14} aria-hidden />}
    </NavLink>)}
  </nav>
}
export function AppShell() {
  const { authReady, snapshot, issue, reload, session } = useApp()
  const { pathname } = useLocation()
  const active = navigation.find(n => n.to === pathname)
  const name = snapshot?.profile.name ?? '집중러'
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return <div className="shell">
    <a href="#main-content" className="skip-link">본문으로 이동</a>
    <aside className="sidebar">
      <Brand /><div className="workspace-label">WORKSPACE</div><Nav />
      <div className="sidebar-bottom">
        <div className="sidebar-note"><Zap size={16} /><div><strong>나만의 집중 루틴</strong><p>집중을 켜다, 성장을 쌓다.</p></div></div>
        <Link to="/my" className="side-profile"><span className="avatar">{name.slice(0, 1)}</span><span><strong>{name}</strong><small>Lv. {snapshot ? levelFor(totals(snapshot).xp) : 1} · {session ? '내 계정' : '체험 모드'}</small></span><ChevronDown className="ml-auto" size={14} /></Link>
      </div>
    </aside>
    <div className="app-body">
      <header className="topbar"><div className="top-desktop"><span>내 워크스페이스</span><ChevronRight size={13} /><strong>{pathname === '/library' ? '학습·독서' : pathname === '/account' || pathname === recoveryPath ? '계정' : active?.name ?? '온모드'}</strong></div>
        <div className="top-mobile"><Brand /></div>
        <div className="top-actions"><Link to="/library" className="btn btn-quiet header-library"><BookOpen size={16} />학습·독서</Link><Link to={session ? '/my' : '/account'} className="mode-chip"><i />{session ? '계정 연결됨' : '로컬 체험 모드'}</Link></div>
      </header>
      <main id="main-content" className="main" tabIndex={-1}>
        {issue && <ErrorState message={issue} retry={reload} />}
        {snapshot || pathname === '/account' || (authReady && pathname === recoveryPath) ? <Outlet /> : !issue && <Loading />}
      </main>
      <footer className="app-footer"><span>ONMODE</span> 집중을 켜다, 성장을 쌓다.</footer>
    </div>
    <Nav mobile />
  </div>
}
