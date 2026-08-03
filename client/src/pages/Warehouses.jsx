import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Modal, ConfirmDialog, Button, Input, Select, LoadingSkeleton, EmptyState, Badge, useDebouncedValue } from '../components/ui'
import { Plus, Search, Edit3, Trash2, ArrowRightLeft, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'

const statusBadge = (s) => {
  const map = { pending: 'warning', approved: 'success', rejected: 'error', completed: 'info' }
  return <Badge variant={map[s] || 'default'}>{s}</Badge>
}

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

  const canEdit = ['owner', 'admin', 'store_manager', 'manager'].includes(user?.role)

  const load = (q = '') => {
    setLoading(true)
    const params = q ? `?search=${q}` : ''
    Promise.all([
      api.get(`/warehouses${params}`),
      api.get('/projects'),
      api.get('/users')
    ]).then(([wRes, pRes, uRes]) => {
      setWarehouses(wRes.data)
      setProjects(pRes.data || [])
      setUsers(uRes.data || [])
    }).catch(err => { console.error(err); toast.error('Failed to load warehouses') }).finally(() => setLoading(false))
  }

  useEffect(() => { load(debouncedSearch) }, [debouncedSearch])

  const handleSave = async (form) => {
    try {
      if (form.id) { await api.put(`/warehouses/${form.id}`, form); toast.success('Warehouse updated') }
      else { await api.post('/warehouses', form); toast.success('Warehouse created') }
      setModal({ open: false, item: null }); load(search)
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to save') }
  }

  const handleDelete = async () => {
    try { await api.delete(`/warehouses/${deleteConfirm.id}`); toast.success('Warehouse deleted'); setDeleteConfirm({ open: false, id: null }); load(search) } catch (err) { console.error(err); toast.error('Failed to delete') }
  }

  const openDetail = async (warehouse) => {
    try {
      const { data } = await api.get(`/warehouses/${warehouse.id}/transactions`)
      setDetailModal({ open: true, warehouse, transactions: data || [] })
    } catch (err) {
      console.error(err); toast.error('Failed to load transactions')
    }
  }

  const openTransferModal = async () => {
    setTransferModal({ open: true })
    setTransferForm({ type: 'material', entity_id: '', from_warehouse_id: '', to_warehouse_id: '', quantity: '', notes: '' })
    try {
      const [matRes, vehRes, tolRes] = await Promise.all([
        api.get('/materials?limit=500'), api.get('/vehicles?limit=500'), api.get('/tools?limit=500')
      ])
      setMaterialsList(matRes.data || [])
      setVehiclesList(vehRes.data || [])
      setToolsList(tolRes.data || [])
    } catch (err) { /* ignore */ }
  }

  const loadTransfers = async () => {
    try { const { data } = await api.get('/warehouses/transfers/list'); setTransferList(data || []) } catch (err) { setTransferList([]) }
  }

  useEffect(() => { if (transferList.length === 0) loadTransfers() }, [])

  const handleCreateTransfer = async () => {
    if (!transferForm.from_warehouse_id || !transferForm.to_warehouse_id) return toast.error('From/To warehouse required')
    if (!transferForm.entity_id || !transferForm.quantity) return toast.error('Entity and quantity required')
    try {
      await api.post('/warehouses/transfers', {
        request_type: transferForm.type,
        entity_id: transferForm.entity_id,
        entity_name: transferForm.type === 'material'
          ? materialsList.find(m => m.id === transferForm.entity_id)?.name
          : transferForm.type === 'vehicle'
          ? vehiclesList.find(v => v.id === transferForm.entity_id)?.registration_no
          : toolsList.find(t => t.id === transferForm.entity_id)?.name,
        quantity: parseFloat(transferForm.quantity) || 0,
        from_warehouse_id: transferForm.from_warehouse_id,
        to_warehouse_id: transferForm.to_warehouse_id,
        notes: transferForm.notes
      })
      toast.success('Transfer request created')
      setTransferModal({ open: false }); loadTransfers()
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to create transfer') }
  }

  const handleTransferAction = async (id, action) => {
    try {
      await api.put(`/warehouses/transfers/${id}`, { status: action })
      toast.success(`Transfer ${action}d`)
      loadTransfers()
    } catch (err) { console.error(err); toast.error(`Failed to ${action} transfer`) }
  }

  const getEntityOptions = () => {
    if (transferForm.type === 'material') return materialsList.map(m => ({ value: m.id, label: `${m.name} (SKU: ${m.sku})` }))
    if (transferForm.type === 'vehicle') return vehiclesList.map(v => ({ value: v.id, label: `${v.registration_no} - ${v.brand} ${v.model}` }))
    return toolsList.map(t => ({ value: t.id, label: `${t.name} (${t.serial_no || 'no serial'})` }))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Warehouses</h1>
          <p className="text-xs text-slate-500 mt-0.5">Manage storage locations and transfers</p>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <Button variant="secondary" onClick={openTransferModal}><ArrowRightLeft size={16} /> Transfer Request</Button>
          )}
          {canEdit && (
            <Button onClick={() => setModal({ open: true, item: {} })}><Plus size={16} /> Add Warehouse</Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="max-w-xs">
          <Input placeholder="Search warehouses..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      {loading ? (
        <LoadingSkeleton rows={5} cols={7} />
      ) : warehouses.length === 0 ? (
        <EmptyState icon={Building2} title="No warehouses found" text="No warehouses match your search criteria" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Location</th>
                  <th className="text-left px-4 py-3 font-medium">City</th>
                  <th className="text-left px-4 py-3 font-medium">Project</th>
                  <th className="text-left px-4 py-3 font-medium">Manager</th>
                  {canEdit && <th className="text-left px-4 py-3 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {warehouses.map(w => (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3"><button onClick={() => openDetail(w)} className="font-medium text-blue-600 hover:underline text-left">{w.name}</button></td>
                    <td className="px-4 py-3 text-gray-500">{w.type || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{w.location || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{w.city || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{w.project_name || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{w.manager_name || '-'}</td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => setModal({ open: true, item: w })} className="p-1.5 hover:bg-green-50 rounded text-green-600" title="Edit"><Edit3 size={16} /></button>
                          <button onClick={() => setDeleteConfirm({ open: true, id: w.id })} className="p-1.5 hover:bg-red-50 rounded text-red-600" title="Delete"><Trash2 size={16} /></button>
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
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Transfer Requests</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
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
            <tbody className="divide-y divide-gray-100">
              {transferList.map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 capitalize text-gray-500">{t.entity_type}</td>
                  <td className="px-4 py-3 text-gray-500">{t.entity_name || '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{t.from_warehouse_name || '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{t.to_warehouse_name || '-'}</td>
                  <td className="px-4 py-3">{(parseFloat(t.quantity) || 0).toLocaleString()}</td>
                  <td className="px-4 py-3">{statusBadge(t.status)}</td>
                  <td className="px-4 py-3 text-gray-500">{t.created_at ? new Date(t.created_at).toLocaleDateString() : '-'}</td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {t.status === 'pending' && (
                          <>
                            <Button variant="primary" size="sm" onClick={() => handleTransferAction(t.id, 'approve')}>Approve</Button>
                            <Button variant="destructive" size="sm" onClick={() => handleTransferAction(t.id, 'reject')}>Reject</Button>
                          </>
                        )}
                        {t.status === 'approved' && (
                          <Button variant="secondary" size="sm" onClick={() => handleTransferAction(t.id, 'complete')}>Complete</Button>
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 rounded-lg p-4">
              <div><span className="text-xs text-gray-500 block">Type</span><span className="text-sm font-medium">{detailModal.warehouse.type || '-'}</span></div>
              <div><span className="text-xs text-gray-500 block">Location</span><span className="text-sm font-medium">{detailModal.warehouse.location || '-'}</span></div>
              <div><span className="text-xs text-gray-500 block">City</span><span className="text-sm font-medium">{detailModal.warehouse.city || '-'}</span></div>
              <div><span className="text-xs text-gray-500 block">Manager</span><span className="text-sm font-medium">{detailModal.warehouse.manager_name || '-'}</span></div>
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-800 mb-3">Material Movements</h3>
              {detailModal.transactions.length === 0 ? (
                <p className="text-sm text-gray-400 py-3 text-center">No material transactions for this warehouse</p>
              ) : (
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
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
                    <tbody className="divide-y divide-gray-100">
                      {detailModal.transactions.map(t => (
                        <tr key={t.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-xs text-gray-500">{t.created_at ? new Date(t.created_at).toLocaleString() : '-'}</td>
                          <td className="px-3 py-2 font-medium">{t.material_name || '-'}</td>
                          <td className="px-3 py-2 text-xs text-gray-500 font-mono">{t.sku || '-'}</td>
                          <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full ${t.type === 'in' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{t.type === 'in' ? 'Stock In' : 'Stock Out'}</span></td>
                          <td className="px-3 py-2 font-medium">{(parseFloat(t.quantity) || 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-gray-600">{t.project_name || '-'}</td>
                          <td className="px-3 py-2 text-gray-600">{t.added_by || '-'}</td>
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

      <ConfirmDialog isOpen={deleteConfirm.open} onClose={() => setDeleteConfirm({ open: false, id: null })} onConfirm={handleDelete} message="Delete this warehouse?" />

      <Modal isOpen={transferModal.open} onClose={() => setTransferModal({ open: false })} title="Create Transfer Request" size="max-w-md">
        <div className="space-y-4">
          <Select label="Transfer Type" value={transferForm.type} onChange={e => { setTransferForm({ ...transferForm, type: e.target.value, entity_id: '' }) }}>
            <option value="material">Material</option><option value="vehicle">Vehicle</option><option value="tool">Tool</option>
          </Select>
          <Select label="Entity" value={transferForm.entity_id} onChange={e => setTransferForm({ ...transferForm, entity_id: e.target.value })}>
            <option value="">Select {transferForm.type}</option>
            {getEntityOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select label="From Warehouse" value={transferForm.from_warehouse_id} onChange={e => setTransferForm({ ...transferForm, from_warehouse_id: e.target.value })}>
            <option value="">Select source</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Select label="To Warehouse" value={transferForm.to_warehouse_id} onChange={e => setTransferForm({ ...transferForm, to_warehouse_id: e.target.value })}>
            <option value="">Select destination</option>
            {warehouses.filter(w => w.id !== parseInt(transferForm.from_warehouse_id)).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Input label="Quantity" type="number" step="0.01" value={transferForm.quantity} onChange={e => setTransferForm({ ...transferForm, quantity: e.target.value })} />
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
    project_id: data?.project_id || '', manager_id: data?.manager_id || ''
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name) return toast.error('Warehouse name required')
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input label="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <Select label="Type" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="">Select</option><option value="main">Main</option><option value="site">Site</option><option value="storage">Storage</option><option value="distribution">Distribution</option></Select>
        <Input label="Location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
        <Input label="City" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
        <Select label="Project" value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}><option value="">None</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Select label="Manager" value={form.manager_id} onChange={e => setForm({ ...form, manager_id: e.target.value })}><option value="">None</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}</Select>
      </div>
      <div className="flex gap-3 pt-2">
        <Button type="submit">{form.id ? 'Update' : 'Create'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}