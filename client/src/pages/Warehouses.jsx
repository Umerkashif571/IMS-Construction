import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Modal, ConfirmDialog, Button, Input, Select, LoadingSkeleton, EmptyState, Badge, useDebouncedValue } from '../components/ui'
import { Plus, Search, Edit3, Trash2, ArrowRightLeft, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'

const statusBadge = (s) => {
  const map = { pending: 'warning', approved: 'success', rejected: 'error', completed: 'info', cancelled: 'default' }
  return <Badge variant={map[s] || 'default'}>{s}</Badge>
}

// Safe array extraction: list endpoints return either an array or { data: [], pagination }
const safeArray = (d) => Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : [])

// Role gates mirror server/src/routes/warehouses.js authorize() lists
const MANAGE_ROLES = ['owner', 'admin', 'store_manager']            // create/edit warehouses, approve/complete transfers
const DELETE_ROLES = ['owner', 'admin']
const TRANSFER_REQUEST_ROLES = ['owner', 'admin', 'store_manager', 'site_engineer']
const USERS_ROLES = ['owner', 'admin']                              // GET /users is admin-only
// Button action -> status value the API expects
const TRANSFER_STATUS = { approve: 'approved', reject: 'rejected', complete: 'completed', cancel: 'cancelled' }
// Must match the CHECK constraint on warehouses.type
const WAREHOUSE_TYPES = [['main_store', 'Main Store'], ['site_store', 'Site Store'], ['warehouse', 'Warehouse']]

