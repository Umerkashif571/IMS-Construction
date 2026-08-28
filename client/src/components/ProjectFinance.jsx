import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Card, CardHeader, CardContent, Button, Modal, Input, Select, EmptyState, Badge, StatCard, LoadingSkeleton } from '../components/ui'
import { Plus, Trash2, Users, Wallet, HandCoins, ClipboardList, ShieldCheck, ShieldX, Info, TrendingUp, ReceiptText } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import toast from 'react-hot-toast'
import { formatPKR } from '../format'
import ErrorBoundary from './ErrorBoundary'
import { useSubmitGuard } from '../hooks/useSubmitGuard'

// Fallback decimal utilities (avoid ESM import issues in production builds)
const safeD = (v) => (v === null || v === undefined || v === '') ? 0 : Number(v)
const safeAdd = (a, b) => Number(a) + Number(b)
const safeSub = (a, b) => Number(a) - Number(b)
const safeMul = (a, b) => Number(a) * Number(b)
const safeDiv = (a, b) => Number(a) / Number(b)
const safeRound2 = (v) => Math.round(Number(v) * 100) / 100
const safeToNumber = (v) => Math.round(Number(v) * 100) / 100
const safeGt = (a, b) => Number(a) > Number(b)
const safeGte = (a, b) => Number(a) >= Number(b)

const safeArray = (data) => Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);

const CAN_MANAGE = ['owner', 'admin', 'finance']
const CAN_APPROVE = ['owner', 'admin']

const TX_LABELS = {
  salary: 'Salary',
  petty_cash: 'Petty Cash',
  vendor_payment: 'Vendor Payment',
  amount_received: 'Amount Received',
}

// Petty cash utilization categories (editable dropdown when recording expenses)
const PC_CATEGORIES = ['Material', 'Labor', 'Transport', 'Misc']

const COLORS = ['#059669', '#f59e0b', '#3b82f6']

const txStatusBadge = (s) => {
  const map = { active: 'success', deletion_requested: 'warning', deleted: 'error' }
  return <Badge variant={map[s] || 'default'}>{s?.replace(/_/g, ' ') || 'Unknown'}</Badge>
}

const decisionBadge = (d) => {
  const map = { pending: 'warning', approved: 'success', rejected: 'error' }
  return <Badge variant={map[d] || 'default'}>{d || 'pending'}</Badge>
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' }) : '-')
const fmtMonth = (d) => (d ? new Date(d).toLocaleDateString('en-PK', { month: 'long', year: 'numeric' }) : '-')
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString() : '-')

