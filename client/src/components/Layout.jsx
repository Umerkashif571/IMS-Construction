import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Outlet, NavLink, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ErrorBoundary from './ErrorBoundary'
import NotificationMenu from './NotificationMenu'
import logo from '../assets/logo.jpg'
import {
  LayoutDashboard, Package, Truck, Wrench, Building2, Store, Warehouse,
  BarChart3, Users, Shield, Ticket, LogOut, Menu, ChevronLeft, Landmark, X, ChevronRight,
} from 'lucide-react'

// Single source of truth for navigation. `roles` mirror server/src/middleware/auth.js ROLES.
export const NAV_GROUPS = [
  { label: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff', 'finance'] },
  ] },
  { label: 'Inventory', items: [
    { to: '/materials', label: 'Materials', icon: Package, roles: ['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff'] },
    { to: '/warehouses', label: 'Warehouses', icon: Warehouse, roles: ['owner', 'admin', 'store_manager', 'manager', 'staff'] },
    { to: '/gatepass', label: 'Gate Passes', icon: Ticket, roles: ['owner', 'admin', 'store_manager', 'manager', 'staff'] },
  ] },
  { label: 'Assets', items: [
    { to: '/vehicles', label: 'Vehicles', icon: Truck, roles: ['owner', 'admin', 'store_manager', 'site_engineer', 'manager', 'staff'] },
    { to: '/tools', label: 'Tools & Equipment', icon: Wrench, roles: ['owner', 'admin', 'store_manager', 'site_engineer', 'manager', 'staff'] },
  ] },
  { label: 'Projects & Procurement', items: [
    { to: '/projects', label: 'Projects', icon: Building2, roles: ['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff', 'finance'] },
    { to: '/vendors', label: 'Vendors & POs', icon: Store, roles: ['owner', 'admin', 'procurement_officer', 'store_manager', 'manager', 'staff', 'finance'] },
  ] },
  { label: 'Finance & Insight', items: [
    { to: '/bankbook', label: 'Bank Book', icon: Landmark, roles: ['owner', 'admin', 'finance'] },
    { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['owner', 'admin', 'store_manager', 'procurement_officer', 'manager', 'staff'] },
  ] },
  { label: 'Administration', items: [
    { to: '/users', label: 'Users', icon: Users, roles: ['owner', 'admin'] },
    { to: '/backup', label: 'Backup', icon: Shield, roles: ['owner', 'admin'] },
  ] },
]
export const navItems = NAV_GROUPS.flatMap(g => g.items)

export const ROLE_LABELS = {
  owner: 'Owner', admin: 'Admin', store_manager: 'Store Manager', site_engineer: 'Site Engineer',
  procurement_officer: 'Procurement', manager: 'Manager', staff: 'Staff', finance: 'Finance',
}
const ROLE_TONES = {
  owner: 'bg-purple-500/15 text-purple-200 ring-purple-400/30', admin: 'bg-red-500/15 text-red-200 ring-red-400/30',
  store_manager: 'bg-sky-500/15 text-sky-200 ring-sky-400/30', site_engineer: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30',
  procurement_officer: 'bg-violet-500/15 text-violet-200 ring-violet-400/30', manager: 'bg-indigo-500/15 text-indigo-200 ring-indigo-400/30',
  staff: 'bg-amber-500/15 text-amber-200 ring-amber-400/30', finance: 'bg-teal-500/15 text-teal-200 ring-teal-400/30',
}

const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'

