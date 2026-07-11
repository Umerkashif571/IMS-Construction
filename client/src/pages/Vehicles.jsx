import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Modal, ConfirmDialog, Table, Td, Button, Input, Select, LoadingSkeleton, EmptyState, Badge } from '../components/ui'
import { Plus, Search, Truck, Edit3, Trash2, Fuel, Wrench, ChevronRight, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'

const statusBadge = (s) => {
  const map = { active: 'success', under_maintenance: 'warning', idle: 'default', retired: 'error' }
  return <Badge variant={map[s] || 'default'}>{s?.replace(/_/g, ' ') || 'Unknown'}</Badge>
}

export default function Vehicles() {
  const { user } = useAuth()
  const [vehicles, setVehicles] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState({ open: false, item: null })
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null })
  const [fuelModal, setFuelModal] = useState({ open: false, vehicle: null })
  const [maintenanceModal, setMaintenanceModal] = useState({ open: false, vehicle: null })
  const [fuelForm, setFuelForm] = useState({ liters: '', cost: '', notes: '' })
  const [maintForm, setMaintForm] = useState({ type: '', description: '', cost: '', date: '' })
  const [expanded, setExpanded] = useState(null)
  const [fuelLogs, setFuelLogs] = useState([])
  const [maintLogs, setMaintLogs] = useState([])

  const canEdit = ['owner', 'admin', 'store_manager', 'manager'].includes(user?.role)

  const load = (q = '') => {
    setLoading(true)
    const params = q ? `?search=${q}` : ''
    Promise.all([api.get(`/vehicles${params}`), api.get('/projects')])
      .then(([vRes, pRes]) => { setVehicles(vRes.data); setProjects(pRes.data || []) })
      .catch(() => toast.error('Failed to load vehicles'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleSave = async (form) => {
    try {
      if (form.id) { await api.put(`/vehicles/${form.id}`, form); toast.success('Vehicle updated') }
      else { await api.post('/vehicles', form); toast.success('Vehicle created') }
      setModal({ open: false, item: null }); load(search)
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save') }
  }

  const handleDelete = async () => {
    try { await api.delete(`/vehicles/${deleteConfirm.id}`); toast.success('Vehicle deleted'); setDeleteConfirm({ open: false, id: null }); load(search) }
    catch (err) { toast.error('Failed to delete') }
  }

  const handleFuelSubmit = async () => {
    if (!fuelForm.liters || !fuelForm.cost) return toast.error('Liters and cost required')
    try {
      await api.post(`/vehicles/${fuelModal.vehicle.id}/fuel`, { liters: parseFloat(fuelForm.liters) || 0, cost: parseFloat(fuelForm.cost) || 0, notes: fuelForm.notes })
      toast.success('Fuel log added'); setFuelModal({ open: false, vehicle: null }); setFuelForm({ liters: '', cost: '', notes: '' })
      if (expanded === fuelModal.vehicle.id) loadFuelLogs(fuelModal.vehicle.id)
    } catch (err) { toast.error('Failed to add fuel log') }
  }

  const handleMaintSubmit = async () => {
    if (!maintForm.type || !maintForm.cost) return toast.error('Type and cost required')
    try {
      await api.post(`/vehicles/${maintenanceModal.vehicle.id}/maintenance`, { maintenance_type: maintForm.type, description: maintForm.description, cost: parseFloat(maintForm.cost) || 0, scheduled_date: maintForm.date || null })
      toast.success('Maintenance log added'); setMaintenanceModal({ open: false, vehicle: null }); setMaintForm({ type: '', description: '', cost: '', date: '' })
      if (expanded === maintenanceModal.vehicle.id) loadMaintLogs(maintenanceModal.vehicle.id)
    } catch (err) { toast.error('Failed to add maintenance log') }
  }

  const loadFuelLogs = async (id) => { try { const { data } = await api.get(`/vehicles/${id}/fuel`); setFuelLogs(data) } catch (e) { setFuelLogs([]) } }
  const loadMaintLogs = async (id) => { try { const { data } = await api.get(`/vehicles/${id}/maintenance`); setMaintLogs(data) } catch (e) { setMaintLogs([]) } }

  const toggleExpand = (id) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id); loadFuelLogs(id); loadMaintLogs(id)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Vehicles</h1>
          <p className="text-xs text-slate-500 mt-0.5">Manage fleet, fuel logs, and maintenance</p>
        </div>
        {canEdit && <Button onClick={() => setModal({ open: true, item: {} })}><Plus size={16} /> Add Vehicle</Button>}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative max-w-xs w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search vehicles..." value={search} onChange={e => { setSearch(e.target.value); load(e.target.value) }}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500" />
        </div>
      </div>

      {loading ? <LoadingSkeleton rows={6} cols={8} /> : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="w-10 px-2" />
                {['Registration No', 'Type', 'Brand/Model', 'Status', 'Project', 'Insurance Exp', 'Maint Due'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
                {canEdit && <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehicles.map(v => (
                <Fragment key={v.id}>
                  <tr className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => toggleExpand(v.id)}>
                    <td className="px-2 py-3 text-slate-400">{expanded === v.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{v.registration_no}</td>
                    <td className="px-4 py-3 text-slate-500">{v.type}</td>
                    <td className="px-4 py-3">{v.brand} {v.model}</td>
                    <td className="px-4 py-3">{statusBadge(v.current_status)}</td>
                    <td className="px-4 py-3 text-slate-500">{v.project_name || '-'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{v.insurance_expiry ? new Date(v.insurance_expiry).toLocaleDateString() : '-'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{v.next_maintenance ? new Date(v.next_maintenance).toLocaleDateString() : '-'}</td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={(e) => { e.stopPropagation(); setModal({ open: true, item: v }) }} className="p-1.5 hover:bg-blue-50 rounded text-blue-600 transition-colors" title="Edit"><Edit3 size={15} /></button>
                          <button onClick={(e) => { e.stopPropagation(); setFuelModal({ open: true, vehicle: v }) }} className="p-1.5 hover:bg-emerald-50 rounded text-emerald-600 transition-colors" title="Add Fuel"><Fuel size={15} /></button>
                          <button onClick={(e) => { e.stopPropagation(); setMaintenanceModal({ open: true, vehicle: v }) }} className="p-1.5 hover:bg-amber-50 rounded text-amber-600 transition-colors" title="Add Maintenance"><Wrench size={15} /></button>
                          <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ open: true, id: v.id }) }} className="p-1.5 hover:bg-red-50 rounded text-red-600 transition-colors" title="Delete"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                  {expanded === v.id && (
                    <tr key={`exp-${v.id}`}>
                      <td colSpan={canEdit ? 9 : 8} className="bg-slate-50 px-6 py-4">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div>
                            <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Fuel size={15} className="text-emerald-500" /> Fuel Log</h4>
                            {fuelLogs.length === 0 ? <p className="text-xs text-slate-400">No fuel logs</p> : (
                              <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
                                <table className="w-full text-xs">
                                  <thead className="bg-slate-50"><tr>{['Date', 'Liters', 'Cost'].map(h => <th key={h} className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wider">{h}</th>)}</tr></thead>
                                  <tbody className="divide-y divide-slate-100">{fuelLogs.map(f => (
                                    <tr key={f.id} className="hover:bg-slate-50"><td className="px-3 py-2 text-slate-500">{f.created_at ? new Date(f.created_at).toLocaleDateString() : '-'}</td><td className="font-medium">{(parseFloat(f.liters) || 0).toFixed(1)}</td><td>PKR {(parseFloat(f.total_cost || f.cost) || 0).toLocaleString()}</td></tr>
                                  ))}</tbody>
                                </table>
                              </div>
                            )}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Wrench size={15} className="text-amber-500" /> Maintenance Log</h4>
                            {maintLogs.length === 0 ? <p className="text-xs text-slate-400">No maintenance logs</p> : (
                              <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
                                <table className="w-full text-xs">
                                  <thead className="bg-slate-50"><tr>{['Date', 'Type', 'Cost'].map(h => <th key={h} className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wider">{h}</th>)}</tr></thead>
                                  <tbody className="divide-y divide-slate-100">{maintLogs.map(m => (
                                    <tr key={m.id} className="hover:bg-slate-50"><td className="px-3 py-2 text-slate-500">{m.scheduled_date ? new Date(m.scheduled_date).toLocaleDateString() : '-'}</td><td className="capitalize">{m.maintenance_type?.replace(/_/g, ' ')}</td><td>PKR {(parseFloat(m.cost) || 0).toLocaleString()}</td></tr>
                                  ))}</tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {vehicles.length === 0 && <EmptyState icon={Truck} title="No vehicles found" text={canEdit ? 'Add your first vehicle' : 'No vehicles registered'} action={canEdit ? <Button onClick={() => setModal({ open: true, item: {} })}><Plus size={16} /> Add Vehicle</Button> : null} />}
        </div>
      )}

      <Modal isOpen={modal.open} onClose={() => setModal({ open: false, item: null })} title={modal.item?.id ? 'Edit Vehicle' : 'Add Vehicle'} size="max-w-2xl">
        <VehicleForm data={modal.item} projects={projects} onSave={handleSave} onCancel={() => setModal({ open: false, item: null })} />
      </Modal>
      <ConfirmDialog isOpen={deleteConfirm.open} onClose={() => setDeleteConfirm({ open: false, id: null })} onConfirm={handleDelete} message="Delete this vehicle?" />

      <Modal isOpen={fuelModal.open} onClose={() => { setFuelModal({ open: false, vehicle: null }); setFuelForm({ liters: '', cost: '', notes: '' }) }} title={`Fuel Log: ${fuelModal.vehicle?.registration_no}`} size="max-w-sm">
        <div className="space-y-5">
          <Input label="Liters *" type="number" step="0.01" value={fuelForm.liters} onChange={e => setFuelForm({ ...fuelForm, liters: e.target.value })} placeholder="0.00" />
          <Input label="Cost (PKR) *" type="number" step="0.01" value={fuelForm.cost} onChange={e => setFuelForm({ ...fuelForm, cost: e.target.value })} placeholder="0.00" />
          <Input label="Notes" value={fuelForm.notes} onChange={e => setFuelForm({ ...fuelForm, notes: e.target.value })} placeholder="Optional notes" />
          <Button onClick={handleFuelSubmit} className="w-full"><Fuel size={16} /> Add Fuel Log</Button>
        </div>
      </Modal>

      <Modal isOpen={maintenanceModal.open} onClose={() => { setMaintenanceModal({ open: false, vehicle: null }); setMaintForm({ type: '', description: '', cost: '', date: '' }) }} title={`Maintenance: ${maintenanceModal.vehicle?.registration_no}`} size="max-w-sm">
        <div className="space-y-5">
          <Select label="Type *" value={maintForm.type} onChange={e => setMaintForm({ ...maintForm, type: e.target.value })}>
            <option value="">Select type</option>
            <option value="oil_change">Oil Change</option><option value="tire">Tire</option><option value="brake">Brake</option>
            <option value="engine">Engine</option><option value="general">General</option><option value="other">Other</option>
          </Select>
          <Input label="Description" value={maintForm.description} onChange={e => setMaintForm({ ...maintForm, description: e.target.value })} placeholder="Description" />
          <Input label="Cost (PKR) *" type="number" step="0.01" value={maintForm.cost} onChange={e => setMaintForm({ ...maintForm, cost: e.target.value })} placeholder="0.00" />
          <Input label="Date" type="date" value={maintForm.date} onChange={e => setMaintForm({ ...maintForm, date: e.target.value })} />
          <Button onClick={handleMaintSubmit} className="w-full"><Wrench size={16} /> Add Maintenance Log</Button>
        </div>
      </Modal>
    </div>
  )
}

function VehicleForm({ data, projects, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: data?.id || null, registration_no: data?.registration_no || '', type: data?.type || '',
    brand: data?.brand || '', model: data?.model || '', year: data?.year || '', purchase_date: data?.purchase_date || '',
    purchase_cost: data?.purchase_cost || 0, fuel_type: data?.fuel_type || '', tank_capacity: data?.tank_capacity || 0,
    insurance_expiry: data?.insurance_expiry || '', registration_expiry: data?.registration_expiry || '',
    assigned_project_id: data?.assigned_project_id || '', notes: data?.notes || '', current_status: data?.current_status || ''
  })
  const [errors, setErrors] = useState({})

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.registration_no) errs.registration_no = 'Required'
    if (!form.type) errs.type = 'Required'
    if (!form.brand) errs.brand = 'Required'
    if (!form.model) errs.model = 'Required'
    if (Object.keys(errs).length) return setErrors(errs)
    setErrors({})
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <Input label="Registration No *" value={form.registration_no} onChange={e => setForm({ ...form, registration_no: e.target.value })} error={errors.registration_no} />
        <Select label="Type *" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} error={errors.type}>
          <option value="">Select</option><option value="truck">Truck</option><option value="pickup">Pickup</option><option value="suv">SUV</option>
          <option value="sedan">Sedan</option><option value="van">Van</option><option value="motorcycle">Motorcycle</option><option value="other">Other</option>
        </Select>
        <Input label="Brand *" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} error={errors.brand} />
        <Input label="Model *" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} error={errors.model} />
        <Input label="Year" type="number" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} />
        <Select label="Status" value={form.current_status} onChange={e => setForm({ ...form, current_status: e.target.value })}>
          <option value="active">Active</option><option value="under_maintenance">Under Maintenance</option><option value="idle">Idle</option><option value="retired">Retired</option>
        </Select>
        <Select label="Fuel Type" value={form.fuel_type} onChange={e => setForm({ ...form, fuel_type: e.target.value })}>
          <option value="">Select</option><option value="petrol">Petrol</option><option value="diesel">Diesel</option><option value="cng">CNG</option><option value="electric">Electric</option><option value="hybrid">Hybrid</option>
        </Select>
        <Input label="Tank Capacity (L)" type="number" step="0.1" value={form.tank_capacity} onChange={e => setForm({ ...form, tank_capacity: e.target.value })} />
        <Input label="Purchase Date" type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} />
        <Input label="Purchase Cost (PKR)" type="number" value={form.purchase_cost} onChange={e => setForm({ ...form, purchase_cost: e.target.value })} />
        <Input label="Insurance Expiry" type="date" value={form.insurance_expiry} onChange={e => setForm({ ...form, insurance_expiry: e.target.value })} />
        <Input label="Registration Expiry" type="date" value={form.registration_expiry} onChange={e => setForm({ ...form, registration_expiry: e.target.value })} />
        <Select label="Assigned Project" value={form.assigned_project_id} onChange={e => setForm({ ...form, assigned_project_id: e.target.value })}>
          <option value="">None</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Notes</label>
        <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500" />
      </div>
      <div className="flex gap-3 pt-2">
        <Button type="submit">{form.id ? 'Update' : 'Create'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

function Fragment({ children }) { return children }
