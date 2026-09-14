import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api'
import { Modal, LoadingSkeleton, EmptyState, Badge, Button } from '../components/ui'
import { Ticket, Search, Printer, Share2, ArrowLeft, ExternalLink, Wifi, WifiOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { useRealtimeGatePasses, useSupabaseChannel } from '../hooks/useRealtime'
import { supabase } from '../lib/supabase'

const safeArray = (data) => Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
// HTML-escape anything user-supplied before it is written into the print document
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export default function GatePass() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [gatePasses, setGatePasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [detailModal, setDetailModal] = useState({ open: false, gp: null })
  const [search, setSearch] = useState('')
  const [realtimeConnected, setRealtimeConnected] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/gatepass').then(({ data }) => {
      setGatePasses(data?.data || data || [])
      setLoading(false)
    }).catch(err => { console.error(err); setLoading(false); toast.error(err.response?.data?.error || 'Failed to load gate passes') })
  }, [])

  useEffect(() => {
    if (id) {
      api.get(`/gatepass/${id}`).then(({ data }) => {
        setDetailModal({ open: true, gp: data?.data || data })
        setLoading(false)
      }).catch(err => { console.error(err); setLoading(false); toast.error(err.response?.data?.error || 'Gate pass not found') })
    } else {
      load()
    }
  }, [id, load])

  // Memoize config to prevent channel recreation on every render
  const gatePassChannelConfig = useMemo(() => ({
    config: {
      broadcast: { self: true },
      presence: { key: 'gatepass-page' },
    },
  }), [])

  useRealtimeGatePasses(useCallback((payload) => {
    console.log('Realtime gate pass:', payload)
    load()
  }, [load]))

  // Track realtime connection status
  useSupabaseChannel('gatepass-connection-status', gatePassChannelConfig)

  useEffect(() => {
    let channel = null
    try {
      // subscribe() reports the real channel state: SUBSCRIBED | CHANNEL_ERROR | TIMED_OUT | CLOSED
      channel = supabase.channel('connection-monitor-gatepass')
      channel.subscribe((status) => setRealtimeConnected(status === 'SUBSCRIBED'))
    } catch (e) {
      console.error('Failed to create gatepass connection monitor channel:', e)
    }

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel)
        } catch (e) {
          console.error('Failed to remove gatepass connection monitor channel:', e)
        }
      }
    }
  }, [])

  const openDetail = (gp) => {
    if (id) return
    setDetailModal({ open: true, gp })
  }

  const handlePrint = (gp) => {
    const win = window.open('', '_blank')
    if (!win) return toast.error('Pop-up blocked — allow pop-ups to print')
    const dateStr = gp?.created_at ? new Date(gp.created_at).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' }) : ''
    win.document.write(`<!DOCTYPE html><html><head><title>Gate Pass ${esc(gp?.gate_pass_no)}</title>
      <style>
        @page { margin: 20mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .page { max-width: 800px; margin: 0 auto; }
        .letterhead { text-align: center; border-bottom: 3px double #1e293b; padding-bottom: 20px; margin-bottom: 25px; }
        .letterhead h1 { font-size: 22px; font-weight: 800; letter-spacing: 6px; text-transform: uppercase; color: #0f172a; }
        .letterhead .sub { font-size: 10px; color: #64748b; letter-spacing: 3px; text-transform: uppercase; margin-top: 4px; }
        .letterhead .address { font-size: 10px; color: #94a3b8; margin-top: 6px; }
        .title-block { text-align: center; margin-bottom: 25px; }
        .title-block h2 { font-size: 28px; font-weight: 900; letter-spacing: 8px; color: #0f172a; border: 2px solid #0f172a; display: inline-block; padding: 8px 30px; }
        .gp-no { text-align: center; font-size: 14px; font-weight: 700; color: #f59e0b; margin: 10px 0 25px; letter-spacing: 2px; }
        table.details { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        table.details td { padding: 10px 12px; border: 1px solid #cbd5e1; font-size: 13px; }
        table.details td:first-child { font-weight: 700; width: 140px; background: #f8fafc; }
        table.details td:last-child { font-weight: 500; }
        .signatures { display: flex; justify-content: space-between; margin-top: 50px; padding: 0 10px; }
        .signatures .sig { text-align: center; width: 200px; }
        .signatures .sig .line { margin-top: 55px; border-top: 1px solid #1e293b; padding-top: 6px; font-size: 11px; font-weight: 600; color: #475569; }
        .footer-note { text-align: center; font-size: 9px; color: #94a3b8; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
        @media print { body { padding: 0; } .no-print { display: none; } }
      </style></head><body><div class="page">
      <div class="letterhead">
        <h1>AL SHAFI ENTERPRISES</h1>
        <div class="sub">Builders, Contractors &amp; Interior Decorators</div>
        <div class="address">Inventory &amp; Asset Management System</div>
      </div>
      <div class="title-block"><h2>GATE PASS</h2></div>
      <div class="gp-no"># ${esc(gp?.gate_pass_no)}</div>
      <table class="details">
        <tr><td>Date</td><td>${esc(dateStr)}</td></tr>
        <tr><td>Material</td><td>${esc(gp?.material_name)}</td></tr>
        <tr><td>Quantity</td><td>${esc(gp?.quantity)} ${esc(gp?.unit)}</td></tr>
        <tr><td>Project</td><td>${esc(gp?.project_name)}</td></tr>
        <tr><td>Vehicle Number</td><td>${esc(gp?.vehicle_number)}</td></tr>
        <tr><td>Driver Name</td><td>${esc(gp?.driver_name)}</td></tr>
        <tr><td>Destination</td><td>${esc(gp?.destination)}</td></tr>
        <tr><td>Issued By</td><td>${esc(gp?.issued_by)}</td></tr>
        <tr><td>Authorized By</td><td>${esc(gp?.authorized_by)}</td></tr>
        <tr><td>Notes</td><td>${esc(gp?.notes)}</td></tr>
      </table>
      <div class="signatures">
        <div class="sig"><div class="line">Issued By Signature</div></div>
        <div class="sig"><div class="line">Authorized Signature</div></div>
        <div class="sig"><div class="line">Security Officer</div></div>
      </div>
      <div class="footer-note">This is a computer-generated document. No signature required for verification.</div>
    </div></body></html>`)
    win.document.close()
    win.print()
  }

  const handleSharePdf = async (gp) => {
    try {
      const { data: blob } = await api.get(`/gatepass/${gp.id}/pdf`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `GatePass_${String(gp.gate_pass_no || gp.id).replace(/[^\w.-]+/g, '_')}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => window.URL.revokeObjectURL(url), 1000)
      toast.success('PDF exported')
    } catch (err) {
      console.error(err)
      const status = err.response?.status
      if (status === 401 || status === 403) return toast.error('You are not allowed to export this gate pass')
      toast.error('PDF export not available, opening print view instead')
      handlePrint(gp)
    }
  }

  const filtered = gatePasses.filter(gp =>
    !search || gp.gate_pass_no?.toLowerCase().includes(search.toLowerCase()) ||
    gp.material_name?.toLowerCase().includes(search.toLowerCase()) ||
    gp.destination?.toLowerCase().includes(search.toLowerCase()) ||
    gp.project_name?.toLowerCase().includes(search.toLowerCase())
  )

  const handleCloseDetail = () => {
    setDetailModal({ open: false, gp: null })
    if (id) navigate('/gatepass')
  }

  if (id && !loading && !detailModal.gp) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900">Gate Pass Not Found</h1>
          </div>
          <Button variant="secondary" onClick={() => navigate('/gatepass')}>
            <ArrowLeft size={16} /> Back to Gate Passes
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900">Gate Passes</h1>
          <p className="text-sm text-slate-500 mt-1">Auto-generated on stock-out transactions</p>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-lg">
          <span className={`w-2 h-2 rounded-full ${realtimeConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <span className="text-xs font-medium text-slate-600">
            {realtimeConnected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>

      <div className="relative w-full sm:max-w-xs">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          placeholder="Search gate passes..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
        />
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} cols={8} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Ticket} title="No gate passes found"
          text={search ? 'Try a different search term' : 'Gate passes are auto-generated on stock-out.'}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Gate Pass No', 'Date', 'Material', 'Quantity', 'Project', 'Destination', 'Issued By', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {safeArray(filtered).map(gp => (
                  <tr key={gp.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-amber-600">{gp.gate_pass_no}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {gp.created_at ? new Date(gp.created_at).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' }) : '-'}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">{gp.material_name || '-'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={parseFloat(gp.quantity) > 0 ? 'success' : 'default'}>
                        {gp.quantity || '-'} {gp.unit || ''}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{gp.project_name || '-'}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate" title={gp.destination}>{gp.destination || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{gp.issued_by || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openDetail(gp)}
                          className="p-1.5 hover:bg-amber-50 rounded text-amber-600 transition-colors" title="View Details">
                          <ExternalLink size={15} />
                        </button>
                        <button onClick={() => handlePrint(gp)}
                          className="p-1.5 hover:bg-blue-50 rounded text-blue-600 transition-colors" title="Print">
                          <Printer size={15} />
                        </button>
                        <button onClick={() => handleSharePdf(gp)}
                          className="p-1.5 hover:bg-emerald-50 rounded text-emerald-600 transition-colors" title="Export PDF">
                          <Share2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={detailModal.open} onClose={handleCloseDetail} title={`Gate Pass: ${detailModal.gp?.gate_pass_no || ''}`} size="max-w-2xl">
        {detailModal.gp && <GatePassDetail gp={detailModal.gp} onPrint={() => handlePrint(detailModal.gp)} onPdf={() => handleSharePdf(detailModal.gp)} />}
      </Modal>
    </div>
  )
}

function GatePassDetail({ gp, onPrint, onPdf, embedded }) {
  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onPrint}><Printer size={14} /> Print</Button>
          <Button variant="secondary" size="sm" onClick={onPdf}><Share2 size={14} /> Export PDF</Button>
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="text-center border-b-2 border-slate-800 pb-4 mb-6">
          <h2 className="text-xl font-bold text-slate-800">GATE PASS</h2>
          <p className="text-sm text-amber-600 font-mono font-semibold mt-1">{gp?.gate_pass_no}</p>
        </div>
        <div className="space-y-3">
          {[
            ['Date', gp?.created_at ? new Date(gp.created_at).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' }) : '-'],
            ['Material', gp?.material_name || '-'],
            ['Quantity', `${gp?.quantity || '-'} ${gp?.unit || ''}`],
            ['Project', gp?.project_name || '-'],
            ['Vehicle Number', gp?.vehicle_number || '-'],
            ['Driver Name', gp?.driver_name || '-'],
            ['Destination', gp?.destination || '-'],
            ['Issued By', gp?.issued_by || '-'],
            ['Authorized By', gp?.authorized_by || '-'],
            ['Notes', gp?.notes || '-'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-4 text-sm">
              <span className="font-semibold text-slate-500 w-32 shrink-0">{label}</span>
              <span className="text-slate-800">{value}</span>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap justify-between gap-4 pt-6 border-t border-slate-100">
          <div className="text-center">
            <div className="border-t border-slate-400 pt-1 mt-10 w-36 text-[10px] text-slate-500">Issued By Signature</div>
          </div>
          <div className="text-center">
            <div className="border-t border-slate-400 pt-1 mt-10 w-36 text-[10px] text-slate-500">Authorized Signature</div>
          </div>
          <div className="text-center">
            <div className="border-t border-slate-400 pt-1 mt-10 w-36 text-[10px] text-slate-500">Security Officer</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export { GatePassDetail }