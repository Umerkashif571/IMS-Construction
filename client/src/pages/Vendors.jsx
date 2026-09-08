import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Modal, ConfirmDialog, Button, Input, Select, LoadingSkeleton, EmptyState, Badge, useDebouncedValue } from '../components/ui'
import { Plus, Search, FileText, PlusCircle, Edit3, Trash2, X, Building2, Printer, ChevronRight, CheckCircle, XCircle, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatPKR } from '../format'

const statusBadge = (s) => {
  const map = {
    active: 'success', inactive: 'default',
    pending: 'warning', admin_approved: 'indigo', approved: 'info', partial_received: 'purple',
    received: 'success', cancelled: 'error', rejected: 'error', completed: 'success'
  }
  return <Badge variant={map[s] || 'default'}>{s?.replace(/_/g, ' ') || s}</Badge>
}

const decisionBadge = (d) => {
  const map = { pending: 'warning', approved: 'success', rejected: 'error' }
  return <Badge variant={map[d] || 'default'}>{d || 'pending'}</Badge>
}

export default function Vendors() {
  const { user } = useAuth()
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [modal, setModal] = useState({ open: false, item: null })
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null })
  const [poModal, setPoModal] = useState({ open: false, vendor: null })
  const [overviewTab, setOverviewTab] = useState('pos')
  const [overview, setOverview] = useState(null)
  const [payTypeFilter, setPayTypeFilter] = useState('')
  const [pos, setPos] = useState([])
  const [posLoading, setPosLoading] = useState(false)
  const [poSearch, setPoSearch] = useState('')
  const [poStatusFilter, setPoStatusFilter] = useState('')
  const [createPoModal, setCreatePoModal] = useState({ open: false, vendor: null })
  const [poForm, setPoForm] = useState({ 
    items: [{ material_name: '', quantity: '', unit: '', unit_price: '' }], 
    notes: '', 
    project_id: '',
    special_discount: '',
    account_charged: '',
    product_category: '',
    approved_by_name: '',
    note_to_accounts: '',
    seller_acceptance: '',
    terms: [] // PO-specific terms
  })
  const [creatingPO, setCreatingPO] = useState(false)
  const [poDetailModal, setPoDetailModal] = useState({ open: false, po: null })
  const [rejectModal, setRejectModal] = useState({ open: false, poId: null, level: null })
  const [rejectReason, setRejectReason] = useState('')
  const [allPos, setAllPos] = useState([])
  const [projects, setProjects] = useState([])

  const canEdit = ['owner', 'admin', 'store_manager', 'manager'].includes(user?.role)
  const canSeePayments = ['owner', 'admin', 'finance'].includes(user?.role)
  // Spec: PO creation is exclusively a Procurement role action.
  const canCreatePO = user?.role === 'procurement_officer'
  const isAdmin = user?.role === 'admin'
  const isOwner = user?.role === 'owner'

  const load = (q = '') => {
    setLoading(true)
    const params = q ? `?search=${q}` : ''
    api.get(`/vendors${params}`).then(({ data }) => setVendors(data?.data || data || [])).catch(err => { console.error(err); toast.error('Failed to load vendors') }).finally(() => setLoading(false))
  }

  useEffect(() => { load(debouncedSearch) }, [debouncedSearch])

  // Deep link: /vendors?po=<id> opens the PO detail modal
  const [searchParams] = useSearchParams()
  const poParam = searchParams.get('po')
  useEffect(() => {
    if (!poParam) return
    api.get(`/purchase-orders/${poParam}`).then(({ data }) => {
      setPoDetailModal({ open: true, po: data?.data || data })
    }).catch(err => { console.error(err); toast.error('Failed to load PO from notification') })
  }, [poParam])

  const handleSave = async (form) => {
    try {
      if (form.id) { await api.put(`/vendors/${form.id}`, form); toast.success('Vendor updated') }
      else { await api.post('/vendors', form); toast.success('Vendor created') }
      setModal({ open: false, item: null }); load(search)
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to save') }
  }

  const handleDelete = async () => {
    try { await api.delete(`/vendors/${deleteConfirm.id}`); toast.success('Vendor deleted'); setDeleteConfirm({ open: false, id: null }); load(search) } catch (err) { console.error(err); toast.error('Failed to delete') }
  }

  const viewPOs = async (vendor) => {
    setPoModal({ open: true, vendor })
    setOverviewTab('pos')
    setOverview(null)
    setPayTypeFilter('')
    setPosLoading(true)
    setPos([])
    try {
      const { data } = await api.get('/vendors/pos/list', { params: { vendor_id: vendor.id } })
      setPos(data?.data || data || [])
    } catch (err) { console.error(err); toast.error('Failed to load purchase orders'); setPos([]) }
    finally { setPosLoading(false) }
    if (canSeePayments) {
      try {
        const { data } = await api.get('/finance/vendor-overview', { params: { vendor_id: vendor.id } })
        setOverview(data?.data || data)
      } catch (err) { console.error(err); toast.error('Failed to load vendor overview') }
    }
  }

  const openPoDetail = async (po) => {
    try {
      const { data } = await api.get(`/purchase-orders/${po.id}`)
      setPoDetailModal({ open: true, po: data })
    } catch (err) { console.error(err); toast.error('Failed to load PO details') }
  }

  const handlePoStatus = async (poId, status) => {
    try {
      const { data } = await api.put(`/purchase-orders/${poId}/status`, { status })
      toast.success(`PO ${status}`)
      if (poDetailModal.open) setPoDetailModal({ ...poDetailModal, po: data })
      if (poModal.open) {
        setPos(prev => prev.map(p => p.id === poId ? { ...p, status: data.status, received_by: data.received_by } : p))
      }
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to update PO') }
  }

  const addPoItem = () => setPoForm({ ...poForm, items: [...poForm.items, { material_name: '', quantity: '', unit: '', unit_price: '' }] })
  const removePoItem = (idx) => setPoForm({ ...poForm, items: poForm.items.filter((_, i) => i !== idx) })
  const updatePoItem = (idx, field, value) => {
    const items = [...poForm.items]
    items[idx][field] = value
    setPoForm({ ...poForm, items })
  }

  const openCreatePo = (vendor) => {
    setCreatePoModal({ open: true, vendor })
    // Reset form with vendor default terms
    const resetForm = { 
      items: [{ material_name: '', quantity: '', unit: '', unit_price: '' }], 
      notes: '', 
      project_id: '',
      special_discount: '',
      account_charged: '',
      product_category: '',
      approved_by_name: '',
      note_to_accounts: '',
      seller_acceptance: '',
      terms: []
    }
    setPoForm(resetForm)
    api.get('/projects').then(({ data }) => setProjects(data?.data || data || [])).catch(err => { console.error(err); toast.error('Failed to load sites') })
    // Load vendor default terms
    if (vendor?.id) {
      api.get(`/vendors/${vendor.id}/terms`).then(({ data }) => {
        const vendorTerms = (data || []).map((t, idx) => ({ id: `vendor-${t.id}`, term_text: t.term_text, display_order: t.display_order }))
        setPoForm(prev => ({ ...prev, terms: vendorTerms }))
      }).catch(err => console.error('Failed to load vendor terms:', err))
    }
  }

  const handleCreatePO = async () => {
    if (poForm.items.length === 0 || !poForm.items[0].material_name) return toast.error('At least one item required')
    if (!poForm.project_id) return toast.error('Site (project) selection is required')
    setCreatingPO(true)
    try {
      const { data } = await api.post(`/vendors/${createPoModal.vendor.id}/purchase-orders`, {
        items: poForm.items.map(it => ({ ...it, quantity: parseFloat(it.quantity) || 0, unit_price: parseFloat(it.unit_price) || 0 })),
        notes: poForm.notes,
        project_id: poForm.project_id,
        special_discount: poForm.special_discount,
        account_charged: poForm.account_charged,
        product_category: poForm.product_category,
        approved_by_name: poForm.approved_by_name,
        note_to_accounts: poForm.note_to_accounts,
        seller_acceptance: poForm.seller_acceptance,
        terms: poForm.terms.map(t => ({ term_text: t.term_text, display_order: t.display_order }))
      })
      toast.success(`Purchase order ${data.po_number} created successfully`)
      setCreatePoModal({ open: false, vendor: null })
      setPoForm({ items: [{ material_name: '', quantity: '', unit: '', unit_price: '' }], notes: '', project_id: '', special_discount: '', account_charged: '', product_category: '', approved_by_name: '', note_to_accounts: '', seller_acceptance: '', terms: [] })
      setPoDetailModal({ open: true, po: data })
      if (poModal.open) setPoModal({ open: false, vendor: null })
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to create PO') }
    finally { setCreatingPO(false) }
  }

  // Sequential approval: Admin decides first, Owner decides last.
  const handlePoDecision = async (poId, level, approve) => {
    if (!approve) {
      setRejectReason('')
      setRejectModal({ open: true, poId, level })
      return
    }
    try {
      const { data } = await api.put(`/purchase-orders/${poId}/${level}-approve`, { approve: true })
      toast.success(level === 'admin' ? 'PO approved by Admin — awaiting Owner' : 'PO fully approved')
      if (poDetailModal.open) setPoDetailModal({ ...poDetailModal, po: data })
      if (poModal.open) {
        setPos(prev => prev.map(p => p.id === poId ? { ...p, ...data } : p))
      }
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to update PO') }
  }

  const submitPoRejection = async () => {
    if (!rejectReason.trim()) return toast.error('A rejection reason is required')
    try {
      const { data } = await api.put(`/purchase-orders/${rejectModal.poId}/${rejectModal.level}-approve`, { approve: false, reason: rejectReason.trim() })
      toast.success('PO rejected — reason recorded for the creator')
      setRejectModal({ open: false, poId: null, level: null })
      setRejectReason('')
      if (poDetailModal.open) setPoDetailModal({ ...poDetailModal, po: data })
      if (poModal.open) {
        setPos(prev => prev.map(p => p.id === rejectModal.poId ? { ...p, ...data } : p))
      }
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to reject PO') }
  }

  const printPO = () => {
    const printContents = document.getElementById('po-document')?.innerHTML
    if (!printContents) return
    const win = window.open('', '_blank')
    win.document.write(`<!DOCTYPE html>
<html><head><title>Work Order - ${poDetailModal.po?.po_number || ''}</title>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 20mm 15mm; }
  body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 11px; line-height: 1.4; color: #1a1a2e; padding: 0; margin: 0; }
  .page { padding: 10px; }
  .company-header { text-align: center; border-bottom: 3px double #1a1a2e; padding-bottom: 15px; margin-bottom: 20px; }
  .company-name { font-size: 22px; font-weight: 800; color: #1a1a2e; letter-spacing: 1px; margin: 0; }
  .company-tagline { font-size: 10px; color: #555; margin-top: 4px; letter-spacing: 2px; text-transform: uppercase; }
  .company-address { font-size: 9px; color: #666; margin-top: 6px; line-height: 1.5; }
  .po-title { text-align: center; font-size: 16px; font-weight: 700; color: #1a1a2e; margin: 15px 0 20px; text-transform: uppercase; letter-spacing: 1px; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; padding: 8px 0; }
  .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; font-size: 10px; }
  .info-box { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 4px; padding: 8px 10px; }
  .info-label { font-weight: 600; color: #444; text-transform: uppercase; font-size: 8px; letter-spacing: 0.5px; margin-bottom: 4px; }
  .info-value { font-size: 10px; color: #1a1a2e; }
  .manager-procurement { text-align: right; font-size: 10px; color: #444; margin-bottom: 15px; font-style: italic; }
  table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 10px; }
  th { background: #1a1a2e; color: white; text-align: left; padding: 8px 6px; font-weight: 600; text-transform: uppercase; font-size: 8px; letter-spacing: 0.5px; border: 1px solid #1a1a2e; }
  th.num { text-align: center; width: 40px; }
  th.desc { width: 35%; }
  th.qty, th.unit, th.rate, th.amt { text-align: right; width: 70px; }
  td { padding: 7px 6px; border: 1px solid #ddd; vertical-align: top; }
  td.num { text-align: center; font-weight: 500; }
  td.desc { font-size: 10px; line-height: 1.3; }
  td.qty, td.unit, td.rate, td.amt { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { background: #f5f5f5; font-weight: 700; border-top: 2px solid #1a1a2e; }
  .totals-section { margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
  .totals-box { border: 1px solid #ddd; border-radius: 4px; padding: 12px; background: #fafafa; }
  .totals-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #eee; font-size: 10px; }
  .totals-row:last-child { border-bottom: none; font-weight: 700; font-size: 11px; color: #1a1a2e; }
  .totals-label { color: #555; }
  .totals-value { font-variant-numeric: tabular-nums; }
  .terms-section { margin-top: 20px; }
  .terms-title { font-weight: 700; font-size: 10px; text-transform: uppercase; color: #1a1a2e; margin-bottom: 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .terms-list { font-size: 9.5px; line-height: 1.6; color: #333; }
  .terms-list ol { margin: 0; padding-left: 18px; }
  .terms-list li { margin-bottom: 4px; }
  .footer-fields { margin-top: 25px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; font-size: 9.5px; }
  .footer-box { border: 1px solid #ddd; border-radius: 4px; padding: 10px; background: #fafafa; }
  .footer-label { font-weight: 600; color: #444; text-transform: uppercase; font-size: 8px; letter-spacing: 0.5px; margin-bottom: 6px; }
  .footer-value { min-height: 20px; color: #333; white-space: pre-wrap; }
  .signatures { margin-top: 30px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; font-size: 9px; text-align: center; }
  .sig-box { border-top: 1px solid #999; padding-top: 8px; }
  .sig-label { font-weight: 600; color: #444; text-transform: uppercase; font-size: 7px; letter-spacing: 0.5px; margin-bottom: 4px; }
  .official-footer { margin-top: 30px; text-align: center; border-top: 2px solid #1a1a2e; padding-top: 15px; font-size: 8px; color: #555; line-height: 1.5; }
  .no-print { display: none; }
  @media print { .no-print { display: none !important; } }
</style></head><body><div class="page">${printContents}</div></body></html>`)
    win.document.close()
    setTimeout(() => { win.print() }, 500)
  }

  const filteredPos = pos.filter(p => {
    if (poStatusFilter && p.status !== poStatusFilter) return false
    if (poSearch && !p.po_number?.toLowerCase().includes(poSearch.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Vendors</h1>
          <p className="text-xs text-slate-500 mt-0.5">Manage vendors and purchase orders</p>
        </div>
        {canEdit && (
          <Button onClick={() => setModal({ open: true, item: {} })}><Plus size={16} /> Add Vendor</Button>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="max-w-xs">
          <Input placeholder="Search vendors..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      {loading ? (
        <LoadingSkeleton rows={5} cols={7} />
      ) : vendors.length === 0 ? (
        <EmptyState icon={Building2} title="No vendors found" text="No vendors match your search criteria" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Contact Person</th>
                  <th className="text-left px-4 py-3 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 font-medium">City</th>
                  <th className="text-left px-4 py-3 font-medium">NTN/STRN</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {vendors.map(v => (
                  <tr key={v.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{v.name}</td>
                    <td className="px-4 py-3 text-gray-500">{v.contact_person || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{v.phone || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{v.city || '-'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{v.ntn_strn || '-'}</td>
                    <td className="px-4 py-3">{statusBadge(v.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => viewPOs(v)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="Purchase Orders"><FileText size={16} /></button>
                        {/* Spec: PO creation is exclusively a Procurement role action. */}
                        {canCreatePO && (
                          <button onClick={() => openCreatePo(v)} className="p-1.5 hover:bg-purple-50 rounded text-purple-600" title="Create PO"><PlusCircle size={16} /></button>
                        )}
                        {canEdit && (
                          <>
                            <button onClick={() => setModal({ open: true, item: v })} className="p-1.5 hover:bg-green-50 rounded text-green-600" title="Edit"><Edit3 size={16} /></button>
                            <button onClick={() => setDeleteConfirm({ open: true, id: v.id })} className="p-1.5 hover:bg-red-50 rounded text-red-600" title="Delete"><Trash2 size={16} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={modal.open} onClose={() => setModal({ open: false, item: null })} title={modal.item?.id ? 'Edit Vendor' : 'Add Vendor'} size="max-w-lg">
        <VendorForm data={modal.item} onSave={handleSave} onCancel={() => setModal({ open: false, item: null })} />
      </Modal>

      <ConfirmDialog isOpen={deleteConfirm.open} onClose={() => setDeleteConfirm({ open: false, id: null })} onConfirm={handleDelete} message="Delete this vendor?" />

      {/* Purchase Orders / Overview Modal */}
      <Modal isOpen={poModal.open} onClose={() => { setPoModal({ open: false, vendor: null }); setPos([]); setPoSearch(''); setPoStatusFilter(''); setOverviewTab('pos'); setOverview(null); setPayTypeFilter('') }} title={overviewTab === 'payments' ? `Payments: ${poModal.vendor?.name}` : `Purchase Orders: ${poModal.vendor?.name}`} size="max-w-3xl">
        <div className="space-y-4">
          {canSeePayments && (
            <div className="flex gap-1 border-b border-gray-200">
              {['pos', 'payments'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setOverviewTab(tab)}
                  className={`px-3 py-2 text-xs font-semibold transition-colors ${overviewTab === tab ? 'text-slate-800 border-b-2 border-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {tab === 'pos' ? 'Purchase Orders' : 'Payments & Totals'}
                </button>
              ))}
            </div>
          )}
          {overviewTab === 'payments' ? (
            <OverviewPayments overview={overview} payTypeFilter={payTypeFilter} setPayTypeFilter={setPayTypeFilter} formatPKR={formatPKR} statusBadge={statusBadge} />
          ) : (
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-1"><Input placeholder="Search POs..." value={poSearch} onChange={e => setPoSearch(e.target.value)} /></div>
                <div className="w-48"><Select value={poStatusFilter} onChange={e => setPoStatusFilter(e.target.value)}><option value="">All Status</option><option value="pending">Pending</option><option value="admin_approved">Admin Approved</option><option value="approved">Approved</option><option value="partial_received">Partial Received</option><option value="received">Received</option><option value="cancelled">Cancelled</option></Select></div>
              </div>
              {posLoading ? (
                <LoadingSkeleton rows={5} cols={4} />
              ) : filteredPos.length === 0 ? (
                <EmptyState icon={FileText} title="No purchase orders" text="No POs found for this vendor" />
              ) : (
                <div className="space-y-2">
                  {filteredPos.map(po => (
                    <div key={po.id} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => openPoDetail(po)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items_center gap-3">
                          <span className="text-sm font-medium">#{po.po_number}</span>
                          <span className="text-xs text-gray-400">{po.created_at ? new Date(po.created_at).toLocaleDateString() : '-'}</span>
                          {statusBadge(po.status)}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{formatPKR(po.total_amount)}</span>
                          <ChevronRight size={16} className="text-gray-400" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Create PO Modal */}
      <Modal isOpen={createPoModal.open} onClose={() => { setCreatePoModal({ open: false, vendor: null }); setPoForm({ items: [{ material_name: '', quantity: '', unit: '', unit_price: '' }], notes: '', project_id: '', special_discount: '', account_charged: '', product_category: '', approved_by_name: '', note_to_accounts: '', seller_acceptance: '', terms: [] }) }} title={`Create PO: ${createPoModal.vendor?.name}`} size="max-w-3xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select label="Site (Project) *" value={poForm.project_id} onChange={e => setPoForm({ ...poForm, project_id: e.target.value })}>
              <option value="">Select site...</option>
              {(projects || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Input type="number" step="0.01" label="Special Discount (RS)" value={poForm.special_discount} onChange={e => setPoForm({ ...poForm, special_discount: e.target.value })} placeholder="0" />
          </div>
          <Input label="Account to be Charged" value={poForm.account_charged} onChange={e => setPoForm({ ...poForm, account_charged: e.target.value })} placeholder="e.g. Project Cost - Materials" />
          <Input label="Product Category" value={poForm.product_category} onChange={e => setPoForm({ ...poForm, product_category: e.target.value })} placeholder="e.g. Construction Materials" />
          <Input label="Approved By" value={poForm.approved_by_name} onChange={e => setPoForm({ ...poForm, approved_by_name: e.target.value })} placeholder="Name of approving authority" />
          
          {/* Items */}
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Items</h4>
            {poForm.items.map((item, idx) => (
              <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-600">Item #{idx + 1}</span>
                  {poForm.items.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removePoItem(idx)} className="text-red-600"><X size={14} /> Remove</Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2"><Input value={item.material_name} onChange={e => updatePoItem(idx, 'material_name', e.target.value)} placeholder="Material name *" /></div>
                  <Input type="number" step="0.01" value={item.quantity} onChange={e => updatePoItem(idx, 'quantity', e.target.value)} placeholder="Quantity" />
                  <Input value={item.unit} onChange={e => updatePoItem(idx, 'unit', e.target.value)} placeholder="Unit" />
                  <div className="col-span-2"><Input type="number" step="0.01" value={item.unit_price} onChange={e => updatePoItem(idx, 'unit_price', e.target.value)} placeholder="Unit price" /></div>
                </div>
              </div>
            ))}
            <Button variant="secondary" onClick={addPoItem}><Plus size={16} /> Add Item</Button>
          </div>

          {/* Terms & Conditions */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-700">Terms & Conditions</h4>
              {poForm.terms.some(t => t.id?.startsWith('vendor-')) && (
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">Loaded from vendor defaults — editable for this PO</span>
              )}
            </div>
            {poForm.terms.map((term, idx) => (
              <div key={term.id || idx} className="flex items-center gap-2 mb-2">
                <span className="text-xs text-gray-500 w-6">{idx + 1}.</span>
                <Input 
                  value={term.term_text} 
                  onChange={e => {
                    const terms = [...poForm.terms]
                    terms[idx] = { ...terms[idx], term_text: e.target.value }
                    setPoForm({ ...poForm, terms })
                  }} 
                  placeholder="Term text" 
                  className="flex-1"
                />
                <Button variant="ghost" size="sm" onClick={() => {
                  const terms = [...poForm.terms]
                  if (idx > 0) { [terms[idx-1], terms[idx]] = [terms[idx], terms[idx-1]] }
                  setPoForm({ ...poForm, terms })
                }} disabled={idx === 0} title="Move up"><ChevronRight size={14} className="-rotate-90" /></Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  const terms = [...poForm.terms]
                  if (idx < terms.length - 1) { [terms[idx], terms[idx+1]] = [terms[idx+1], terms[idx]] }
                  setPoForm({ ...poForm, terms })
                }} disabled={idx === poForm.terms.length - 1} title="Move down"><ChevronRight size={14} className="rotate-90" /></Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  const terms = poForm.terms.filter((_, i) => i !== idx)
                  setPoForm({ ...poForm, terms })
                }} className="text-red-600" title="Delete"><Trash2 size={14} /></Button>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setPoForm({ ...poForm, terms: [...poForm.terms, { id: `custom-${Date.now()}`, term_text: '', display_order: poForm.terms.length }] })}><Plus size={14} /> Add Term</Button>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200">
            <Input label="Note to Al Shafi Enterprises Accounts Dept" value={poForm.note_to_accounts} onChange={e => setPoForm({ ...poForm, note_to_accounts: e.target.value })} placeholder="Special instructions for accounts" />
            <Input label="Seller's Acceptance" value={poForm.seller_acceptance} onChange={e => setPoForm({ ...poForm, seller_acceptance: e.target.value })} placeholder="Vendor acceptance terms" />
          </div>
          <Button onClick={handleCreatePO} className="w-full" disabled={creatingPO}>
            {creatingPO ? 'Creating...' : 'Create Purchase Order'}
          </Button>
        </div>
      </Modal>

      {/* PO Detail Document Modal */}
      <Modal isOpen={poDetailModal.open} onClose={() => setPoDetailModal({ open: false, po: null })} title={`PO: ${poDetailModal.po?.po_number}`} size="max-w-3xl">
        {poDetailModal.po && (
          <div className="space-y-4">
            <div className="flex gap-2 justify-end flex-wrap">
              {/* Sequential approval: Admin stage first, Owner stage last. */}
              {poDetailModal.po.status === 'pending' && isAdmin && (
                <>
                  <Button size="sm" onClick={() => handlePoDecision(poDetailModal.po.id, 'admin', true)}><CheckCircle size={14} /> Approve</Button>
                  <Button size="sm" variant="destructive" onClick={() => handlePoDecision(poDetailModal.po.id, 'admin', false)}><XCircle size={14} /> Reject</Button>
                </>
              )}
              {poDetailModal.po.status === 'admin_approved' && isOwner && (
                <>
                  <Button size="sm" onClick={() => handlePoDecision(poDetailModal.po.id, 'owner', true)}><CheckCircle size={14} /> Final Approve</Button>
                  <Button size="sm" variant="destructive" onClick={() => handlePoDecision(poDetailModal.po.id, 'owner', false)}><XCircle size={14} /> Reject</Button>
                </>
              )}
              {poDetailModal.po.status === 'approved' && canEdit && (
                <Button size="sm" variant="secondary" onClick={() => handlePoStatus(poDetailModal.po.id, 'received')}><CheckCircle size={14} /> Mark Received</Button>
              )}
              {['pending', 'admin_approved', 'approved'].includes(poDetailModal.po.status) && canEdit && (
                <Button size="sm" variant="destructive" onClick={() => handlePoStatus(poDetailModal.po.id, 'cancelled')}><XCircle size={14} /> Cancel</Button>
              )}
              <Button size="sm" variant="secondary" onClick={printPO}><Printer size={14} /> Print</Button>
            </div>
            {/* Approval chain progress */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">Approval:</span>
              <span className="flex items-center gap-1"><Badge variant={poDetailModal.po.admin_approval === 'approved' ? 'success' : poDetailModal.po.admin_approval === 'rejected' ? 'error' : 'warning'}>Admin: {poDetailModal.po.admin_approval || 'pending'}</Badge></span>
              <ArrowRight size={12} className="text-gray-400" />
              <span className="flex items-center gap-1"><Badge variant={poDetailModal.po.owner_approval === 'approved' ? 'success' : poDetailModal.po.owner_approval === 'rejected' ? 'error' : 'warning'}>Owner: {poDetailModal.po.owner_approval || 'pending'}</Badge></span>
              <span className="flex items-center gap-1">{statusBadge(poDetailModal.po.status)}</span>
            </div>
            {(poDetailModal.po.admin_reject_reason || poDetailModal.po.owner_reject_reason) && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {poDetailModal.po.admin_reject_reason && <p><b>Admin rejection:</b> {poDetailModal.po.admin_reject_reason}</p>}
                {poDetailModal.po.owner_reject_reason && <p><b>Owner rejection:</b> {poDetailModal.po.owner_reject_reason}</p>}
              </div>
            )}
            <div id="po-document">
              <div className="company-header">
                <h2 className="company-name">AL SHAFI ENTERPRISES</h2>
                <p className="company-tagline">Construction & Trading</p>
                <p className="company-address">
                  Head Office: 123 Main Boulevard, Lahore, Pakistan<br/>
                  Tel: +92-42-XXXXXXX | Email: info@alshafienterprises.com<br/>
                  NTN: XXXXXXXX | STRN: XXXXXXXXXXXX
                </p>
              </div>

              <div className="po-title">
                WORK ORDER FOR THE {poDetailModal.po.project_name || poDetailModal.po.project_id ? (poDetailModal.po.project_name || 'PROJECT') : 'PROJECT'}
              </div>

              <div className="info-grid">
                <div className="info-box">
                  <div className="info-label">Messrs</div>
                  <div className="info-value">{poDetailModal.po.vendor_name || '-'}</div>
                </div>
                <div className="info-box">
                  <div className="info-label">Attn</div>
                  <div className="info-value">{poDetailModal.po.vendor_contact || poDetailModal.po.attn || '-'}</div>
                </div>
                <div className="info-box">
                  <div className="info-label">Position</div>
                  <div className="info-value">{poDetailModal.po.position || '-'}</div>
                </div>
                <div className="info-box">
                  <div className="info-label">Email</div>
                  <div className="info-value">{poDetailModal.po.vendor_email || poDetailModal.po.email || '-'}</div>
                </div>
                <div className="info-box">
                  <div className="info-label">Tel No</div>
                  <div className="info-value">{poDetailModal.po.vendor_phone || poDetailModal.po.vendor_tel || poDetailModal.po.phone || '-'}</div>
                </div>
                <div className="info-box">
                  <div className="info-label">P.O. No</div>
                  <div className="info-value"><strong>{poDetailModal.po.po_number || '-'}</strong></div>
                </div>
                <div className="info-box">
                  <div className="info-label">Order Date</div>
                  <div className="info-value">{poDetailModal.po.created_at ? new Date(poDetailModal.po.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</div>
                </div>
              </div>

              <div className="manager-procurement">
                Manager-Procurement
              </div>

              <table>
                <thead>
                  <tr>
                    <th className="num">S.No</th>
                    <th className="desc">Description</th>
                    <th className="qty">Quantity</th>
                    <th className="unit">Unit</th>
                    <th className="rate">Rate (RS)</th>
                    <th className="amt">Amount (RS)</th>
                  </tr>
                </thead>
                <tbody>
                  {(poDetailModal.po.items || []).map((item, idx) => (
                    <tr key={idx}>
                      <td className="num">{idx + 1}</td>
                      <td className="desc">{item.material_name}</td>
                      <td className="qty">{(parseFloat(item.quantity) || 0).toLocaleString()}</td>
                      <td className="unit">{item.unit || 'pcs'}</td>
                      <td className="rate">{formatPKR(item.unit_price).replace('Rs. ', '')}</td>
                      <td className="amt">{formatPKR(parseFloat(item.quantity) * parseFloat(item.unit_price)).replace('Rs. ', '')}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="5" className="text-right">Total Amount (RS)</td>
                    <td className="amt">{formatPKR(poDetailModal.po.total_amount).replace('Rs. ', '')}</td>
                  </tr>
                  <tr>
                    <td colSpan="5" className="text-right">Special Discount (RS)</td>
                    <td className="amt">{formatPKR(poDetailModal.po.special_discount || 0).replace('Rs. ', '')}</td>
                  </tr>
                  <tr>
                    <td colSpan="5" className="text-right">Discounted Total (RS)</td>
                    <td className="amt">{formatPKR(poDetailModal.po.discounted_total || poDetailModal.po.total_amount).replace('Rs. ', '')}</td>
                  </tr>
                </tfoot>
              </table>

              <div className="terms-section">
                <div className="terms-title">Terms & Conditions</div>
                <div className="terms-list">
                  <ol>
                    {(poDetailModal.po.terms || []).map((term, idx) => (
                      <li key={term.id || idx}>{term.term_text}</li>
                    ))}
                    {(poDetailModal.po.terms || []).length === 0 && (
                      <li>Standard terms and conditions apply.</li>
                    )}
                  </ol>
                </div>
              </div>

              <div className="footer-fields">
                <div className="footer-box">
                  <div className="footer-label">Account to be Charged</div>
                  <div className="footer-value">{poDetailModal.po.account_charged || '-'}</div>
                </div>
                <div className="footer-box">
                  <div className="footer-label">Product Category</div>
                  <div className="footer-value">{poDetailModal.po.product_category || '-'}</div>
                </div>
                <div className="footer-box">
                  <div className="footer-label">Approved By</div>
                  <div className="footer-value">{poDetailModal.po.approved_by_name || poDetailModal.po.approved_by || '-'}</div>
                </div>
                <div className="footer-box">
                  <div className="footer-label">Note to Al Shafi Enterprises Accounts Dept</div>
                  <div className="footer-value">{poDetailModal.po.note_to_accounts || '-'}</div>
                </div>
              </div>

              <div className="footer-box" style={{gridColumn: '1 / -1'}}>
                <div className="footer-label">Seller's Acceptance</div>
                <div className="footer-value">{poDetailModal.po.seller_acceptance || '-'}</div>
              </div>

              <div className="signatures">
                <div className="sig-box">
                  <div className="sig-label">Prepared By</div>
                  <div>{poDetailModal.po.created_by_name || '-'}</div>
                </div>
                <div className="sig-box">
                  <div className="sig-label">Approved By</div>
                  <div>{poDetailModal.po.approved_by_name || poDetailModal.po.owner_approved_by_name || '-'}</div>
                </div>
                <div className="sig-box">
                  <div className="sig-label">Authorized Signature</div>
                  <div>&nbsp;</div>
                </div>
              </div>

              <div className="official-footer">
                <strong>AL SHAFI ENTERPRISES</strong><br/>
                123 Main Boulevard, Lahore, Pakistan<br/>
                Tel: +92-42-XXXXXXX | Email: info@alshafienterprises.com<br/>
                NTN: XXXXXXXX | STRN: XXXXXXXXXXXX<br/>
                <em>This is a computer-generated document. Valid without signature if approved through the official ERP workflow.</em>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* PO Rejection reason modal */}
      <Modal isOpen={rejectModal.open} onClose={() => setRejectModal({ open: false, poId: null, level: null })} title={`Reject PO (${rejectModal.level === 'admin' ? 'Admin' : 'Owner'} stage)`} size="max-w-md">
        <div className="space-y-4">
          <Input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason * (shown to the creator)" />
          <div className="flex gap-3">
            <Button variant="destructive" onClick={submitPoRejection}>Confirm Rejection</Button>
            <Button variant="secondary" onClick={() => setRejectModal({ open: false, poId: null, level: null })}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function OverviewPayments({ overview, payTypeFilter, setPayTypeFilter, formatPKR, statusBadge }) {
  const payments = (overview?.payments || []).filter(p => !payTypeFilter || p.payment_type === payTypeFilter)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Total PO Value</div>
          <div className="text-lg font-bold">{formatPKR(overview?.total_po_value)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Total Paid</div>
          <div className="text-lg font-bold text-emerald-600">{formatPKR(overview?.total_paid)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Outstanding Balance</div>
          <div className={`text-lg font-bold ${(overview?.balance || 0) < 0 ? 'text-red-600' : 'text-slate-800'}`}>{formatPKR(overview?.balance)}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="w-44">
          <Select value={payTypeFilter} onChange={e => setPayTypeFilter(e.target.value)}>
            <option value="">All Payment Types</option>
            <option value="fixed_otp">Fixed (OTP)</option>
            <option value="continuous">Continuous</option>
            <option value="ipc">IPC</option>
          </Select>
        </div>
        <span className="text-xs text-slate-400">{payments.length} payment{payments.length === 1 ? '' : 's'}</span>
      </div>
      {payments.length === 0 ? (
        <EmptyState icon={FileText} title="No payments" text="No vendor payments match this view" />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider">Project</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider">PO</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider">Amount</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payments.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-500">{p.payment_date ? new Date(p.payment_date).toLocaleDateString() : '-'}</td>
                    <td className="px-4 py-2.5">{p.payment_type?.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2.5 text-gray-500">{p.project_name || '-'}</td>
                    <td className="px-4 py-2.5 text-gray-500">{p.po_number || '-'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{formatPKR(p.amount)}</td>
                    <td className="px-4 py-2.5">{statusBadge(p.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function VendorForm({ data, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: data?.id || null, name: data?.name || '', contact_person: data?.contact_person || '',
    phone: data?.phone || '', email: data?.email || '', address: data?.address || '',
    city: data?.city || '', ntn_strn: data?.ntn_strn || '', status: data?.status || 'active', notes: data?.notes || '',
    attn: data?.attn || '', position: data?.position || '', vendor_email: data?.vendor_email || '', vendor_tel: data?.vendor_tel || ''
  })
  const [vendorTerms, setVendorTerms] = useState(data?.default_terms || [])
  const [showTerms, setShowTerms] = useState(false)

  useEffect(() => {
    if (data?.id && !vendorTerms.length) {
      api.get(`/vendors/${data.id}/terms`).then(({ data: terms }) => setVendorTerms(terms || [])).catch(() => {})
    }
  }, [data?.id])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name) return toast.error('Vendor name required')
    onSave(form)
  }

  const addVendorTerm = () => setVendorTerms([...vendorTerms, { id: `new-${Date.now()}`, term_text: '', display_order: vendorTerms.length }])
  const removeVendorTerm = (idx) => setVendorTerms(vendorTerms.filter((_, i) => i !== idx))
  const updateVendorTerm = (idx, field, value) => {
    const terms = [...vendorTerms]
    terms[idx] = { ...terms[idx], [field]: value }
    setVendorTerms(terms)
  }
  const moveVendorTerm = (idx, direction) => {
    const terms = [...vendorTerms]
    const newIdx = idx + direction
    if (newIdx >= 0 && newIdx < terms.length) {
      [terms[idx], terms[newIdx]] = [terms[newIdx], terms[idx]]
      setVendorTerms(terms)
    }
  }
  const saveVendorTerms = async () => {
    try {
      for (const term of vendorTerms) {
        if (term.id?.startsWith('new-')) {
          await api.post(`/vendors/${data.id}/terms`, { term_text: term.term_text, display_order: term.display_order })
        } else {
          await api.put(`/vendors/${data.id}/terms/${term.id}`, { term_text: term.term_text, display_order: term.display_order })
        }
      }
      toast.success('Vendor default terms saved')
      setShowTerms(false)
    } catch (err) { console.error(err); toast.error('Failed to save vendor terms') }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input label="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <Input label="Contact Person" value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} />
        <Input label="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
        <Input label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <Input label="City" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
        <Input label="NTN/STRN" value={form.ntn_strn} onChange={e => setForm({ ...form, ntn_strn: e.target.value })} />
        <Select label="Status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></Select>
      </div>
      <Input label="Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
      
      <div className="grid grid-cols-2 gap-4">
        <Input label="Attn" value={form.attn} onChange={e => setForm({ ...form, attn: e.target.value })} placeholder="Contact person for POs" />
        <Input label="Position" value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} placeholder="e.g. Purchase Manager" />
        <Input label="Vendor Email" type="email" value={form.vendor_email} onChange={e => setForm({ ...form, vendor_email: e.target.value })} placeholder="PO correspondence email" />
        <Input label="Vendor Tel" value={form.vendor_tel} onChange={e => setForm({ ...form, vendor_tel: e.target.value })} placeholder="PO contact number" />
      </div>
      
      <Input label="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
      
      {/* Vendor Default Terms Management */}
      <div className="border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-700">Default Terms & Conditions</h4>
          <Button variant="secondary" size="sm" onClick={() => setShowTerms(!showTerms)}>
            {showTerms ? 'Hide' : 'Manage'} Terms
          </Button>
        </div>
        {showTerms && (
          <div className="space-y-2">
            {vendorTerms.map((term, idx) => (
              <div key={term.id || idx} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-6">{idx + 1}.</span>
                <Input 
                  value={term.term_text} 
                  onChange={e => updateVendorTerm(idx, 'term_text', e.target.value)} 
                  placeholder="Term text" 
                  className="flex-1"
                />
                <Button variant="ghost" size="sm" onClick={() => moveVendorTerm(idx, -1)} disabled={idx === 0} title="Move up"><ChevronRight size={14} className="-rotate-90" /></Button>
                <Button variant="ghost" size="sm" onClick={() => moveVendorTerm(idx, 1)} disabled={idx === vendorTerms.length - 1} title="Move down"><ChevronRight size={14} className="rotate-90" /></Button>
                <Button variant="ghost" size="sm" onClick={() => removeVendorTerm(idx)} className="text-red-600" title="Delete"><Trash2 size={14} /></Button>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={addVendorTerm}><Plus size={14} /> Add Term</Button>
            {data?.id && <Button variant="primary" size="sm" onClick={saveVendorTerms} className="ml-2">Save Terms</Button>}
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit">{form.id ? 'Update' : 'Create'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
