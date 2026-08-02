import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import logo from '../assets/logo.jpg'
import footerImg from '../assets/banner-text.jpg'
import {
  LayoutDashboard, Package, Truck, Wrench, Building2, Store, Warehouse,
  BarChart3, Users, Shield, Ticket, LogOut, Menu, Bell, ChevronLeft,
  Search, X
} from 'lucide-react'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff', 'finance'] },
  { to: '/materials', label: 'Materials', icon: Package, roles: ['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff'] },
  { to: '/vehicles', label: 'Vehicles', icon: Truck, roles: ['owner', 'admin', 'store_manager', 'site_engineer', 'manager', 'staff'] },
  { to: '/tools', label: 'Tools & Equipment', icon: Wrench, roles: ['owner', 'admin', 'store_manager', 'site_engineer', 'manager', 'staff'] },
  { to: '/projects', label: 'Projects', icon: Building2, roles: ['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff', 'finance'] },
  { to: '/vendors', label: 'Vendors', icon: Store, roles: ['owner', 'admin', 'procurement_officer', 'store_manager', 'manager', 'staff'] },
  { to: '/warehouses', label: 'Warehouses', icon: Warehouse, roles: ['owner', 'admin', 'store_manager', 'manager', 'staff'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['owner', 'admin', 'store_manager', 'procurement_officer', 'manager', 'staff'] },
  { to: '/gatepass', label: 'Gate Passes', icon: Ticket, roles: ['owner', 'admin', 'store_manager', 'manager', 'staff'] },
  { to: '/users', label: 'Users', icon: Users, roles: ['owner', 'admin'] },
  { to: '/backup', label: 'Backup', icon: Shield, roles: ['owner', 'admin'] },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const handleLogout = () => { logout(); navigate('/login') }

  const roleBadgeMap = {
    owner: 'bg-purple-100 text-purple-800', admin: 'bg-red-100 text-red-800',
    store_manager: 'bg-blue-100 text-blue-800', site_engineer: 'bg-green-100 text-green-800',
    procurement_officer: 'bg-purple-100 text-purple-800', manager: 'bg-indigo-100 text-indigo-800',
    staff: 'bg-amber-100 text-amber-800', finance: 'bg-teal-100 text-teal-800',
  }
  const roleLabelMap = {
    owner: 'Owner', admin: 'Admin', store_manager: 'Store Manager',
    site_engineer: 'Site Engineer', procurement_officer: 'Procurement',
    manager: 'Manager', staff: 'Staff', finance: 'Finance',
  }

  const visibleItems = navItems.filter(item => item.roles.includes(user?.role))

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-slate-900/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-30 bg-slate-900 text-white flex flex-col transition-all duration-200
        ${collapsed ? 'w-16' : 'w-64'} 
        lg:translate-x-0 lg:static lg:z-auto
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>

        {/* Logo */}
        <div className={`flex items-center border-b border-slate-700/50 h-16 ${collapsed ? 'justify-center px-0' : 'px-5'}`}>
          <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden p-0.5">
            <img src={logo} alt="Logo" className="w-full h-full object-contain" />
          </div>
          {!collapsed && (
            <div className="ml-3 min-w-0">
              <h1 className="font-bold text-sm leading-tight text-white">Al Shafi Enterprises</h1>
              <p className="text-slate-400 text-[10px] leading-tight">Asset Management</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
          {visibleItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${collapsed ? 'justify-center px-0' : ''}
                ${isActive ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-slate-300 hover:bg-slate-800 hover:text-white border border-transparent'}`
              }
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={collapsed ? 20 : 18} className="flex-shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex items-center justify-center h-10 border-t border-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <ChevronLeft size={16} className={`transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>

        {/* Footer banner */}
        {!collapsed && (
          <div className="border-t border-slate-700/50 px-3 py-3">
            <img src={footerImg} alt="Banner" className="w-full h-16 object-cover rounded" />
            <p className="text-[10px] text-slate-400 text-center mt-1.5">Building Excellence Since Day One</p>
          </div>
        )}

        {/* User area */}
        <div className={`border-t border-slate-700/50 p-3 ${collapsed ? 'text-center' : ''}`}>
          <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
            <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center text-xs font-bold text-slate-300 flex-shrink-0">
              {user?.full_name?.charAt(0) || '?'}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate text-white">{user?.full_name}</p>
                <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded ${roleBadgeMap[user?.role] || 'bg-slate-600 text-slate-300'}`}>
                  {roleLabelMap[user?.role] || user?.role}
                </span>
              </div>
            )}
            <button onClick={handleLogout} className="text-slate-400 hover:text-white p-1 transition-colors flex-shrink-0" title="Logout">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        {/* Topbar */}
        <header className="bg-white border-b border-slate-200 h-16 flex items-center gap-3 px-4 lg:px-6 no-print sticky top-0 z-10">
          <button className="lg:hidden p-2 hover:bg-slate-100 rounded-lg text-slate-600" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>

          <div className="flex-1" />

          {/* Notification bell */}
          <button className="relative p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
            <Bell size={18} />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
          </button>

          <div className="h-6 w-px bg-slate-200" />

          <div className="hidden sm:flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-800 rounded-full flex items-center justify-center text-white text-xs font-bold">
              {user?.full_name?.charAt(0) || '?'}
            </div>
            <div className="text-right">
              <p className="text-xs font-medium text-slate-700 leading-tight">{user?.full_name}</p>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${roleBadgeMap[user?.role] || 'bg-slate-100 text-slate-600'}`}>
                {roleLabelMap[user?.role] || user?.role}
              </span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
