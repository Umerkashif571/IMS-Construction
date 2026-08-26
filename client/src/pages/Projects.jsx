import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Modal, ConfirmDialog, Button, Input, Select, LoadingSkeleton, EmptyState, Badge, useDebouncedValue } from '../components/ui'
import ProjectFinance from '../components/ProjectFinance'
import { Plus, Search, Building2, Edit3, Trash2, ExternalLink, Package, Construction } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatPKR } from '../format'

const statusBadge = (s) => {
  const map = { planning: 'info', active: 'success', on_hold: 'warning', completed: 'default', cancelled: 'error' }
  return <Badge variant={map[s] || 'default'}>{s?.replace(/_/g, ' ') || 'Unknown'}</Badge>
}

const safeArray = (data) => Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);

export default function Projects() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [modal, setModal] = useState({ open: false, item: null })
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null })
  const [allocModal, setAllocModal] = useState({ open: false, project: null })
  const [allocData, setAllocData] = useState({ materials: [], vehicles: [], tools: [] })
  const [detailModal, setDetailModal] = useState({ open: false, project: null, materials: [] })
  const [detailTab, setDetailTab] = useState('overview')

  const canEdit = ['owner', 'admin', 'store_manager', 'manager'].includes(user?.role)
  const canAssignManagers = ['owner', 'admin'].includes(user?.role)
  const [projectManagers, setProjectManagers] = useState([])
  const [managerUsers, setManagerUsers] = useState([])
  const [assignTarget, setAssignTarget] = useState('')

  const loadManagers = (projectId) => {
    if (!projectId || !canAssignManagers) return
    api.get(`/projects/${projectId}/managers`).then(({ data }) => setProjectManagers(data?.data || data || [])).catch(() => setProjectManagers([]))
    api.get('/users', { params: { role: 'manager' } }).then(({ data }) => setManagerUsers((data?.data || data || []).filter(u => u.role === 'manager'))).catch(() => setManagerUsers([]))
  }

  const assignManager = async () => {
    if (!assignTarget) return toast.error('Select a manager first')
    try {
      await api.put(`/projects/${detailModal.project.id}/managers/${assignTarget}`)
      toast.success('Manager assigned to project')
      setAssignTarget('')
      loadManagers(detailModal.project.id)
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to assign manager') }
  }

  const removeManager = async (userId) => {
    try {
      await api.delete(`/projects/${detailModal.project.id}/managers/${userId}`)
      toast.success('Manager removed')
      loadManagers(detailModal.project.id)
    } catch (err) { console.error(err); toast.error('Failed to remove manager') }
  }

  const load = (q = '') => {
    setLoading(true)
    const params = q ? `?search=${q}` : ''
    api.get(`/projects${params}`).then(({ data }) => setProjects(data?.data || data || [])).catch(err => { console.error(err); toast.error('Failed to load projects') }).finally(() => setLoading(false))
  }

  useEffect(() => { load(debouncedSearch) }, [debouncedSearch])

  const handleSave = async (form) => {
    try {
      if (form.id) { await api.put(`/projects/${form.id}`, form); toast.success('Project updated') }
      else { await api.post('/projects', form); toast.success('Project created') }
      setModal({ open: false, item: null }); load(search)
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to save') }
  }

  const handleDelete = async () => {
    try { await api.delete(`/projects/${deleteConfirm.id}`); toast.success('Project deleted'); setDeleteConfirm({ open: false, id: null }); load(search) } catch (err) { console.error(err); toast.error('Failed to delete') }
  }

  const openDetail = async (project) => {
    setDetailTab('overview')
    try {
      const [projRes, matCostRes] = await Promise.all([api.get(`/projects/${project.id}`), api.get(`/projects/${project.id}/material-cost`)])
      setDetailModal({ open: true, project: projRes.data, materials: matCostRes.data })
      loadManagers(project.id)
    } catch (err) { console.error(err); toast.error('Failed to load project details') }
  }

  // Deep link: /projects?project=<id>&tab=finance opens the detail modal on the finance tab
  const [searchParams] = useSearchParams()
  const projectParam = searchParams.get('project')
  const tabParam = searchParams.get('tab')
  useEffect(() => {
    if (!projectParam) return
    const targetTab = tabParam === 'finance' ? 'finance' : 'overview'
    setDetailTab(targetTab)
    Promise.all([api.get(`/projects/${projectParam}`), api.get(`/projects/${projectParam}/material-cost`)])
      .then(([projRes, matCostRes]) => setDetailModal({ open: true, project: projRes.data, materials: matCostRes.data }))
      .catch(err => { console.error(err); toast.error('Failed to load project from notification') })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectParam])

  const viewAllocations = async (project) => {
    setAllocModal({ open: true, project })
    try {
      const [mat, veh, tol] = await Promise.all([api.get(`/projects/${project.id}/materials`), api.get(`/projects/${project.id}/vehicles`), api.get(`/projects/${project.id}/tools`)])
      setAllocData({ materials: mat.data || [], vehicles: veh.data || [], tools: tol.data || [] })
    } catch (err) { console.error(err); toast.error('Failed to load allocations'); setAllocData({ materials: [], vehicles: [], tools: [] }) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Projects</h1>
          <p className="text-xs text-slate-500 mt-0.5">Track construction projects and resource allocation</p>
        </div>
        {canEdit && <Button onClick={() => setModal({ open: true, item: {} })}><Plus size={16} /> Add Project</Button>}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative max-w-xs w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500" />
        </div>
      </div>

      {loading ? <LoadingSkeleton rows={5} cols={8} /> : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[880px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Name', 'Client', 'Location', 'Material Invested', 'Status', 'Start Date', 'End Date', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {safeArray(projects).map(p => (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3"><button onClick={() => openDetail(p)} className="font-medium text-amber-600 hover:text-amber-700 hover:underline text-left flex items-center gap-1">{p.name} <ExternalLink size={12} /></button></td>
                  <td className="px-4 py-3 text-slate-500">{p.client || '-'}</td>
                  <td className="px-4 py-3 text-slate-500">{[p.location, p.city].filter(Boolean).join(', ') || '-'}</td>
                  <td className="px-4 py-3 font-semibold text-emerald-600">{formatPKR(p.total_material_cost)}</td>
                  <td className="px-4 py-3">{statusBadge(p.status)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{p.start_date ? new Date(p.start_date).toLocaleDateString() : '-'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{p.end_date ? new Date(p.end_date).toLocaleDateString() : '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => openDetail(p)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600 transition-colors" title="Details"><ExternalLink size={15} /></button>
                      <button onClick={() => viewAllocations(p)} className="p-1.5 hover:bg-purple-50 rounded text-purple-600 transition-colors" title="Allocations"><Package size={15} /></button>
                      {canEdit && (
                        <>
                          <button onClick={() => setModal({ open: true, item: p })} className="p-1.5 hover:bg-blue-50 rounded text-blue-600 transition-colors" title="Edit"><Edit3 size={15} /></button>
                          <button onClick={() => setDeleteConfirm({ open: true, id: p.id })} className="p-1.5 hover:bg-red-50 rounded text-red-600 transition-colors" title="Delete"><Trash2 size={15} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {safeArray(projects).length === 0 && <EmptyState icon={Building2} title="No projects found" text={canEdit ? 'Create your first project' : 'No projects to display'} action={canEdit ? <Button onClick={() => setModal({ open: true, item: {} })}><Plus size={16} /> Add Project</Button> : null} />}
        </div>
      )}

      <Modal isOpen={modal.open} onClose={() => setModal({ open: false, item: null })} title={modal.item?.id ? 'Edit Project' : 'Add Project'} size="max-w-lg">
        <ProjectForm data={modal.item} onSave={handleSave} onCancel={() => setModal({ open: false, item: null })} />
      </Modal>
      <ConfirmDialog isOpen={deleteConfirm.open} onClose={() => setDeleteConfirm({ open: false, id: null })} onConfirm={handleDelete} message="Delete this project?" />

      <Modal isOpen={detailModal.open} onClose={() => setDetailModal({ open: false, project: null, materials: [] })} title={detailModal.project?.name || 'Project Details'} size="max-w-4xl">
        {detailModal.project && (
          <div className="space-y-6">
            <div className="flex gap-2 border-b border-slate-100 pb-3">
              {[
                { key: 'overview', label: 'Overview' },
                { key: 'finance', label: 'Finance' },
                { key: 'supply_chain', label: 'Supply Chain Management' },
              ].map(t => (
                <button key={t.key} onClick={() => setDetailTab(t.key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${detailTab === t.key ? 'bg-amber-500 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {detailTab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 rounded-xl p-5">
                  {[
                    ['Client', detailModal.project.client], ['Location', [detailModal.project.location, detailModal.project.city].filter(Boolean).join(', ')], ['Status', statusBadge(detailModal.project.status)], ['Total Material Invested', <span className="text-lg font-bold text-emerald-600">{formatPKR(detailModal.project.total_material_cost)}</span>],
                  ].map(([label, value]) => (
                    <div key={label}><span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">{label}</span><span className="text-sm font-semibold text-slate-800">{value || '-'}</span></div>
                  ))}
                </div>
                {canAssignManagers && (
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h3 className="text-sm font-bold text-slate-700 mb-3">Assigned Managers</h3>
                    <p className="text-[11px] text-slate-500 mb-3">Managers can only view finance data (including the Petty Cash breakdown) for projects they are assigned to.</p>
                    {projectManagers.length === 0 ? (
                      <p className="text-xs text-slate-400 mb-3">No managers assigned yet</p>
                    ) : (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {projectManagers.map(m => (
                          <span key={m.id} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1 text-xs">
                            {m.full_name || m.email}
                            <button onClick={() => removeManager(m.id)} className="text-red-500 hover:text-red-700" title="Remove">×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Select value={assignTarget} onChange={e => setAssignTarget(e.target.value)}>
                          <option value="">Select manager...</option>
                          {managerUsers.filter(u => !projectManagers.some(m => m.id === u.id)).map(u => (
                            <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                          ))}
                        </Select>
                      </div>
                      <Button size="sm" variant="secondary" onClick={assignManager}><Plus size={14} /> Assign</Button>
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-bold text-slate-700 mb-3">Material Cost Breakdown</h3>
                  {detailModal.materials.length === 0 ? (
                    <EmptyState icon={Package} title="No materials issued" text="Materials issued to this project will appear here" />
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50"><tr>
                          {['Material', 'SKU', 'Qty Used', 'Unit', 'Unit Cost', 'Total Cost'].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>)}
                        </tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {detailModal.materials.map(m => (
                            <tr key={m.material_id} className="hover:bg-slate-50">
                              <td className="px-4 py-2.5 font-medium">{m.material_name}</td>
                              <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{m.sku || '-'}</td>
                              <td className="px-4 py-2.5">{(parseFloat(m.total_quantity) || 0).toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-slate-500">{m.unit || '-'}</td>
                              <td className="px-4 py-2.5">{formatPKR(m.unit_cost)}</td>
                              <td className="px-4 py-2.5 font-semibold">{formatPKR(m.total_cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                          <tr><td colSpan={5} className="px-4 py-2.5 text-right text-slate-700">Total:</td><td className="px-4 py-2.5 text-emerald-600 font-bold">{formatPKR(detailModal.materials.reduce((s, m) => s + (parseFloat(m.total_cost) || 0), 0))}</td></tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {detailTab === 'finance' && (
              <ProjectFinance projectId={detailModal.project.id} projectName={detailModal.project.name} />
            )}

            {detailTab === 'supply_chain' && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Construction size={48} className="text-slate-300 mb-4" />
                <h3 className="text-base font-bold text-slate-700 mb-1">Supply Chain Management</h3>
                <p className="text-sm text-slate-400">Coming Soon</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal isOpen={allocModal.open} onClose={() => { setAllocModal({ open: false, project: null }); setAllocData({ materials: [], vehicles: [], tools: [] }) }} title={`Allocations: ${allocModal.project?.name}`} size="max-w-2xl">
        <div className="space-y-6">
          {[
            { title: 'Materials Issued', data: allocData.materials, cols: ['Material', 'Qty', 'Unit', 'Date', 'Driver', 'Vehicle'], render: (m) => [m.material_name || m.name, (parseFloat(m.quantity) || 0).toLocaleString(), m.unit, m.created_at ? new Date(m.created_at).toLocaleDateString() : '-', m.driver_name || '-', m.vehicle_number || '-'] },
            { title: 'Vehicles', data: allocData.vehicles, cols: ['Registration', 'Brand/Model', 'Type'], render: (v) => [v.registration_no, `${v.brand} ${v.model}`, v.type] },
            { title: 'Tools', data: allocData.tools, cols: ['Tool', 'Serial', 'Status'], render: (t) => [t.name, t.serial_no || '-', t.current_status || t.status] },
          ].map(section => (
            <div key={section.title}>
              <h4 className="text-sm font-bold text-slate-700 mb-3">{section.title}</h4>
              {section.data.length === 0 ? <p className="text-xs text-slate-400">None</p> : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50"><tr>{section.cols.map(h => <th key={h} className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wider">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">{section.data.map((item, i) => (
                      <tr key={item.id || i} className="hover:bg-slate-50">{section.render(item).map((val, j) => <td key={j} className="px-3 py-2 text-slate-600">{val || '-'}</td>)}</tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}

function ProjectForm({ data, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: data?.id || null, name: data?.name || '', client: data?.client || '',
    location: data?.location || '', city: data?.city || '',
    start_date: data?.start_date || '', end_date: data?.end_date || '',
    status: data?.status || 'planning', description: data?.description || '',
    project_cost_value: data?.project_cost_value || '',
  })
  const [errors, setErrors] = useState({})

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name) return setErrors({ name: 'Name is required' })
    setErrors({})
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <Input label="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} error={errors.name} />
        <Input label="Client" value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} />
        <Input label="Location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
        <Input label="City" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
        <Select label="Status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
          <option value="planning">Planning</option><option value="active">Active</option><option value="on_hold">On Hold</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
        </Select>
        <Input label="Project Cost Value (PKR)" type="number" min="0" step="0.01" value={form.project_cost_value} onChange={e => setForm({ ...form, project_cost_value: e.target.value })} />
        <Input label="Start Date" type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
        <Input label="End Date" type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Description</label>
        <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500" />
      </div>
      <div className="flex gap-3 pt-2">
        <Button type="submit">{form.id ? 'Update' : 'Create'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
