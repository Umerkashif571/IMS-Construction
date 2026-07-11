import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Modal, ConfirmDialog, Button, Input, Select, LoadingSkeleton, EmptyState, Badge } from '../components/ui'
import { Plus, Search, FileText, PlusCircle, Edit3, Trash2, X, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'

const statusBadge = (s) => {
  const map = { active: 'success', inactive: 'default' }
  return <Badge variant={map[s] || 'default'}>{s}</Badge>
}

export default function Vendors() {
  const { user } = useAuth()
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState({ open: false, item: null })
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null })
  const [poModal, setPoModal] = useState({ open: false, vendor: null })
  const [pos, setPos] = useState([])
  const [createPoModal, setCreatePoModal] = useState({ open: false, vendor: null })
  const [poForm, setPoForm] = useState({ items: [{ material_name: '', quantity: '', unit: '', unit_price: '' }] })

  const canEdit = ['owner', 'admin', 'store_manager', 'manager'].includes(user?.role)

  const load = (q = '') => {
    setLoading(true)
    const params = q ? `?search=${q}` : ''
    api.get(`/vendors${params}`).then(({ data }) => setVendors(data)).catch(() => toast.error('Failed to load vendors')).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleSave = async (form) => {
    try {
      if (form.id) { await api.put(`/vendors/${form.id}`, form); toast.success('Vendor updated') }
      else { await api.post('/vendors', form); toast.success('Vendor created') }
      setModal({ open: false, item: null }); load(search)
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save') }
  }

  const handleDelete = async () => {
    try { await api.delete(`/vendors/${deleteConfirm.id}`); toast.success('Vendor deleted'); setDeleteConfirm({ open: false, id: null }); load(search) } catch (err) { toast.error('Failed to delete') }
  }

  const viewPOs = async (vendor) => {
    setPoModal({ open: true, vendor })
    try {
      const { data } = await api.get('/vendors/pos/list', { params: { vendor_id: vendor.id } })
      setPos(data || [])
    } catch (err) { toast.error('Failed to load purchase orders'); setPos([]) }
  }

  const handleApprovePO = async (poId) => {
    try { await api.put(`/purchase-orders/${poId}/approve`); toast.success('PO approved'); viewPOs(poModal.vendor) } catch (err) { toast.error('Approval failed') }
  }

  const handleReceivePO = async (poId) => {
    try { await api.put(`/purchase-orders/${poId}/receive`); toast.success('PO marked as received'); viewPOs(poModal.vendor) } catch (err) { toast.error('Failed to update PO') }
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
      await api.post(`/vendors/${createPoModal.vendor.id}/purchase-orders`, { items: poForm.items.map(it => ({ ...it, quantity: parseFloat(it.quantity) || 0, unit_price: parseFloat(it.unit_price) || 0 })) })
      toast.success('Purchase order created'); setCreatePoModal({ open: false, vendor: null }); setPoForm({ items: [{ material_name: '', quantity: '', unit: '', unit_price: '' }] })
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to create PO') }
  }

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
          <Input placeholder="Search vendors..." value={search} onChange={e => { setSearch(e.target.value); load(e.target.value) }} />
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
      <Modal isOpen={poModal.open} onClose={() => { setPoModal({ open: false, vendor: null }); setPos([]) }} title={`Purchase Orders: ${poModal.vendor?.name}`} size="max-w-2xl">
        <div className="space-y-4">
          {pos.length === 0 ? (
            <EmptyState icon={FileText} title="No purchase orders" text="No POs created for this vendor yet" />
          ) : (
            pos.map(po => (
              <div key={po.id} className="border border-gray-200 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">PO #{po.po_number || po.id}</span>
                    <span className="text-xs text-gray-400 ml-2">{po.created_at ? new Date(po.created_at).toLocaleDateString() : '-'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(po.status)}
                    {canEdit && po.status === 'pending' && (
                      <Button variant="primary" size="sm" onClick={() => handleApprovePO(po.id)}>Approve</Button>
                    )}
                    {canEdit && po.status === 'approved' && (
                      <Button variant="secondary" size="sm" onClick={() => handleReceivePO(po.id)}>Mark Received</Button>
                    )}
                  </div>
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-500 border-b"><th className="text-left py-1">Item</th><th className="text-left py-1">Qty</th><th className="text-left py-1">Unit</th><th className="text-left py-1">Unit Price</th><th className="text-right py-1">Total</th></tr></thead>
                  <tbody>{(po.items || []).map((item, idx) => (
                    <tr key={idx} className="border-b border-gray-50"><td className="py-1">{item.material_name}</td><td>{(parseFloat(item.quantity) || 0).toLocaleString()}</td><td>{item.unit}</td><td>PKR {(parseFloat(item.unit_price) || 0).toLocaleString()}</td><td className="text-right">PKR {((parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0)).toLocaleString()}</td></tr>
                  ))}</tbody>
                </table>
                {po.delivery_status && (<p className="text-xs text-gray-500">Delivery: {po.delivery_status}</p>)}
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* Create PO Modal */}
      <Modal isOpen={createPoModal.open} onClose={() => { setCreatePoModal({ open: false, vendor: null }); setPoForm({ items: [{ material_name: '', quantity: '', unit: '', unit_price: '' }] }) }} title={`Create PO: ${createPoModal.vendor?.name}`} size="max-w-lg">
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
          <Button onClick={handleCreatePO} className="w-full">Create Purchase Order</Button>
        </div>
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