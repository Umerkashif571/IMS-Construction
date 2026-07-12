import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { DollarSign, Building2, Truck, Wrench, AlertTriangle, Settings, Activity, Package } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import api from '../api'
import { StatCard, Card, CardHeader, CardContent, LoadingSkeleton, EmptyState } from '../components/ui'
import toast from 'react-hot-toast'

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/dashboard').then(({ data }) => {
      setData(data)
      setLoading(false)
    }).catch(err => { console.error(err); setLoading(false); toast.error('Failed to load dashboard') })
  }, [])

  if (loading) return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
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

  const cards = [
    { label: 'Inventory Value', value: `PKR ${(data?.inventory_value || 0).toLocaleString()}`, icon: DollarSign, color: 'emerald', to: '/materials' },
    { label: 'Active Projects', value: data?.active_projects || 0, icon: Building2, color: 'blue', to: '/projects' },
    { label: 'Vehicles in Use', value: data?.vehicles_active || 0, icon: Truck, color: 'amber', to: '/vehicles' },
    { label: 'Tools Checked Out', value: data?.tools_checked_out || 0, icon: Wrench, color: 'purple', to: '/tools' },
    { label: 'Low Stock Alerts', value: data?.low_stock_count || 0, icon: AlertTriangle, color: 'red', to: '/materials?low_stock=true' },
    { label: 'Maintenance Due', value: data?.maintenance_due_count || 0, icon: Settings, color: 'amber', to: '/tools?maintenance_due=true' },
  ]

  const COLORS = ['#059669', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316']

  const budgetData = (data?.project_budgets || []).slice(0, 8).map(p => ({
    name: p.name?.length > 18 ? p.name.slice(0, 18) + '...' : p.name,
    cost: parseFloat(p.total_material_cost || 0),
  }))

  const categoryData = (data?.category_breakdown || []).slice(0, 8).map(c => ({
    name: c.name,
    value: parseFloat(c.total_value || 0),
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">Enterprise Asset Management Overview</p>
        </div>
        <span className="text-[11px] text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full font-medium">
          {new Date().toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map(c => (
          <Link key={c.label} to={c.to}>
            <StatCard label={c.label} value={c.value} icon={c.icon} color={c.color} />
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
                      formatter={v => [`PKR ${Number(v).toLocaleString()}`, 'Material Cost']}
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
                      formatter={v => [`PKR ${Number(v).toLocaleString()}`, 'Value']}
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
        <CardHeader title="Recent Activity" action={<span className="text-xs text-slate-400">{data?.recent_activity?.length || 0} entries</span>} />
        <CardContent className="max-h-72 overflow-y-auto">
          {(data?.recent_activity || []).length === 0 ? (
            <EmptyState icon={Activity} title="No recent activity" text="Activity feed will appear here" />
          ) : (
            <div className="space-y-1">
              {(data?.recent_activity || []).map(a => (
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
