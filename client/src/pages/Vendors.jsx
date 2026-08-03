import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Modal, ConfirmDialog, Button, Input, Select, LoadingSkeleton, EmptyState, Badge, useDebouncedValue } from '../components/ui'
import { Plus, Search, FileText, PlusCircle, Edit3, Trash2, X, Building2, Printer, ChevronRight, CheckCircle, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'

const statusBadge = (s) => {
  const map = {
    active: 'success', inactive: 'default',
    pending: 'warning', approved: 'info', partial_received: 'purple',
    received: 'success', cancelled: 'error', completed: 'success'
  }
  return <Badge variant={map[s] || 'default'}>{s?.replace(/_/g, ' ') || s}</Badge>
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
  const [pos, setPos] = useState([])
  const [poSearch, setPoSearch] = useState('')
  const [poStatusFilter, setPoStatusFilter] = useState('')
  const [createPoModal, setCreatePoModal] = useState({ open: false, vendor: null })
  const [poForm, setPoForm] = useState({ items: [{ material_name: '', quantity: '', unit: '', unit_price: '' }], notes: '' })
  const [poDetailModal, setPoDetailModal] = useState({ open: false, po: null })
  const [allPos, setAllPos] = useState([])

  const canEdit = ['owner', 'admin', 'store_manager', 'manager'].includes(user?.role)
  const canApprove = ['owner', 'admin'].includes(user?.role)

  const load = (q = '') => {
    setLoading(true)
    const params = q ? `?search=${q}` : ''
    api.get(`/vendors${params}`).then(({ data }) => setVendors(data)).catch(err => { console.error(err); toast.error('Failed to load vendors') }).finally(() => setLoading(false))
  }

  useEffect(() => { load(debouncedSearch) }, [debouncedSearch])

  // Deep link: /vendors?po=<id> opens the PO detail modal
  const [searchParams] = useSearchParams()
  const poParam = searchParams.get('po')
  useEffect(() => {
    if (!poParam) return
    api.get(`/purchase-orders/${poParam}`).then(({ data }) => {
      setPoDetailModal({ open: true, po: data })
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
    try {
      const { data } = await api.get('/vendors/pos/list', { params: { vendor_id: vendor.id } })
      setPos(data || [])
    } catch (err) { console.error(err); toast.error('Failed to load purchase orders'); setPos([]) }
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

  const handleCreatePO = async () => {
    if (poForm.items.length === 0 || !poForm.items[0].material_name) return toast.error('At least one item required')
    try {
      const { data } = await api.post(`/vendors/${createPoModal.vendor.id}/purchase-orders`, {
        items: poForm.items.map(it => ({ ...it, quantity: parseFloat(it.quantity) || 0, unit_price: parseFloat(it.unit_price) || 0 })),
        notes: poForm.notes
      })
      toast.success('Purchase order created')
      setCreatePoModal({ open: false, vendor: null })
      setPoForm({ items: [{ material_name: '', quantity: '', unit: '', unit_price: '' }], notes: '' })
      setPoDetailModal({ open: true, po: data })
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to create PO') }
  }

  const printPO = () => {
    const printContents = document.getElementById('po-document')?.innerHTML
    if (!printContents) return
    const win = window.open('', '_blank')
    win.document.write(`<html><head><title>Purchase Order</title>
      <style>
        body { font-family: 'Courier New', monospace; padding: 40px; color: #1e293b; }
        .header { text-align: center; border-bottom: 2px solid #1e293b; padding-bottom: 20px; margin-bottom: 30px; }
        .header h1 { font-size: 24px; margin: 0; text-transform: uppercase; letter-spacing: 2px; }
        .header p { margin: 4px 0; font-size: 12px; color: #64748b; }
        .info-row { display: flex; justify-content: space-between; margin-bottom: 30px; }
        .info-box { width: 45%; }
        .info-box h3 { font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
        .info-box p { margin: 2px 0; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th { background: #f1f5f9; text-align: left; padding: 10px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #475569; border-bottom: 2px solid #cbd5e1; }
        td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #e2e8f0; }
        .total-row td { font-weight: bold; border-top: 2px solid #1e293b; font-size: 14px; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
        .status-badge { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
      </style></head><body>${printContents}</body></html>`)
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
                        {canEdit && (
                          <>
                            <button onClick={() => setCreatePoModal({ open: true, vendor: v })} className="p-1.5 hover:bg-purple-50 rounded text-purple-600" title="Create PO"><PlusCircle size={16} /></button>
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

      {/* Purchase Orders Modal */}
      <Modal isOpen={poModal.open} onClose={() => { setPoModal({ open: false, vendor: null }); setPos([]); setPoSearch(''); setPoStatusFilter('') }} title={`Purchase Orders: ${poModal.vendor?.name}`} size="max-w-3xl">
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1"><Input placeholder="Search POs..." value={poSearch} onChange={e => setPoSearch(e.target.value)} /></div>
            <div className="w-40"><Select value={poStatusFilter} onChange={e => setPoStatusFilter(e.target.value)}><option value="">All Status</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="partial_received">Partial Received</option><option value="received">Received</option><option value="cancelled">Cancelled</option></Select></div>
          </div>
          {filteredPos.length === 0 ? (
            <EmptyState icon={FileText} title="No purchase orders" text="No POs found for this vendor" />
          ) : (
            <div className="space-y-2">
              {filteredPos.map(po => (
                <div key={po.id} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => openPoDetail(po)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">#{po.po_number}</span>
                      <span className="text-xs text-gray-400">{po.created_at ? new Date(po.created_at).toLocaleDateString() : '-'}</span>
                      {statusBadge(po.status)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">PKR {(parseFloat(po.total_amount) || 0).toLocaleString()}</span>
                      <ChevronRight size={16} className="text-gray-400" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Create PO Modal */}
      <Modal isOpen={createPoModal.open} onClose={() => { setCreatePoModal({ open: false, vendor: null }); setPoForm({ items: [{ material_name: '', quantity: '', unit: '', unit_price: '' }], notes: '' }) }} title={`Create PO: ${createPoModal.vendor?.name}`} size="max-w-lg">
        <div className="space-y-4">
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
          <Input value={poForm.notes} onChange={e => setPoForm({ ...poForm, notes: e.target.value })} placeholder="Delivery notes / expected delivery date" />
          <Button onClick={handleCreatePO} className="w-full">Create Purchase Order</Button>
        </div>
      </Modal>

      {/* PO Detail Document Modal */}
      <Modal isOpen={poDetailModal.open} onClose={() => setPoDetailModal({ open: false, po: null })} title={`PO: ${poDetailModal.po?.po_number}`} size="max-w-3xl">
        {poDetailModal.po && (
          <div className="space-y-4">
            <div className="flex gap-2 justify-end">
              {poDetailModal.po.status === 'pending' && canApprove && (
                <Button size="sm" onClick={() => handlePoStatus(poDetailModal.po.id, 'approved')}><CheckCircle size={14} /> Approve</Button>
              )}
              {poDetailModal.po.status === 'approved' && canEdit && (
                <Button size="sm" variant="secondary" onClick={() => handlePoStatus(poDetailModal.po.id, 'received')}><CheckCircle size={14} /> Mark Received</Button>
              )}
              {['pending', 'approved'].includes(poDetailModal.po.status) && canEdit && (
                <Button size="sm" variant="destructive" onClick={() => handlePoStatus(poDetailModal.po.id, 'cancelled')}><XCircle size={14} /> Cancel</Button>
              )}
              <Button size="sm" variant="secondary" onClick={printPO}><Printer size={14} /> Print</Button>
            </div>
            <div id="po-document" className="bg-white border border-gray-200 rounded-xl p-8 text-sm">
              <div className="text-center border-b-2 border-gray-900 pb-5 mb-6">
                <h1 className="text-xl font-bold uppercase tracking-widest">Purchase Order</h1>
                <p className="text-xs text-gray-500 mt-1">#{poDetailModal.po.po_number}</p>
              </div>
              <div className="flex justify-between mb-6">
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-1">Vendor</h3>
                  <p className="font-semibold">{poDetailModal.po.vendor_name || '-'}</p>
                  {poDetailModal.po.vendor_contact && <p className="text-xs text-gray-600">Attn: {poDetailModal.po.vendor_contact}</p>}
                  {poDetailModal.po.vendor_address && <p className="text-xs text-gray-600">{poDetailModal.po.vendor_address}</p>}
                  <p className="text-xs text-gray-600">{poDetailModal.po.vendor_city || ''}</p>
                  {poDetailModal.po.vendor_phone && <p className="text-xs text-gray-600">Tel: {poDetailModal.po.vendor_phone}</p>}
                </div>
                <div className="text-right">
                  <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-1">Order Details</h3>
                  <p className="text-xs text-gray-600">Date: {poDetailModal.po.created_at ? new Date(poDetailModal.po.created_at).toLocaleDateString() : '-'}</p>
                  <p className="text-xs text-gray-600">Status: {poDetailModal.po.status}</p>
                  {poDetailModal.po.received_by && <p className="text-xs text-gray-600">Received by: {poDetailModal.po.received_by}</p>}
                  {poDetailModal.po.notes && <p className="text-xs text-gray-600 mt-2 italic">{poDetailModal.po.notes}</p>}
                </div>
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="bg-gray-100 text-left px-3 py-2 text-xs uppercase tracking-wider">Item</th>
                    <th className="bg-gray-100 text-right px-3 py-2 text-xs uppercase tracking-wider">Qty</th>
                    <th className="bg-gray-100 text-left px-3 py-2 text-xs uppercase tracking-wider">Unit</th>
                    <th className="bg-gray-100 text-right px-3 py-2 text-xs uppercase tracking-wider">Unit Price</th>
                    <th className="bg-gray-100 text-right px-3 py-2 text-xs uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(poDetailModal.po.items || []).map((item, idx) => (
                    <tr key={idx} className="border-b border-gray-100">
                      <td className="px-3 py-2 text-sm">{item.material_name}</td>
                      <td className="px-3 py-2 text-sm text-right">{(parseFloat(item.quantity) || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-sm">{item.unit}</td>
                      <td className="px-3 py-2 text-sm text-right">PKR {(parseFloat(item.unit_price) || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-sm text-right">PKR {((parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0)).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td colSpan={4} className="px-3 py-3 text-sm text-right border-t-2 border-gray-900">Total:</td>
                    <td className="px-3 py-3 text-sm text-right border-t-2 border-gray-900">PKR {(parseFloat(poDetailModal.po.total_amount) || 0).toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
              <div className="mt-8 pt-4 border-t border-gray-200 text-center text-xs text-gray-500">
                <p>This is a computer-generated document. No signature is required.</p>
                <p className="mt-1">Generated by IMS — {new Date().toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function VendorForm({ data, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: data?.id || null, name: data?.name || '', contact_person: data?.contact_person || '',
    phone: data?.phone || '', email: data?.email || '', address: data?.address || '',
    city: data?.city || '', ntn_strn: data?.ntn_strn || '', status: data?.status || 'active', notes: data?.notes || ''
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name) return toast.error('Vendor name required')
    onSave(form)
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
      <Input label="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
      <div className="flex gap-3 pt-2">
        <Button type="submit">{form.id ? 'Update' : 'Create'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
