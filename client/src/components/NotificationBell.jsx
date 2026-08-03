import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Badge, Button } from './ui'
import { Bell, ShieldCheck, ShieldX } from 'lucide-react'
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

export default function NotificationBell() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const ref = useRef(null)

  const canApprove = ['owner', 'admin'].includes(user?.role)

  const load = useCallback(() => {
    if (!canApprove) return
    setLoading(true)
    setError(false)
    api.get('/finance/deletion-requests').then(({ data }) => {
      setRequests(data || [])
    }).catch(err => { console.error(err); setError(true) }).finally(() => setLoading(false))
  }, [canApprove])

  useEffect(() => { load() }, [load])

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
      load()
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to update approval') }
  }

  if (!canApprove) {
    return (
      <button className="relative p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors" aria-label="Notifications">
        <Bell size={18} />
      </button>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <button
        data-testid="notification-bell"
        onClick={() => { setOpen(!open); if (!open) load() }}
        className="relative p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {actionable.length > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />}
      </button>

      {open && (
        <div data-testid="notification-panel" className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">Deletion Requests</h3>
            <span className="text-[10px] text-slate-400">{requests.length} open</span>
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
            {loading ? (
              <div className="p-4 text-xs text-slate-400">Loading...</div>
            ) : error ? (
              <div className="p-4 text-xs text-red-500">Failed to load deletion requests. <button className="underline" onClick={load}>Retry</button></div>
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
  )
}
