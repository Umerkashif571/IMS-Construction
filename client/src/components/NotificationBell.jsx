import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Badge, Button } from './ui'
import { Bell, ShieldCheck, ShieldX, CheckCheck } from 'lucide-react'
import toast from 'react-hot-toast'

const TX_LABELS = {
  salary: 'Salary',
  petty_cash: 'Petty Cash',
  vendor_payment: 'Vendor Payment',
}

const formatPKR = (v) => {
  const n = Math.round(parseFloat(v) || 0)
  const sign = n < 0 ? '-' : ''
  const s = String(Math.abs(n))
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3)
  return `Rs. ${sign}${rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3}`
}

const statusBadge = (d) => {
  const map = { pending: 'warning', approved: 'success', rejected: 'error' }
  return <Badge variant={map[d] || 'default'}>{d}</Badge>
}

const TYPE_LABELS = {
  deletion_request: 'Deletion',
  purchase_order: 'Purchase Order',
  gate_pass: 'Gate Pass',
  tool_overdue: 'Tool Overdue',
  low_stock: 'Low Stock',
  user_created: 'New User',
}

const TYPE_VARIANTS = {
  deletion_request: 'info',
  purchase_order: 'purple',
  gate_pass: 'warning',
  tool_overdue: 'error',
  low_stock: 'error',
  user_created: 'success',
}