export default function ProjectFinance({ projectId, projectName }) {
  const { user } = useAuth()
  const [summary, setSummary] = useState(null)
  const [salaries, setSalaries] = useState([])
  const [pettyCash, setPettyCash] = useState([])
  const [utilizations, setUtilizations] = useState([])
  const [vendorPayments, setVendorPayments] = useState([])
  const [amountReceived, setAmountReceived] = useState([])
  const [deletionRequests, setDeletionRequests] = useState([])
  const [vendors, setVendors] = useState([])
  const [banks, setBanks] = useState([])
  const [loading, setLoading] = useState(true)
  const [addModal, setAddModal] = useState(null)
  const [delModal, setDelModal] = useState({ open: false, type: null, id: null, label: '' })
  const [delReason, setDelReason] = useState('')
  const [utilModal, setUtilModal] = useState({ open: false, pc: null })
  const [utilForm, setUtilForm] = useState({ petty_cash_id: '', category: 'Material', date: new Date().toISOString().slice(0, 10), amount: '', note: '', receipt_ref: '' })
  const [utilDetail, setUtilDetail] = useState(null)
  const [utilFilters, setUtilFilters] = useState({ category: '', from: '', to: '' })

  // Submit guards to prevent double-submission
  const { isSubmitting: isSaving, guard: saveGuard } = useSubmitGuard()
  const { isSubmitting: isSubmittingDeletion, guard: deletionGuard } = useSubmitGuard()
  const { isSubmitting: isApproving, guard: approvalGuard } = useSubmitGuard()
  const { isSubmitting: isUtilizing, guard: utilizationGuard } = useSubmitGuard()

  const canManage = CAN_MANAGE.includes(user?.role)
  const canSeeDeletionRequests = CAN_APPROVE.includes(user?.role)
  const canSeeVendors = user?.role !== 'manager'
  const isOwner = user?.role === 'owner'

  const utilizedOf = (pc) => safeToNumber(safeD(pc?.utilized ?? pc?.utilized_total ?? 0))
  const remainingFor = (pc) => safeToNumber(safeRound2(safeSub(safeD(pc.amount), safeD(utilizedOf(pc)))))

  const openUtilDetail = (pc) => {
    setUtilFilters({ category: '', from: '', to: '' })
    api.get(`/projects/${projectId}/finance/petty-cash/${pc.id}/utilizations`)
      .then(({ data }) => setUtilDetail({ pc, entries: data?.data?.entries || data?.entries || [] }))
      .catch(err => { console.error(err); toast.error('Failed to load utilization details'); })
  }

  const openUtilModal = (pc) => {
    setUtilForm({ petty_cash_id: pc.id, category: 'Material', date: new Date().toISOString().slice(0, 10), amount: '', note: '', receipt_ref: '' })
    setUtilModal({ open: true, pc })
  }

  const submitUtilization = async () => {
    const amt = parseFloat(utilForm.amount)
    if (!amt || amt <= 0) return toast.error('Valid amount required')
    if (!utilForm.date) return toast.error('Date required')
    await utilizationGuard(async () => {
      const { data } = await api.post(`/projects/${projectId}/finance/petty-cash/${utilForm.petty_cash_id}/utilizations`, {
        category: utilForm.category, date: utilForm.date, amount: amt, note: utilForm.note, receipt_ref: utilForm.receipt_ref,
      })
      toast.success(`Expense of ${formatPKR(data.amount)} recorded`)
      setUtilModal({ open: false, pc: null })
      load()
    })
  }

const load = useCallback(() => {
    setLoading(true)
    const base = `/projects/${projectId}/finance`
    const promises = [
      api.get(`${base}/summary`),
      api.get(`${base}/salaries`),
      api.get(`${base}/petty-cash`),
      api.get(`${base}/petty-cash/utilizations`),
      api.get(`${base}/amount-received`),
    ]
    if (canSeeVendors) promises.push(api.get(`${base}/vendor-payments`))
    if (canSeeDeletionRequests) promises.push(api.get(`${base}/deletion-requests`))
    promises.push(api.get('/vendors'))
    promises.push(api.get('/banks'))
    Promise.all(promises).then(results => {
      let i = 0
      setSummary(results[i++]?.data)
      setSalaries(safeArray(results[i++]?.data))
      setPettyCash(safeArray(results[i++]?.data))
      setUtilizations(safeArray(results[i++]?.data))
      setAmountReceived(safeArray(results[i++]?.data))
      if (canSeeVendors) setVendorPayments(safeArray(results[i++]?.data))
      if (canSeeDeletionRequests) setDeletionRequests(safeArray(results[i++]?.data))
      setVendors(safeArray(results[i].data))
      setBanks(safeArray(results[i + 1].data))
    }).catch(err => { console.error(err); toast.error('Failed to load finance data') }).finally(() => setLoading(false))
  }, [projectId, canSeeVendors, canSeeDeletionRequests])

  useEffect(() => { load() }, [load])

  const handleSave = async (type, form) => {
    await saveGuard(async () => {
      const pathMap = { salary: 'salaries', petty_cash: 'petty-cash', vendor_payment: 'vendor-payments', amount_received: 'amount-received' }
      await api.post(`/projects/${projectId}/finance/${pathMap[type]}`, form)
      toast.success(`${TX_LABELS[type]} added`)
      setAddModal(null)
      load()
    })
  }

  const openDeleteModal = (type, id, label) => {
    setDelReason('')
    setDelModal({ open: true, type, id, label })
  }

  const submitDeletion = async () => {
    if (!delReason.trim()) return toast.error('Reason is required')
    await deletionGuard(async () => {
      await api.post(`/projects/${projectId}/finance/deletion-requests`, {
        transaction_type: delModal.type, transaction_id: delModal.id, reason: delReason.trim(),
      })
      toast.success('Deletion request submitted for approval')
      setDelModal({ open: false, type: null, id: null, label: '' })
      load()
    })
  }

  const handleApproval = async (dr, level, approve) => {
    await approvalGuard(async () => {
      await api.patch(`/projects/${projectId}/finance/deletion-requests/${dr.id}/${level}-approve`, { approve })
      toast.success(approve ? 'Approval recorded' : 'Request rejected')
      load()
    })
  }

  const chartData = summary ? [
    { name: 'Salaries', value: Math.round(parseFloat(summary.salaries_total) || 0) },
    { name: 'Petty Cash (Onsite)', value: Math.round(parseFloat(summary.petty_cash_received_onsite || summary.petty_cash_total) || 0) },
    { name: 'Material Cost', value: Math.round(parseFloat(summary.material_cost_total) || 0) },
    ...(canSeeVendors ? [{ name: 'Vendor Payments', value: Math.round(parseFloat(summary.vendor_payments_total) || 0) }] : []),
  ].filter(d => d.value > 0) : []

  const deleteAction = (type, row) => row.status === 'active'
    ? (
      <button
        onClick={() => openDeleteModal(type, row.id, `${TX_LABELS[type]}: ${row.employee_name || row.description || row.vendor_name || ''}`)}
        className="p-1.5 hover:bg-red-50 rounded text-red-600 transition-colors"
        title="Request Deletion"
      >
        <Trash2 size={15} />
      </button>
    )
    : null

  return (
    <div className="space-y-6">
      {loading ? <LoadingSkeleton rows={6} cols={4} /> : (
        <>
          {user?.role === 'manager' && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
              <Info size={15} className="flex-shrink-0 mt-0.5" />
              <span>Vendor payment details are restricted for your role. You can view salaries and petty cash, and request deletion of those transactions only.</span>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {user?.role === 'manager' ? (
              <>
                <StatCard label="Project Cost Value" value={formatPKR(summary?.project_cost_value)} icon={Wallet} color="emerald" />
                <StatCard label="Actual Cost" value={formatPKR(summary?.actual_cost)} icon={HandCoins} color="blue" />
                <StatCard label="Cash Balance" value={formatPKR(summary?.balance_received)} icon={Wallet} color={(summary?.balance_received || 0) < 0 ? 'red' : 'green'} hint="Amount received minus actual cost" />
                <StatCard label="Profit / Loss" value={formatPKR(summary?.profit_loss)} icon={TrendingUp} color={(summary?.profit_loss || 0) < 0 ? 'red' : 'green'} hint="Project cost value minus actual cost" />
              </>
            ) : (
              <>
                <StatCard label="Project Cost Value" value={formatPKR(summary?.project_cost_value)} icon={Wallet} color="emerald" />
                <StatCard label="Amount Received" value={formatPKR(summary?.amount_received_total)} icon={HandCoins} color="teal" />
                <StatCard label="Actual Cost" value={formatPKR(summary?.actual_cost)} icon={HandCoins} color="blue" />
                <StatCard label="Material Cost" value={formatPKR(summary?.material_cost_total)} icon={Wallet} color="orange" />
                <StatCard label="Cash Balance" value={formatPKR(summary?.balance_received)} icon={Wallet} color={(summary?.balance_received || 0) < 0 ? 'red' : 'green'} hint="Amount received minus actual cost" />
                <StatCard label="Profit / Loss" value={formatPKR(summary?.profit_loss)} icon={TrendingUp} color={(summary?.profit_loss || 0) < 0 ? 'red' : 'green'} hint="Project cost value minus actual cost" />
                <StatCard label="% Utilized" value={`${summary?.percent_utilized?.toFixed(1) || '0.0'}%`} icon={ClipboardList} color="purple" />
              </>
            )}
          </div>

          {/* Cost breakdown */}
          <Card>
            <CardHeader title="Cost Breakdown" action={<span className="text-xs text-slate-400">Proportion of actual cost</span>} />
            <CardContent>
              {chartData.length === 0 ? (
                <EmptyState icon={HandCoins} title="No costs recorded" text="Add salaries, petty cash or vendor payments to see the breakdown" />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={chartData} cx="50%" cy="45%" innerRadius={55} outerRadius={90} paddingAngle={2} dataKey="value">
                        {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                        formatter={(v) => [formatPKR(v), 'Amount']}
                      />
                      <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" formatter={(value) => <span className="text-xs text-slate-600">{value}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Salaries */}
          <Card>
            <CardHeader title="Salaries" action={canManage ? <Button size="sm" onClick={() => setAddModal('salary')}><Plus size={14} /> Add Salary</Button> : null} />
            <CardContent className="p-0">
              {salaries.length === 0 ? (
                <EmptyState icon={Users} title="No salaries recorded" text="Salary records for this project will appear here" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200"><tr>
                      {['Employee', 'Amount', 'Month', 'Status', 'Added By', 'Actions'].map(h => (
                        <th key={h} className={`text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {safeArray(salaries).map(s => (
                        <tr key={s.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-medium">{s.employee_name}</td>
                          <td className="px-4 py-2.5 text-right font-semibold">{formatPKR(s.amount)}</td>
                          <td className="px-4 py-2.5 text-slate-500">{fmtMonth(s.month)}</td>
                          <td className="px-4 py-2.5">{txStatusBadge(s.status)}</td>
                          <td className="px-4 py-2.5 text-slate-500">{s.created_by_name || '-'}</td>
                          <td className="px-4 py-2.5">{deleteAction('salary', s)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Petty Cash */}
          <Card>
            <CardHeader title="Petty Cash" action={canManage ? <Button size="sm" onClick={() => setAddModal('petty_cash')}><Plus size={14} /> Add Entry</Button> : null} />
            <CardContent className="p-0">
              {pettyCash.length === 0 ? (
                <EmptyState icon={Wallet} title="No petty cash entries" text="Petty cash expenses for this project will appear here" />
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 px-4 py-3 border-b border-slate-100">
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Disbursed</div>
                      <div className="text-sm font-bold">{formatPKR(summary?.petty_cash_total)}</div>
                    </div>
                    <div className="rounded-lg bg-emerald-50 px-3 py-2">
                      <div className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Utilized</div>
                      <div className="text-sm font-bold text-emerald-700">{formatPKR(summary?.petty_cash_utilized_total)}</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 px-3 py-2">
                      <div className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">Remaining</div>
                      <div className="text-sm font-bold text-amber-700">{formatPKR(summary?.petty_cash_remaining)}</div>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200"><tr>
                        {['Description', 'Disbursed', 'Utilized', 'Remaining', 'Week Of', 'Status', 'Added By', 'Actions'].map(h => (
                          <th key={h} className={`text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider ${['Disbursed', 'Utilized', 'Remaining'].includes(h) ? 'text-right' : ''}`}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {safeArray(pettyCash).map(p => (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5 font-medium">{p.description}</td>
                            <td className="px-4 py-2.5 text-right font-semibold">{formatPKR(p.amount)}</td>
                            <td className="px-4 py-2.5 text-right text-emerald-700">{formatPKR(p.utilized)}</td>
                            <td className="px-4 py-2.5 text-right text-amber-700">{formatPKR(remainingFor(p))}</td>
                            <td className="px-4 py-2.5 text-slate-500">{fmtDate(p.week_of)}</td>
                            <td className="px-4 py-2.5">{txStatusBadge(p.status)}</td>
                            <td className="px-4 py-2.5 text-slate-500">{p.created_by_name || '-'}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex gap-1">
                                <button onClick={() => openUtilDetail(p)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="Expense breakdown"><ReceiptText size={15} /></button>
                                {canManage && remainingFor(p) > 0 && (
                                  <button onClick={() => openUtilModal(p)} className="p-1.5 hover:bg-purple-50 rounded text-purple-600" title="Record Expense"><Plus size={15} /></button>
                                )}
                                {deleteAction('petty_cash', p)}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Vendor Payments (hidden for PM) */}
          {canSeeVendors && (
            <Card>
              <CardHeader title="Vendor Payments" action={canManage ? <Button size="sm" onClick={() => setAddModal('vendor_payment')}><Plus size={14} /> Add Payment</Button> : null} />
              <CardContent className="p-0">
                {vendorPayments.length === 0 ? (
                  <EmptyState icon={HandCoins} title="No vendor payments" text="Payments made to vendors for this project will appear here" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200"><tr>
                        {['Vendor', 'Type', 'Amount', 'PO No', 'Bill No', 'IPC %', 'Date', 'Status', 'Actions'].map(h => (
                          <th key={h} className={`text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {safeArray(vendorPayments).map(vp => (
                          <tr key={vp.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5 font-medium">{vp.vendor_name || '-'}</td>
                            <td className="px-4 py-2.5 text-slate-500">{vp.payment_type?.replace(/_/g, ' ')}</td>
                            <td className="px-4 py-2.5 text-right font-semibold">{formatPKR(vp.amount)}</td>
                            <td className="px-4 py-2.5 text-slate-500">{vp.po_number || '-'}</td>
                            <td className="px-4 py-2.5 text-slate-500">{vp.bill_number || '-'}</td>
                            <td className="px-4 py-2.5 text-slate-500">{vp.payment_type === 'ipc' ? `${vp.ipc_percent_complete}%` : '-'}</td>
                            <td className="px-4 py-2.5 text-slate-500">{fmtDate(vp.payment_date)}</td>
                            <td className="px-4 py-2.5">{txStatusBadge(vp.status)}</td>
                            <td className="px-4 py-2.5">{deleteAction('vendor_payment', vp)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Amount Received */}
          <Card>
            <CardHeader title="Amount Received" action={canManage ? <Button size="sm" onClick={() => setAddModal('amount_received')}><Plus size={14} /> Add Receipt</Button> : null} />
            <CardContent className="p-0">
              {amountReceived.length === 0 ? (
                <EmptyState icon={HandCoins} title="No payments received" text="Payments received from the client for this project will appear here" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200"><tr>
                      {['Date', 'Description', 'Amount', 'Status', 'Added By', 'Actions'].map(h => (
                        <th key={h} className={`text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {safeArray(amountReceived).map(ar => (
                        <tr key={ar.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 text-slate-500">{fmtDate(ar.received_date)}</td>
                          <td className="px-4 py-2.5 font-medium">{ar.description || '-'}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-emerald-600">{formatPKR(ar.amount)}</td>
                          <td className="px-4 py-2.5">{txStatusBadge(ar.status)}</td>
                          <td className="px-4 py-2.5 text-slate-500">{ar.created_by_name || '-'}</td>
                          <td className="px-4 py-2.5">{canManage && deleteAction('amount_received', ar)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Deletion Requests (Owner/Admin only) */}
          {canSeeDeletionRequests && (
            <Card>
              <CardHeader title="Deletion Requests" action={<span className="text-xs text-slate-400">{deletionRequests.length} requests</span>} />
              <CardContent>
                {deletionRequests.length === 0 ? (
                  <EmptyState icon={ShieldCheck} title="No deletion requests" text="Requests to delete finance transactions will appear here with full approval history" />
                ) : (
                  <div className="space-y-3">
                    {deletionRequests.map(dr => (
                      <div key={dr.id} className="border border-slate-200 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="info">{TX_LABELS[dr.transaction_type] || dr.transaction_type}</Badge>
                            <span className="text-sm font-semibold text-slate-700">{formatPKR(dr.snapshot_data?.amount)}</span>
                          </div>
                          {decisionBadge(dr.final_status)}
                        </div>
                        {dr.snapshot_data && (
                          <p className="text-[11px] text-slate-400">
                            {dr.transaction_type === 'salary' ? `Employee: ${dr.snapshot_data.employee_name}` :
                             dr.transaction_type === 'petty_cash' ? `Description: ${dr.snapshot_data.description}` :
                             `Vendor: ${dr.snapshot_data.vendor_name || dr.snapshot_data.vendor_id}`}
                          </p>
                        )}
                        <p className="text-xs text-slate-600">Reason: {dr.reason || 'No reason provided'}</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-slate-500">
                          <div>
                            <span className="block font-semibold text-slate-600 uppercase tracking-wider mb-1">Requested</span>
                            <div>by <span className="font-medium text-slate-700">{dr.requested_by_name || '-'}</span></div>
                            <div>{fmtDateTime(dr.created_at)}</div>
                          </div>
                          <div>
                            <span className="block font-semibold text-slate-600 uppercase tracking-wider mb-1">Admin Approval</span>
                            <div className="mb-1">{decisionBadge(dr.admin_approval)}</div>
                            <div>{dr.admin_approved_by_name ? `by ${dr.admin_approved_by_name}` : 'Pending decision'}</div>
                            <div>{dr.admin_approved_at ? fmtDateTime(dr.admin_approved_at) : ''}</div>
                          </div>
                          <div>
                            <span className="block font-semibold text-slate-600 uppercase tracking-wider mb-1">Owner Approval</span>
                            <div className="mb-1">{decisionBadge(dr.owner_approval)}</div>
                            <div>{dr.owner_approved_by_name ? `by ${dr.owner_approved_by_name}` : 'Pending decision'}</div>
                            <div>{dr.owner_approved_at ? fmtDateTime(dr.owner_approved_at) : ''}</div>
                          </div>
                        </div>
                        {dr.final_status === 'pending' && (
                          <div className="flex gap-2 pt-1">
                            {dr.admin_approval === 'pending' && (
                              <>
                                <Button size="sm" onClick={() => handleApproval(dr, 'admin', true)} disabled={isApproving}><ShieldCheck size={13} /> Approve</Button>
                                <Button size="sm" variant="destructive" onClick={() => handleApproval(dr, 'admin', false)} disabled={isApproving}><ShieldX size={13} /> Reject</Button>
                              </>
                            )}
                            {dr.owner_approval === 'pending' && isOwner && (
                              <>
                                <Button size="sm" onClick={() => handleApproval(dr, 'owner', true)} disabled={isApproving}><ShieldCheck size={13} /> Final Approve</Button>
                                <Button size="sm" variant="destructive" onClick={() => handleApproval(dr, 'owner', false)} disabled={isApproving}><ShieldX size={13} /> Final Reject</Button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Add modals */}
      <Modal isOpen={addModal === 'salary'} onClose={() => setAddModal(null)} title="Add Salary" size="max-w-md">
        <SalaryForm banks={banks} onSave={(f) => handleSave('salary', f)} onCancel={() => setAddModal(null)} />
      </Modal>
      <Modal isOpen={addModal === 'petty_cash'} onClose={() => setAddModal(null)} title="Add Petty Cash Entry" size="max-w-md">
        <PettyCashForm banks={banks} onSave={(f) => handleSave('petty_cash', f)} onCancel={() => setAddModal(null)} />
      </Modal>
      <Modal isOpen={addModal === 'vendor_payment'} onClose={() => setAddModal(null)} title="Add Vendor Payment" size="max-w-md">
        <VendorPaymentForm vendors={vendors} banks={banks} vendorPayments={vendorPayments} onSave={(f) => handleSave('vendor_payment', f)} onCancel={() => setAddModal(null)} />
      </Modal>
      <Modal isOpen={addModal === 'amount_received'} onClose={() => setAddModal(null)} title="Add Amount Received" size="max-w-md">
        <AmountReceivedForm banks={banks} onSave={(f) => handleSave('amount_received', f)} onCancel={() => setAddModal(null)} />
      </Modal>

      {/* Record petty cash expense (utilization) */}
      <Modal isOpen={utilModal.open} onClose={() => setUtilModal({ open: false, pc: null })} title="Record Petty Cash Expense" size="max-w-md">
        <div className="space-y-4">
          {utilModal.pc && (
            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
              Expense against <b>{utilModal.pc.description}</b> · Remaining: <b>{formatPKR(remainingFor(utilModal.pc))}</b>
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Select label="Category *" value={utilForm.category} onChange={e => setUtilForm({ ...utilForm, category: e.target.value })}>
              {PC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Input label="Date *" type="date" value={utilForm.date} onChange={e => setUtilForm({ ...utilForm, date: e.target.value })} />
          </div>
          <Input label="Amount (PKR) *" type="number" min="0" step="0.01" value={utilForm.amount} onChange={e => setUtilForm({ ...utilForm, amount: e.target.value })} />
          <Input label="Note" value={utilForm.note} onChange={e => setUtilForm({ ...utilForm, note: e.target.value })} placeholder="What was this expense for?" />
          <Input label="Receipt Reference" value={utilForm.receipt_ref} onChange={e => setUtilForm({ ...utilForm, receipt_ref: e.target.value })} placeholder="Optional bill / voucher no." />
          <div className="flex gap-3">
            <Button onClick={submitUtilization} disabled={isUtilizing}>Record Expense</Button>
            <Button variant="secondary" onClick={() => setUtilModal({ open: false, pc: null })}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Petty cash utilization breakdown */}
      <Modal isOpen={!!utilDetail} onClose={() => setUtilDetail(null)} title={`Petty Cash Expenses: ${utilDetail?.pc?.description || ''}`} size="max-w-3xl">
        {utilDetail && (
          <ErrorBoundary>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Disbursed</div>
                <div className="text-sm font-bold">{formatPKR(utilDetail.pc.amount)}</div>
              </div>
              <div className="rounded-lg bg-emerald-50 px-3 py-2">
                <div className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Utilized</div>
                <div className="text-sm font-bold text-emerald-700">{formatPKR(utilizedOf(utilDetail.pc))}</div>
              </div>
              <div className="rounded-lg bg-amber-50 px-3 py-2">
                <div className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">Remaining</div>
                <div className="text-sm font-bold text-amber-700">{formatPKR(remainingFor(utilDetail.pc))}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="w-36"><Select value={utilFilters.category} onChange={e => setUtilFilters({ ...utilFilters, category: e.target.value })}>
                <option value="">All Categories</option>
                {PC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </Select></div>
              <div className="w-44"><Input type="date" value={utilFilters.from} onChange={e => setUtilFilters({ ...utilFilters, from: e.target.value })} placeholder="From" /></div>
              <div className="w-44"><Input type="date" value={utilFilters.to} onChange={e => setUtilFilters({ ...utilFilters, to: e.target.value })} placeholder="To" /></div>
              <div className="flex items-center"><Button size="sm" variant="secondary" onClick={() => setUtilFilters({ category: '', from: '', to: '' })}>Clear</Button></div>
            </div>
            <UtilizationTable
              entries={utilDetail.entries}
              filters={utilFilters}
              canRequestDelete={canManage}
              onDelete={(u) => openDeleteModal('petty_cash_utilization', u.id, `${u.category}: ${u.note || utilDetail.pc.description}`)}
            />
          </div>
          </ErrorBoundary>
        )}
      </Modal>

      {/* Deletion reason modal */}
      <Modal isOpen={delModal.open} onClose={() => setDelModal({ open: false, type: null, id: null, label: '' })} title="Request Deletion" size="max-w-md">
        <div className="space-y-4">
          <div className="bg-red-50 rounded-xl px-4 py-3 text-sm text-red-700 flex items-start gap-2">
            <Info size={15} className="flex-shrink-0 mt-0.5" />
            <span>You are requesting deletion of <b>{delModal.label || 'this transaction'}</b> on {projectName}. An admin and the owner must both approve before it is removed.</span>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Reason *</label>
            <textarea
              value={delReason}
              onChange={e => setDelReason(e.target.value)}
              rows={3}
              placeholder="Explain why this transaction should be deleted"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
            />
          </div>
          <div className="flex gap-3">
            <Button onClick={submitDeletion}>Submit Request</Button>
            <Button variant="secondary" onClick={() => setDelModal({ open: false, type: null, id: null, label: '' })}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function SalaryForm({ banks, onSave, onCancel }) {
  const [form, setForm] = useState({
    employee_name: '', amount: '', month: new Date().toISOString().slice(0, 7) + '-01', bank_id: '',
  })
  const [errors, setErrors] = useState({})

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.employee_name.trim()) errs.employee_name = 'Employee name is required'
    if (!form.amount || parseFloat(form.amount) <= 0) errs.amount = 'Valid amount required'
    if (!form.month) errs.month = 'Month required'
    if (!form.bank_id) errs.bank_id = 'Bank is required'
    if (Object.keys(errs).length) return setErrors(errs)
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Employee Name *" value={form.employee_name} onChange={e => setForm({ ...form, employee_name: e.target.value })} error={errors.employee_name} />
      <Input label="Amount (PKR) *" type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} error={errors.amount} />
      <Input label="Month *" type="date" value={form.month} onChange={e => setForm({ ...form, month: e.target.value })} error={errors.month} />
      <Select label="Bank *" value={form.bank_id} onChange={e => setForm({ ...form, bank_id: e.target.value })} error={errors.bank_id}>
        <option value="">Select bank...</option>
        {(banks || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
      <div className="flex gap-3 pt-2">
        <Button type="submit">Add Salary</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

function PettyCashForm({ banks, onSave, onCancel }) {
  const [form, setForm] = useState({
    description: '', amount: '', week_of: new Date().toISOString().slice(0, 10), bank_id: '',
  })
  const [errors, setErrors] = useState({})

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.description.trim()) errs.description = 'Description is required'
    if (!form.amount || parseFloat(form.amount) <= 0) errs.amount = 'Valid amount required'
    if (!form.week_of) errs.week_of = 'Week date required'
    if (!form.bank_id) errs.bank_id = 'Bank is required'
    if (Object.keys(errs).length) return setErrors(errs)
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Description *" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} error={errors.description} />
      <Input label="Amount (PKR) *" type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} error={errors.amount} />
      <Input label="Week Of *" type="date" value={form.week_of} onChange={e => setForm({ ...form, week_of: e.target.value })} error={errors.week_of} />
      <Select label="Bank *" value={form.bank_id} onChange={e => setForm({ ...form, bank_id: e.target.value })} error={errors.bank_id}>
        <option value="">Select bank...</option>
        {(banks || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
      <div className="flex gap-3 pt-2">
        <Button type="submit">Add Entry</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

function VendorPaymentForm({ vendors, banks, vendorPayments, onSave, onCancel }) {
  const [form, setForm] = useState({
    vendor_id: '', payment_type: 'fixed_otp', amount: '',
    po_id: '', bill_number: '', ipc_percent_complete: '', payment_date: new Date().toISOString().slice(0, 10), bank_id: '',
  })
  const [pos, setPos] = useState([])
  const [errors, setErrors] = useState({})

  useEffect(() => {
    api.get('/purchase-orders').then(r => setPos(r.data || [])).catch(err => { console.error(err); toast.error('Failed to load purchase orders') })
  }, [])

  // Spec: only fully approved POs appear in the Continuous payment PO dropdown
  const vendorPos = form.vendor_id ? pos.filter(po => po.vendor_id === form.vendor_id && po.status === 'approved') : []
  const selectedPo = pos.find(po => po.id === form.po_id)
  const isContinuous = form.payment_type === 'continuous'

  // Outstanding balance for the selected PO (PO total minus already paid, for partial payments)
  const poOutstanding = (po) => {
    const total = safeD(po?.total_amount)
    const paid = (vendorPayments || [])
      .filter(vp => vp.po_id === po?.id && vp.status !== 'deleted')
      .reduce((s, vp) => safeAdd(safeD(s), safeD(vp.amount)), safeD(0))
    return safeToNumber(safeRound2(safeSub(total, paid)))
  }

  const handlePoSelect = (e) => {
    const poId = e.target.value
    const po = pos.find(p => p.id === poId)
    const outstanding = poOutstanding(po)
    // Auto-fill amount with the outstanding balance — user can still edit it
    setForm({ ...form, po_id: poId, amount: outstanding > 0 ? String(outstanding) : '' })
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.vendor_id) errs.vendor_id = 'Vendor is required'
    if (!form.amount || parseFloat(form.amount) <= 0) errs.amount = 'Valid amount required'
    if (isContinuous && !form.po_id) errs.po_id = 'PO selection is required for continuous payments'
    if (form.payment_type === 'ipc' && (!form.ipc_percent_complete || parseFloat(form.ipc_percent_complete) < 0 || parseFloat(form.ipc_percent_complete) > 100))
      errs.ipc_percent_complete = 'IPC % complete (0-100) required'
    if (!form.payment_date) errs.payment_date = 'Payment date required'
    if (!form.bank_id) errs.bank_id = 'Bank is required'
    if (Object.keys(errs).length) return setErrors(errs)
    console.log('Submitting vendor payment:', { ...form, po_id: isContinuous ? form.po_id : undefined, bill_number: isContinuous ? form.bill_number : undefined })
    onSave({ ...form, po_id: isContinuous ? form.po_id : undefined, bill_number: isContinuous ? form.bill_number : undefined })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Vendor *" value={form.vendor_id} onChange={e => setForm({ ...form, vendor_id: e.target.value, po_id: '', amount: '' })} error={errors.vendor_id}>
        <option value="">Select vendor...</option>
        {(vendors || []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </Select>
      <Select label="Payment Type *" value={form.payment_type} onChange={e => setForm({ ...form, payment_type: e.target.value })}>
        <option value="fixed_otp">Fixed (OTP)</option>
        <option value="continuous">Continuous</option>
        <option value="ipc">IPC</option>
      </Select>
      <Input label="Amount (PKR) *" type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} error={errors.amount} />
      {isContinuous && (
        <>
          <div>
            <Select label="Purchase Order *" value={form.po_id} onChange={handlePoSelect} error={errors.po_id}>
              <option value="">Select PO...</option>
              {vendorPos.map(po => (
                <option key={po.id} value={po.id}>
                  {po.po_number} {po.project_name ? `(${po.project_name})` : ''}
                </option>
              ))}
            </Select>
            {vendorPos.length === 0 && form.vendor_id && (
              <p className="text-xs text-amber-600 mt-1">No active purchase orders found for this vendor</p>
            )}
          </div>
          {selectedPo && (
            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
              Linked project: {selectedPo.project_name || '-'} · Outstanding: <b>{formatPKR(poOutstanding(selectedPo))}</b> auto-filled into Amount (editable)
            </p>
          )}
          <Input label="Bill Number" value={form.bill_number} onChange={e => setForm({ ...form, bill_number: e.target.value })} />
        </>
      )}
      {form.payment_type === 'ipc' && (
        <Input label="IPC % Complete *" type="number" min="0" max="100" step="0.01" value={form.ipc_percent_complete} onChange={e => setForm({ ...form, ipc_percent_complete: e.target.value })} error={errors.ipc_percent_complete} />
      )}
      <Input label="Payment Date *" type="date" value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })} error={errors.payment_date} />
      <Select label="Bank *" value={form.bank_id} onChange={e => { console.log('Bank select changed:', e.target.value); setForm({ ...form, bank_id: e.target.value }) }} error={errors.bank_id}>
        <option value="">Select bank...</option>
        {(banks || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
      <div className="flex gap-3 pt-2">
        <Button type="submit">Add Payment</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

function AmountReceivedForm({ banks, onSave, onCancel }) {
  const [form, setForm] = useState({
    amount: '', received_date: new Date().toISOString().slice(0, 10), description: '', bank_id: '', received_from: '',
  })
  const [errors, setErrors] = useState({})

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.amount || parseFloat(form.amount) <= 0) errs.amount = 'Valid amount required'
    if (!form.received_date) errs.received_date = 'Received date required'
    if (!form.bank_id) errs.bank_id = 'Bank is required'
    if (!form.received_from.trim()) errs.received_from = 'Received from (client/party) is required'
    if (Object.keys(errs).length) return setErrors(errs)
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Amount Received (PKR) *" type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} error={errors.amount} />
      <Input label="Received Date *" type="date" value={form.received_date} onChange={e => setForm({ ...form, received_date: e.target.value })} error={errors.received_date} />
      <Input label="Received From (client/party) *" value={form.received_from} onChange={e => setForm({ ...form, received_from: e.target.value })} error={errors.received_from} />
      <Input label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
      <Select label="Bank *" value={form.bank_id} onChange={e => setForm({ ...form, bank_id: e.target.value })} error={errors.bank_id}>
        <option value="">Select bank...</option>
        {(banks || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
      <div className="flex gap-3 pt-2">
        <Button type="submit">Add Receipt</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

// Petty cash utilization breakdown with running balances + filters
function UtilizationTable({ entries, filters, canRequestDelete, onDelete }) {
  const rows = Array.isArray(entries) ? entries : []
  const filtered = rows
    .filter(u => !filters.category || u.category === filters.category)
    .filter(u => !filters.from || (u.date >= filters.from))
    .filter(u => !filters.to || (u.date <= filters.to))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

  if (filtered.length === 0) {
    return <EmptyState icon={Wallet} title={rows.length === 0 ? 'No utilization entries yet' : 'No expenses match'} text={rows.length === 0 ? 'Add one to get started' : 'No expenses match the current filters'} />
  }

  let run = safeD(0)
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {['Date', 'Category', 'Note', 'Receipt', 'Amount', 'Utilized (Running)', 'Status', 'Actions'].map(h => (
                <th key={h} className={`text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider ${['Amount', 'Utilized (Running)'].includes(h) ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(u => {
              run = safeRound2(safeAdd(run, safeD(u.amount)))
              return (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-500">{fmtDate(u.date)}</td>
                  <td className="px-4 py-2.5"><Badge variant="info">{u.category}</Badge></td>
                  <td className="px-4 py-2.5 max-w-[180px] truncate" title={u.note || ''}>{u.note || '-'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{u.receipt_ref || '-'}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">{formatPKR(u.amount)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{formatPKR(safeToNumber(run))}</td>
                  <td className="px-4 py-2.5">{txStatusBadge(u.status)}</td>
                  <td className="px-4 py-2.5">
                    {canRequestDelete && u.status === 'active' && (
                      <button onClick={() => onDelete(u)} className="p-1.5 hover:bg-red-50 rounded text-red-600 transition-colors" title="Request Deletion"><Trash2 size={15} /></button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
