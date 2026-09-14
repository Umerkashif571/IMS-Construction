import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { DollarSign, Building2, Truck, Wrench, AlertTriangle, Settings, Activity, Package } from 'lucide-react'
import bannerImg from '../assets/banner-collage.jpg'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import api from '../api'
import { StatCard, Card, CardHeader, CardContent, LoadingSkeleton, EmptyState } from '../components/ui'
import toast from 'react-hot-toast'
import { formatPKR, formatPKRWhole } from '../format'
import { useCoalescedRealtime } from '../hooks/useRealtime'

// Large rupee amounts in a KPI tile: 'Rs 479.5M' (exact value goes in the hint)
const compactPKR = (v) => {
  const n = Number(v || 0)
  const abs = Math.abs(n)
  if (abs >= 1e9) return `Rs ${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `Rs ${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `Rs ${(n / 1e3).toFixed(0)}K`
  return `Rs ${n.toLocaleString('en-PK')}`
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const { user } = useAuth()

  const loadDashboard = useCallback(() => {
    api.get('/dashboard').then(({ data }) => {
      setData(data?.data || data)
      setLoading(false)
    }).catch(err => { console.error(err); setLoading(false); toast.error('Failed to load dashboard') })
  }, [])

  useEffect(() => { loadDashboard() }, [loadDashboard])

  const dashboardSubscriptions = useMemo(() => [
    { table: 'materials', event: '*' },
    { table: 'stock_movements', event: '*' },
  ], [])

  useCoalescedRealtime(dashboardSubscriptions, useCallback((payloads) => {
    console.log('Coalesced realtime updates on dashboard:', payloads.length, 'events')
    loadDashboard()
  }, [loadDashboard]), { debounceMs: 500 })

  const budgetData = useMemo(() => {
    const budgets = data?.project_budgets
    const arr = Array.isArray(budgets) ? budgets : (budgets?.data ? Array.isArray(budgets.data) ? budgets.data : [] : [])
    return arr.slice(0, 8).map(p => ({
      name: p.name?.length > 18 ? p.name.slice(0, 18) + '...' : p.name,
      cost: parseFloat(p.total_material_cost || 0),
    }))
  }, [data?.project_budgets])

  const categoryData = useMemo(() => {
    const categories = data?.category_breakdown
    const arr = Array.isArray(categories) ? categories : (categories?.data ? Array.isArray(categories.data) ? categories.data : [] : [])
    return arr.slice(0, 8).map(c => ({
      name: c.name,
      value: parseFloat(c.total_value || 0),
    }))
  }, [data?.category_breakdown])

  const recentActivity = useMemo(() => {
    const activity = data?.recent_activity
    return Array.isArray(activity) ? activity : (activity?.data ? Array.isArray(activity.data) ? activity.data : [] : [])
  }, [data?.recent_activity])

  const cards = [
    { label: 'Inventory Value', value: compactPKR(data?.inventory_value), hint: formatPKRWhole(data?.inventory_value), icon: DollarSign, color: 'emerald', to: '/materials' },
    { label: 'Active Projects', value: data?.active_projects || 0, icon: Building2, color: 'blue', to: '/projects' },
    { label: 'Vehicles in Use', value: data?.vehicles_active || 0, icon: Truck, color: 'amber', to: '/vehicles' },
    { label: 'Tools Checked Out', value: data?.tools_checked_out || 0, icon: Wrench, color: 'purple', to: '/tools' },
    { label: 'Low Stock Alerts', value: data?.low_stock_count || 0, icon: AlertTriangle, color: 'red', to: '/materials?low_stock=true' },
    { label: 'Maintenance Due', value: data?.maintenance_due_count || 0, icon: Settings, color: 'amber', to: '/vehicles' },
  ]

  const COLORS = ['#059669', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316']
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = (user?.full_name || '').trim().split(/\s+/)[0] || 'there'

  if (loading) return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 skeleton rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-80 skeleton rounded-xl" />
        <div className="h-80 skeleton rounded-xl" />
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <section className="relative overflow-hidden rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-900/10">
        <img src={bannerImg} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/60 to-slate-950/10" />
        <div className="relative flex min-h-[7.5rem] flex-col justify-end gap-1 p-5 sm:min-h-[10rem] sm:p-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400">{greeting}</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Welcome back, {firstName}</h1>
          <p className="max-w-xl text-sm text-slate-300">Here's what's happening across your sites, stores and fleet today.</p>
        </div>
      </section>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {cards.map(c => (
          <Link key={c.label} to={c.to}>
            <StatCard label={c.label} value={c.value} hint={c.hint} icon={c.icon} color={c.color} />
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Project Material Investment */}
        <Card>
          <CardHeader title="Project Material Investment" />
          <CardContent>
            {budgetData.length === 0 ? (
              <EmptyState icon={Package} title="No project data" text="No material cost data available yet" />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={budgetData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                      formatter={v => [formatPKR(v), 'Material Cost']}
                    />
                    <Bar dataKey="cost" fill="#059669" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Category Breakdown */}
        <Card>
          <CardHeader title="Inventory by Category" />
          <CardContent>
            {categoryData.length === 0 ? (
              <EmptyState icon={Package} title="No categories" text="No inventory data available" />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%" cy="45%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {categoryData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                      formatter={v => [formatPKR(v), 'Value']}
                    />
                    <Legend
                      layout="vertical"
                      align="right"
                      verticalAlign="middle"
                      iconType="circle"
                      formatter={(value) => <span className="text-xs text-slate-600">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader title="Recent Activity" action={<span className="text-xs text-slate-400">{recentActivity.length} entries</span>} />
        <CardContent className="max-h-72 overflow-y-auto">
          {recentActivity.length === 0 ? (
            <EmptyState icon={Activity} title="No recent activity" text="Activity feed will appear here" />
          ) : (
            <div className="space-y-1">
              {recentActivity.map(a => (
                <div key={a.id} className="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs font-bold flex-shrink-0">
                    {a.user_name?.charAt(0) || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-700">
                      <span className="font-semibold">{a.user_name}</span> {a.description}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {a.created_at ? new Date(a.created_at).toLocaleString() : '-'}
                    </p>
                  </div>
                  <span className={`badge flex-shrink-0 ${
                    a.action === 'created' ? 'bg-emerald-100 text-emerald-700' :
                    a.action === 'deleted' ? 'bg-red-100 text-red-700' :
                    a.action === 'updated' ? 'bg-blue-100 text-blue-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>{a.action}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