const timeAgo = (iso) => {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('alerts')
  const [alerts, setAlerts] = useState([])
  const [requests, setRequests] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const ref = useRef(null)

  const canApprove = ['owner', 'admin'].includes(user?.role)

  const loadAlerts = useCallback(() => {
    api.get('/notifications').then(({ data }) => setAlerts(data || [])).catch(err => console.error(err))
  }, [])

  const loadUnread = useCallback(() => {
    api.get('/notifications/unread-count').then(({ data }) => setUnread(data?.count || 0)).catch(err => console.error(err))
  }, [])

  const loadRequests = useCallback(() => {
    if (!canApprove) return
    setLoading(true)
    setError(false)
    api.get('/finance/deletion-requests').then(({ data }) => {
      setRequests(data || [])
    }).catch(err => { console.error(err); setError(true) }).finally(() => setLoading(false))
  }, [canApprove])

  const loadAll = useCallback(() => {
    loadAlerts()
    loadUnread()
    if (open) loadRequests()
  }, [loadAlerts, loadUnread, loadRequests, open])

  // Initial load + refresh when panel opens
  useEffect(() => { loadAll() }, [loadAll])

  // Poll unread count every 15s while the tab is visible; refresh on window focus
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') { loadUnread(); loadAlerts() }
    }
    const id = setInterval(tick, 15000)
    window.addEventListener('focus', tick)
    return () => { clearInterval(id); window.removeEventListener('focus', tick) }
  }, [loadUnread, loadAlerts])

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const actionable = requests.filter(r =>
    r.admin_approval === 'pending' || (user?.role === 'owner' && r.owner_approval === 'pending')
  )

  const handleApproval = async (r, level, approve) => {
    try {
      await api.patch(`/projects/${r.project_id}/finance/deletion-requests/${r.id}/${level}-approve`, { approve })
      toast.success(approve ? 'Deletion request approved' : 'Deletion request rejected')
      loadRequests()
      loadUnread()
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to update approval') }
  }

  const handleOpen = () => {
    setOpen(!open)
    if (!open) { loadAll(); if (tab !== 'alerts') setTab('alerts') }
  }

  const handleClickAlert = async (n) => {
    if (!n.is_read) {
      api.patch(`/notifications/${n.id}/read`).then(() => {
        setAlerts(prev => prev.map(a => a.id === n.id ? { ...a, is_read: true } : a))
        setUnread(u => Math.max(0, u - 1))
      }).catch(err => console.error(err))
    }
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  const markAll = () => {
    api.patch('/notifications/mark-all-read').then(() => {
      setAlerts(prev => prev.map(a => ({ ...a, is_read: true })))
      setUnread(0)
      toast.success('All notifications marked as read')
    }).catch(err => console.error(err))
  }

  const unreadAlerts = alerts.filter(a => !a.is_read).length

  return (
    <div className="relative" ref={ref}>
      <button
        data-testid="notification-bell"
        onClick={handleOpen}
        className="relative p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />}
      </button>

      {open && (
        <div data-testid="notification-panel" className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
          {canApprove && (
            <div className="flex border-b border-slate-100">
              <button
                onClick={() => setTab('alerts')}
                className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors ${tab === 'alerts' ? 'text-slate-800 border-b-2 border-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Alerts{unreadAlerts > 0 ? ` (${unreadAlerts})` : ''}
              </button>
              <button
                onClick={() => setTab('requests')}
                className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors ${tab === 'requests' ? 'text-slate-800 border-b-2 border-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Deletion Requests{actionable.length > 0 ? ` (${actionable.length})` : ''}
              </button>
            </div>
          )}

          {tab === 'alerts' && (
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800">Notifications</h3>
                {alerts.length > 0 && (
                  <button onClick={markAll} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors">
                    <CheckCheck size={12} /> Mark all read
                  </button>
                )}
              </div>
              {alerts.length === 0 ? (
                <div className="p-4 text-xs text-slate-400">No notifications yet</div>
              ) : (
                alerts.map(n => (
                  <button
                    key={n.id}
                    onClick={() => handleClickAlert(n)}
                    className={`w-full text-left p-3 hover:bg-slate-50 transition-colors ${n.is_read ? 'opacity-70' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={TYPE_VARIANTS[n.type] || 'default'}>{TYPE_LABELS[n.type] || n.type}</Badge>
                      <span className="text-[10px] text-slate-400 shrink-0">{timeAgo(n.created_at)}</span>
                    </div>
                    <p className={`text-xs mt-1.5 ${n.is_read ? 'text-slate-500 font-medium' : 'text-slate-800 font-semibold'}`}>{n.title}</p>
                    {n.message && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>}
                    {!n.is_read && <span className="inline-block mt-1 w-1.5 h-1.5 bg-blue-500 rounded-full" />}
                  </button>
                ))
              )}
            </div>
          )}

          {tab === 'requests' && canApprove && (
            <div>
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800">Deletion Requests</h3>
                <span className="text-[10px] text-slate-400">{requests.length} open</span>
              </div>
              <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
                {loading ? (
                  <div className="p-4 text-xs text-slate-400">Loading...</div>
                ) : error ? (
                  <div className="p-4 text-xs text-red-500">Failed to load deletion requests. <button className="underline" onClick={loadRequests}>Retry</button></div>
                ) : requests.length === 0 ? (
                  <div className="p-4 text-xs text-slate-400">No pending deletion requests</div>
                ) : (
                  requests.map(r => (
                    <div key={r.id} className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="info">{TX_LABELS[r.transaction_type] || r.transaction_type}</Badge>
                        {statusBadge(r.final_status)}
                      </div>
                      <p className="text-xs font-semibold text-slate-700 mt-1.5">{r.project_name || 'Unknown project'}</p>
                      <p className="text-xs text-slate-600">{formatPKR(r.snapshot_data?.amount)} — {r.reason || 'No reason provided'}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">by {r.requested_by_name || '-'} · {r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</p>
                      {r.final_status === 'pending' && r.admin_approval === 'pending' && (
                        <div className="flex gap-2 mt-2">
                          <Button size="sm" onClick={() => handleApproval(r, 'admin', true)}><ShieldCheck size={13} /> Approve</Button>
                          <Button size="sm" variant="destructive" onClick={() => handleApproval(r, 'admin', false)}><ShieldX size={13} /> Reject</Button>
                        </div>
                      )}
                      {r.final_status === 'pending' && r.admin_approval === 'approved' && r.owner_approval === 'pending' && user?.role === 'owner' && (
                        <div className="flex gap-2 mt-2">
                          <Button size="sm" onClick={() => handleApproval(r, 'owner', true)}><ShieldCheck size={13} /> Final Approve</Button>
                          <Button size="sm" variant="destructive" onClick={() => handleApproval(r, 'owner', false)}><ShieldX size={13} /> Final Reject</Button>
                        </div>
                      )}
                      {r.final_status === 'pending' && r.admin_approval === 'approved' && r.owner_approval === 'pending' && user?.role !== 'owner' && (
                        <p className="text-[10px] text-slate-400 mt-1.5">Awaiting owner approval</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