function NavItem({ item, collapsed, onNavigate }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => [
        'group relative flex items-center gap-3 rounded-lg text-[13.5px] font-medium transition-colors duration-150 outline-none',
        collapsed ? 'h-10 justify-center px-0' : 'h-10 px-3',
        isActive ? 'bg-white/[0.07] text-white' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100',
        'focus-visible:ring-2 focus-visible:ring-amber-400/70',
      ].join(' ')}
    >
      {({ isActive }) => (
        <>
          {isActive && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-amber-400" />}
          <item.icon size={18} strokeWidth={isActive ? 2.25 : 1.9} className={`shrink-0 ${isActive ? 'text-amber-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </>
      )}
    </NavLink>
  )
}

function Sidebar({ user, collapsed, setCollapsed, open, onClose, onLogout }) {
  const groups = useMemo(() => NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => i.roles.includes(user?.role)) }))
    .filter(g => g.items.length > 0), [user?.role])

  return (
    <aside
      aria-label="Main navigation"
      className={[
        'fixed inset-y-0 left-0 z-40 flex flex-col bg-slate-950 text-white shadow-2xl shadow-black/40 transition-[transform,width] duration-200 ease-out',
        'lg:sticky lg:top-0 lg:h-dvh lg:self-start lg:z-auto lg:translate-x-0 lg:shadow-none',
        collapsed ? 'lg:w-[72px]' : 'lg:w-64',
        'w-72',
        open ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')}
    >
      {/* Brand */}
      <div className={`flex h-16 shrink-0 items-center border-b border-white/[0.06] ${collapsed ? 'justify-center px-0' : 'px-4'}`}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5 shadow-md shadow-black/30">
          <img src={logo} alt="" className="h-full w-full object-contain" />
        </div>
        {!collapsed && (
          <div className="ml-3 min-w-0 leading-tight">
            <div className="truncate text-[13.5px] font-semibold tracking-tight text-white">Al Shafi Enterprises</div>
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-amber-400/90">Asset Management</div>
          </div>
        )}
        <button type="button" onClick={onClose} aria-label="Close menu" className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden">
          <X size={18} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((g, gi) => (
          <div key={g.label} className={gi === 0 ? '' : 'mt-5'}>
            {collapsed
              ? gi > 0 && <div className="mx-2 mb-3 border-t border-white/[0.06]" />
              : <div className="mb-1.5 px-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{g.label}</div>}
            <div className="space-y-0.5">
              {g.items.map(item => <NavItem key={item.to} item={item} collapsed={collapsed} onNavigate={onClose} />)}
            </div>
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="shrink-0 border-t border-white/[0.06] p-3">
        <div className={`flex items-center gap-3 rounded-xl bg-white/[0.04] p-2 ${collapsed ? 'justify-center' : ''}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-xs font-bold text-slate-950 shadow-inner" title={user?.full_name}>
            {initials(user?.full_name)}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-white">{user?.full_name}</p>
              <span className={`mt-0.5 inline-flex rounded-md px-1.5 py-px text-[10px] font-semibold ring-1 ${ROLE_TONES[user?.role] || 'bg-white/10 text-slate-300 ring-white/10'}`}>
                {ROLE_LABELS[user?.role] || user?.role}
              </span>
            </div>
          )}
          {!collapsed && (
            <button type="button" onClick={onLogout} title="Sign out" aria-label="Sign out" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70">
              <LogOut size={16} />
            </button>
          )}
        </div>
        {collapsed && (
          <button type="button" onClick={onLogout} title="Sign out" aria-label="Sign out" className="mt-2 flex h-9 w-full items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white">
            <LogOut size={16} />
          </button>
        )}
      </div>

      {/* Collapse toggle (desktop) */}
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="hidden h-10 shrink-0 items-center justify-center border-t border-white/[0.06] text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-white lg:flex"
      >
        <ChevronLeft size={16} className={`transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`} />
      </button>
    </aside>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('ims_sidebar') === 'collapsed' } catch { return false } })
  const mainRef = useRef(null)

  useEffect(() => { try { localStorage.setItem('ims_sidebar', collapsed ? 'collapsed' : 'open') } catch { /* ignore */ } }, [collapsed])

  // Drawer: close on route change and on Escape; lock body scroll while open
  useEffect(() => { setOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])

  // Scroll the content pane to the top on navigation
  useEffect(() => { mainRef.current?.scrollTo?.({ top: 0 }) }, [location.pathname])

  const current = useMemo(() => {
    const path = location.pathname
    return navItems.find(i => i.to === path) || navItems.find(i => i.to !== '/' && path.startsWith(i.to)) || navItems[0]
  }, [location.pathname])

  const handleLogout = useCallback(() => { logout(); navigate('/login', { replace: true }) }, [logout, navigate])

  const today = useMemo(() => new Date().toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), [])

  return (
    <div className="flex min-h-dvh bg-slate-50 text-slate-900">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg">Skip to content</a>

      {open && <div className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-[2px] lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <Sidebar user={user} collapsed={collapsed} setCollapsed={setCollapsed} open={open} onClose={() => setOpen(false)} onLogout={handleLogout} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/75 lg:px-6">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 lg:hidden">
            <Menu size={20} />
          </button>

          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
            <Link to="/" className="hidden text-slate-400 hover:text-slate-600 sm:inline">Home</Link>
            {current?.to !== '/' && <ChevronRight size={14} className="hidden text-slate-300 sm:inline" aria-hidden="true" />}
            <span className="truncate font-semibold text-slate-800">{current?.label || 'Dashboard'}</span>
          </nav>

          <div className="flex-1" />

          <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500 md:inline-flex">{today}</span>

          <NotificationMenu />

          <div className="hidden h-6 w-px bg-slate-200 sm:block" />
          <div className="hidden items-center gap-2.5 sm:flex">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">{initials(user?.full_name)}</div>
            <div className="leading-tight">
              <p className="max-w-[160px] truncate text-[13px] font-medium text-slate-800">{user?.full_name}</p>
              <p className="text-[11px] text-slate-500">{ROLE_LABELS[user?.role] || user?.role}</p>
            </div>
          </div>
        </header>

        <main id="main" ref={mainRef} tabIndex={-1} className="flex-1 overflow-auto px-4 py-5 outline-none sm:px-6 lg:px-8 lg:py-6">
          <div className="mx-auto w-full max-w-[1400px]">
            {/* keyed by path so a crash on one page is contained and clears on navigation */}
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