export default function Warehouses() {
  const { user } = useAuth()
  const [warehouses, setWarehouses] = useState([])
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [modal, setModal] = useState({ open: false, item: null })
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null })
  const [detailModal, setDetailModal] = useState({ open: false, warehouse: null, transactions: [] })
  const [transferModal, setTransferModal] = useState({ open: false })
  const [transferList, setTransferList] = useState([])
  const [transferForm, setTransferForm] = useState({ type: 'material', entity_id: '', from_warehouse_id: '', to_warehouse_id: '', quantity: '', notes: '' })
  const [materialsList, setMaterialsList] = useState([])
  const [vehiclesList, setVehiclesList] = useState([])
  const [toolsList, setToolsList] = useState([])

  const canEdit = MANAGE_ROLES.includes(user?.role)
  const canDelete = DELETE_ROLES.includes(user?.role)
  const canRequestTransfer = TRANSFER_REQUEST_ROLES.includes(user?.role)
  const canLoadUsers = USERS_ROLES.includes(user?.role)

  const load = (q = '') => {
    setLoading(true)
    const params = q ? `?search=${encodeURIComponent(q)}` : ''
    // Reference lists degrade gracefully: a failure there must not blank the warehouses table
    Promise.all([
      api.get(`/warehouses${params}`),
      api.get('/projects?limit=200').catch(() => ({ data: [] })),
      canLoadUsers ? api.get('/users').catch(() => ({ data: [] })) : Promise.resolve({ data: [] })
    ]).then(([wRes, pRes, uRes]) => {
      setWarehouses(safeArray(wRes?.data))
      setProjects(safeArray(pRes?.data))
      setUsers(safeArray(uRes?.data))
    }).catch(err => { console.error(err); toast.error(err.response?.data?.error || 'Failed to load warehouses') }).finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(debouncedSearch) }, [debouncedSearch, canLoadUsers])

  const handleSave = async (form) => {
    try {
      const { id, ...payload } = form
      if (id) { await api.put(`/warehouses/${id}`, payload); toast.success('Warehouse updated') }
      else { await api.post('/warehouses', payload); toast.success('Warehouse created') }
      setModal({ open: false, item: null }); load(debouncedSearch)
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to save') }
  }

  const handleDelete = async () => {
    try { await api.delete(`/warehouses/${deleteConfirm.id}`); toast.success('Warehouse deactivated'); setDeleteConfirm({ open: false, id: null }); load(debouncedSearch) } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to delete') }
  }

  const openDetail = async (warehouse) => {
    try {
      const { data } = await api.get(`/warehouses/${warehouse.id}/transactions`)
      setDetailModal({ open: true, warehouse, transactions: safeArray(data) })
    } catch (err) {
      console.error(err); toast.error(err.response?.data?.error || 'Failed to load transactions')
    }
  }

  const openTransferModal = async () => {
    setTransferModal({ open: true })
    setTransferForm({ type: 'material', entity_id: '', from_warehouse_id: '', to_warehouse_id: '', quantity: '', notes: '' })
    try {
      const [matRes, vehRes, tolRes] = await Promise.all([
        api.get('/materials?limit=200').catch(() => ({ data: [] })),
        api.get('/vehicles?limit=500').catch(() => ({ data: [] })),
        api.get('/tools?limit=500').catch(() => ({ data: [] }))
      ])
      setMaterialsList(safeArray(matRes.data))
      setVehiclesList(safeArray(vehRes.data))
      setToolsList(safeArray(tolRes.data))
    } catch (err) { console.error(err); toast.error('Failed to load transfer options') }
  }

  const loadTransfers = async () => {
    try { const { data } = await api.get('/warehouses/transfers/list'); setTransferList(safeArray(data)) } catch (err) { console.error(err); setTransferList([]) }
  }

  useEffect(() => { loadTransfers() }, [])

  const handleCreateTransfer = async () => {
    if (!transferForm.from_warehouse_id || !transferForm.to_warehouse_id) return toast.error('From/To warehouse required')
    if (transferForm.from_warehouse_id === transferForm.to_warehouse_id) return toast.error('Source and destination must differ')
    if (!transferForm.entity_id) return toast.error('Select what to transfer')
    const isMaterial = transferForm.type === 'material'
    const qty = isMaterial ? Number(transferForm.quantity) : 1
    if (isMaterial && (!Number.isFinite(qty) || qty <= 0)) return toast.error('Quantity must be a positive number')
    if (isMaterial) {
      const available = parseFloat(materialsList.find(m => m.id === transferForm.entity_id)?.quantity)
      if (Number.isFinite(available) && qty > available) return toast.error(`Only ${available} available in stock`)
    }
    try {
      await api.post('/warehouses/transfers', {
        request_type: transferForm.type,
        entity_id: transferForm.entity_id,
        quantity: qty,
        from_warehouse_id: transferForm.from_warehouse_id,
        to_warehouse_id: transferForm.to_warehouse_id,
        notes: transferForm.notes
      })
      toast.success('Transfer request created')
      setTransferModal({ open: false }); loadTransfers()
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to create transfer') }
  }

  const handleTransferAction = async (id, action) => {
    const status = TRANSFER_STATUS[action]
    if (!status) return
    try {
      await api.put(`/warehouses/transfers/${id}`, { status })
      toast.success(`Transfer ${status}`)
      await loadTransfers()
      if (status === 'completed') load(debouncedSearch)
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || `Failed to ${action} transfer`) }
  }

  const getEntityOptions = () => {
    if (transferForm.type === 'material') {
      // Only materials stocked in the selected source warehouse (or without a warehouse) can leave it
      const from = transferForm.from_warehouse_id
      return materialsList
        .filter(m => !from || !m.warehouse_id || m.warehouse_id === from)
        .map(m => ({ value: m.id, label: `${m.name} (SKU: ${m.sku}) - ${parseFloat(m.quantity) || 0} ${m.unit || ''}` }))
    }
    if (transferForm.type === 'vehicle') return vehiclesList.map(v => ({ value: v.id, label: `${v.registration_no} - ${v.brand || ''} ${v.model || ''}` }))
    return toolsList.map(t => ({ value: t.id, label: `${t.name} (${t.serial_number || t.serial_no || 'no serial'})` }))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900">Warehouses</h1>
          <p className="text-sm text-slate-500 mt-1">Manage storage locations and transfers</p>
        </div>
        <div className="flex gap-2">
          {canRequestTransfer && (
            <Button variant="secondary" onClick={openTransferModal}><ArrowRightLeft size={16} /> Transfer Request</Button>
          )}
          {canEdit && (
            <Button onClick={() => setModal({ open: true, item: {} })}><Plus size={16} /> Add Warehouse</Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="w-full sm:max-w-xs">
          <Input placeholder="Search warehouses..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      {loading ? (
        <LoadingSkeleton rows={5} cols={7} />
      ) : warehouses.length === 0 ? (
        <EmptyState icon={Building2} title="No warehouses found" text="No warehouses match your search criteria" />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Location</th>
                  <th className="text-left px-4 py-3 font-medium">City</th>
                  <th className="text-left px-4 py-3 font-medium">Project</th>
                  <th className="text-left px-4 py-3 font-medium">Manager</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  {canEdit && <th className="text-left px-4 py-3 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {warehouses.map(w => (
                  <tr key={w.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3"><button onClick={() => openDetail(w)} className="font-medium text-blue-600 hover:underline text-left">{w.name}</button></td>
                    <td className="px-4 py-3 text-slate-500">{w.type || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{w.location || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{w.city || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{w.project_name || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{w.manager_name || '-'}</td>
                    <td className="px-4 py-3">{w.is_active === false ? <Badge variant="default">inactive</Badge> : <Badge variant="success">active</Badge>}</td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => setModal({ open: true, item: w })} className="p-1.5 hover:bg-green-50 rounded text-green-600" title="Edit"><Edit3 size={16} /></button>
                          {canDelete && w.is_active !== false && <button onClick={() => setDeleteConfirm({ open: true, id: w.id })} className="p-1.5 hover:bg-red-50 rounded text-red-600" title="Deactivate"><Trash2 size={16} /></button>}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transfer Requests Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Transfer Requests</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Entity</th>
                <th className="text-left px-4 py-3 font-medium">From</th>
                <th className="text-left px-4 py-3 font-medium">To</th>
                <th className="text-left px-4 py-3 font-medium">Qty</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                {canEdit && <th className="text-left px-4 py-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transferList.map(t => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 capitalize text-slate-500">{t.request_type || t.entity_type || '-'}</td>
                  <td className="px-4 py-3 text-slate-500">{t.entity_name || '-'}</td>
                  <td className="px-4 py-3 text-slate-500">{t.from_warehouse_name || '-'}</td>
                  <td className="px-4 py-3 text-slate-500">{t.to_warehouse_name || '-'}</td>
                  <td className="px-4 py-3">{(parseFloat(t.quantity) || 0).toLocaleString()}</td>
                  <td className="px-4 py-3">{statusBadge(t.status)}</td>
                  <td className="px-4 py-3 text-slate-500">{t.created_at ? new Date(t.created_at).toLocaleDateString() : '-'}</td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {t.status === 'pending' && t.requested_by !== user?.id && (
                          <>
                            <Button variant="primary" size="sm" onClick={() => handleTransferAction(t.id, 'approve')}>Approve</Button>
                            <Button variant="destructive" size="sm" onClick={() => handleTransferAction(t.id, 'reject')}>Reject</Button>
                          </>
                        )}
                        {t.status === 'pending' && t.requested_by === user?.id && (
                          <span className="text-xs text-slate-400 self-center">Awaiting another approver</span>
                        )}
                        {t.status === 'approved' && (
                          <>
                            <Button variant="secondary" size="sm" onClick={() => handleTransferAction(t.id, 'complete')}>Complete</Button>
                            <Button variant="ghost" size="sm" onClick={() => handleTransferAction(t.id, 'cancel')}>Cancel</Button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {transferList.length === 0 && (
                <tr><td colSpan={canEdit ? 8 : 7} className="text-center py-6"><EmptyState icon={ArrowRightLeft} title="No transfers" text="No transfer requests yet" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Warehouse Detail Modal */}
      <Modal isOpen={detailModal.open} onClose={() => setDetailModal({ open: false, warehouse: null, transactions: [] })} title={detailModal.warehouse?.name || 'Warehouse Details'} size="max-w-4xl">
        {detailModal.warehouse && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 rounded-lg p-4">
              <div><span className="text-xs text-slate-500 block">Type</span><span className="text-sm font-medium">{detailModal.warehouse.type || '-'}</span></div>
              <div><span className="text-xs text-slate-500 block">Location</span><span className="text-sm font-medium">{detailModal.warehouse.location || '-'}</span></div>
              <div><span className="text-xs text-slate-500 block">City</span><span className="text-sm font-medium">{detailModal.warehouse.city || '-'}</span></div>
              <div><span className="text-xs text-slate-500 block">Manager</span><span className="text-sm font-medium">{detailModal.warehouse.manager_name || '-'}</span></div>
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-800 mb-3">Material Movements</h3>
              {detailModal.transactions.length === 0 ? (
                <p className="text-sm text-slate-400 py-3 text-center">No material transactions for this warehouse</p>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Date/Time</th>
                        <th className="text-left px-3 py-2 font-medium">Material</th>
                        <th className="text-left px-3 py-2 font-medium">SKU</th>
                        <th className="text-left px-3 py-2 font-medium">Type</th>
                        <th className="text-left px-3 py-2 font-medium">Quantity</th>
                        <th className="text-left px-3 py-2 font-medium">Project</th>
                        <th className="text-left px-3 py-2 font-medium">By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detailModal.transactions.map(t => (
                        <tr key={t.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 text-xs text-slate-500">{t.created_at ? new Date(t.created_at).toLocaleString() : '-'}</td>
                          <td className="px-3 py-2 font-medium">{t.material_name || '-'}</td>
                          <td className="px-3 py-2 text-xs text-slate-500 font-mono">{t.sku || '-'}</td>
                          <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full ${t.type === 'in' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{t.type === 'in' ? 'Stock In' : 'Stock Out'}</span></td>
                          <td className="px-3 py-2 font-medium">{(parseFloat(t.quantity) || 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-slate-600">{t.project_name || '-'}</td>
                          <td className="px-3 py-2 text-slate-600">{t.added_by || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={modal.open} onClose={() => setModal({ open: false, item: null })} title={modal.item?.id ? 'Edit Warehouse' : 'Add Warehouse'} size="max-w-lg">
        <WarehouseForm data={modal.item} projects={projects} users={users} onSave={handleSave} onCancel={() => setModal({ open: false, item: null })} />
      </Modal>

      <ConfirmDialog isOpen={deleteConfirm.open} onClose={() => setDeleteConfirm({ open: false, id: null })} onConfirm={handleDelete} message="Deactivate this warehouse? It must not hold any stock or tools." confirmLabel="Deactivate" />

      <Modal isOpen={transferModal.open} onClose={() => setTransferModal({ open: false })} title="Create Transfer Request" size="max-w-md">
        <div className="space-y-4">
          <Select label="Transfer Type" value={transferForm.type} onChange={e => { setTransferForm({ ...transferForm, type: e.target.value, entity_id: '' }) }}>
            <option value="material">Material</option><option value="vehicle">Vehicle</option><option value="tool">Tool</option>
          </Select>
          <Select label="From Warehouse" value={transferForm.from_warehouse_id} onChange={e => setTransferForm({ ...transferForm, from_warehouse_id: e.target.value, entity_id: '' })}>
            <option value="">Select source</option>
            {warehouses.filter(w => w.is_active !== false).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Select label="To Warehouse" value={transferForm.to_warehouse_id} onChange={e => setTransferForm({ ...transferForm, to_warehouse_id: e.target.value })}>
            <option value="">Select destination</option>
            {warehouses.filter(w => w.is_active !== false && w.id !== transferForm.from_warehouse_id).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Select label="Entity" value={transferForm.entity_id} onChange={e => setTransferForm({ ...transferForm, entity_id: e.target.value })}>
            <option value="">Select {transferForm.type}</option>
            {getEntityOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          {transferForm.type === 'material' && (
            <Input label="Quantity" type="number" min="0.01" step="0.01" value={transferForm.quantity} onChange={e => setTransferForm({ ...transferForm, quantity: e.target.value })} />
          )}
          <Input label="Notes" value={transferForm.notes} onChange={e => setTransferForm({ ...transferForm, notes: e.target.value })} />
          <Button onClick={handleCreateTransfer} className="w-full">Create Transfer Request</Button>
        </div>
      </Modal>
    </div>
  )
}

function WarehouseForm({ data, projects, users, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: data?.id || null, name: data?.name || '', type: data?.type || '',
    location: data?.location || '', city: data?.city || '',
    project_id: data?.project_id || '', manager_name: data?.manager_name || '', contact_phone: data?.contact_phone || '',
    is_active: data?.is_active !== false
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Warehouse name required')
    if (!form.type) return toast.error('Warehouse type required')
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input label="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <Select label="Type *" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="">Select</option>{WAREHOUSE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        <Input label="Location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
        <Input label="City" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
        <Select label="Project" value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}><option value="">None</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Input label="Manager" list="warehouse-manager-options" value={form.manager_name} onChange={e => setForm({ ...form, manager_name: e.target.value })} placeholder="Manager name" />
        {users.length > 0 && <datalist id="warehouse-manager-options">{users.map(u => <option key={u.id} value={u.full_name || u.email} />)}</datalist>}
        <Input label="Contact Phone" value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} />
        {form.id && (
          <label className="flex items-center gap-2 text-sm text-slate-700 self-end pb-2">
            <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} /> Active
          </label>
        )}
      </div>
      <div className="flex gap-3 pt-2">
        <Button type="submit">{form.id ? 'Update' : 'Create'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}