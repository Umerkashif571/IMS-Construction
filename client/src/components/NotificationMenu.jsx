import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, CheckCheck } from 'lucide-react'
import api from '../api'

// Header notification bell. Polls the REST API (no Supabase realtime) — every 60 s in the
// background, immediately when the tab regains focus, and when the menu is opened.
const POLL_MS = 60000

const timeAgo = (d) => {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`
  return new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })
}

export default function NotificationMenu() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const rootRef = useRef(null)
  const navigate = useNavigate()

  const refreshCount = useCallback(async () => {
    try { const { data } = await api.get('/notifications/unread-count'); setUnread(Number(data?.count) || 0) } catch { /* offline: keep last */ }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/notifications?limit=12')
      setItems(Array.isArray(data?.data) ? data.data : [])
      if (data?.pagination?.unreadCount != null) setUnread(Number(data.pagination.unreadCount) || 0)
    } catch { /* keep previous */ } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refreshCount()
    const t = setInterval(refreshCount, POLL_MS)
    const onFocus = () => { if (document.visibilityState === 'visible') refreshCount() }
    document.addEventListener('visibilitychange', onFocus)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onFocus) }
  }, [refreshCount])

  useEffect(() => { if (open) load() }, [open, load])

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const markRead = async (n) => {
    if (n.is_read) return
    setItems(list => list.map(x => x.id === n.id ? { ...x, is_read: true } : x))
    setUnread(u => Math.max(0, u - 1))
    try { await api.patch(`/notifications/${n.id}/read`) } catch { /* ignore */ }
  }
  const markAll = async () => {
    setItems(list => list.map(x => ({ ...x, is_read: true }))); setUnread(0)
    try { await api.patch('/notifications/mark-all-read') } catch { /* ignore */ }
  }
  const openItem = async (n) => {
    await markRead(n)
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <Bell size={19} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] origin-top-right overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-semibold text-slate-800">Notifications</div>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-800">
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {loading && items.length === 0 && (
              <li className="px-4 py-8 text-center text-xs text-slate-400">Loading…</li>
            )}
            {!loading && items.length === 0 && (
              <li className="px-4 py-10 text-center">
                <Bell size={22} className="mx-auto mb-2 text-slate-300" />
                <div className="text-sm font-medium text-slate-600">You're all caught up</div>
                <div className="text-xs text-slate-400">New activity will show up here.</div>
              </li>
            )}
            {items.map(n => (
              <li key={n.id} className={`border-b border-slate-50 last:border-0 ${n.is_read ? '' : 'bg-amber-50/50'}`}>
                <button type="button" onClick={() => openItem(n)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50">
                  <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? 'bg-transparent ring-1 ring-slate-200' : 'bg-amber-500'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-slate-800">{n.title}</span>
                    {n.message && <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{n.message}</span>}
                    <span className="mt-1 block text-[11px] text-slate-400">{timeAgo(n.created_at)}</span>
                  </span>
                  {!n.is_read && (
                    <span onClick={(e) => { e.stopPropagation(); markRead(n) }} title="Mark as read" className="rounded-md p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600">
                      <Check size={14} />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
