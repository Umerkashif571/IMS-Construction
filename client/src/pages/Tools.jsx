import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Modal, ConfirmDialog, Table, Td, Button, Input, Select, LoadingSkeleton, EmptyState, Badge, useDebouncedValue } from '../components/ui'
import { Plus, Search, Wrench, Edit3, Trash2, ArrowUpFromLine, ArrowDownToLine, History, CircleAlert } from 'lucide-react'
import toast from 'react-hot-toast'

const conditionBadge = (c) => {
  const map = { new: 'success', good: 'success', fair: 'warning', poor: 'error', damaged: 'error' }
  return <Badge variant={map[c] || 'default'}>{c?.replace(/_/g, ' ') || 'Unknown'}</Badge>
}

const statusBadge = (s) => {
  const map = { available: 'success', checked_out: 'warning', under_maintenance: 'error', retired: 'default' }
  return <Badge variant={map[s] || 'default'}>{s?.replace(/_/g, ' ') || 'Unknown'}</Badge>
}

export default function Tools() {
  const { user } = useAuth()
  const [tools, setTools] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [modal, setModal] = useState({ open: false, item: null })
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null })
  const [checkoutModal, setCheckoutModal] = useState({ open: false, tool: null })
  const [checkoutForm, setCheckoutForm] = useState({ checked_out_to: '', employee_name: '', assigned_project_id: '', expected_return_date: '', notes: '' })
  const [checkinModal, setCheckinModal] = useState({ open: false, tool: null, checkoutRecord: null })
  const [checkinForm, setCheckinForm] = useState({ condition_on_return: 'good', notes: '', returned_by: '' })
  const [historyModal, setHistoryModal] = useState({ open: false, tool: null, history: [] })

  const canManage = ['owner', 'admin', 'store_manager', 'site_engineer', 'manager'].includes(user?.role)

  const load = (q = '') => {
    setLoading(true)
    const params = q ? `?search=${q}` : ''
    Promise.all([api.get(`/tools${params}`), api.get('/warehouses')])
      .then(([tRes, wRes]) => { setTools(tRes.data); setWarehouses(wRes.data) })
      .catch(err => { console.error(err); toast.error('Failed to load tools') })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(debouncedSearch) }, [debouncedSearch])

  // Deep link: /tools?tool=<id> highlights and scrolls to the tool row
  const [searchParams] = useSearchParams()
  const toolParam = searchParams.get('tool')
  const [highlightedTool, setHighlightedTool] = useState(null)
  useEffect(() => {
    if (!toolParam) return
    setHighlightedTool(toolParam)
    const t = setTimeout(() => {
      const row = document.querySelector(`[data-tool-id="${toolParam}"]`)
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 600)
    const clear = setTimeout(() => setHighlightedTool(null), 4000)
    return () => { clearTimeout(t); clearTimeout(clear) }
  }, [toolParam, tools])

  const handleSave = async (form) => {
    try {
      if (form.id) { await api.put(`/tools/${form.id}`, form); toast.success('Tool updated') }
      else { await api.post('/tools', form); toast.success('Tool created') }
      setModal({ open: false, item: null }); load(search)
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to save') }
  }

  const handleDelete = async () => {
    try { await api.delete(`/tools/${deleteConfirm.id}`); toast.success('Tool deleted'); setDeleteConfirm({ open: false, id: null }); load(search) }
    catch (err) { console.error(err); toast.error('Failed to delete') }
  }

  const handleCheckout = async () => {
    if (!checkoutForm.checked_out_to) return toast.error('Assign to is required')
    try {
      await api.post(`/tools/${checkoutModal.tool.id}/checkout`, checkoutForm)
      toast.success('Tool checked out')
      setCheckoutModal({ open: false, tool: null })
      setCheckoutForm({ checked_out_to: '', employee_name: '', assigned_project_id: '', expected_return_date: '', notes: '' })
      load(search)
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Checkout failed') }
  }

  const openCheckin = async (tool) => {
    try {
      const { data } = await api.get(`/tools/${tool.id}/checkout-history`)
      const record = data.find(r => !r.actual_return_date) || null
      setCheckinModal({ open: true, tool, checkoutRecord: record })
      setCheckinForm({ condition_on_return: 'good', notes: '', returned_by: '' })
    } catch (err) {
      console.error(err); toast.error('Failed to load checkout info')
    }
  }

  const handleCheckin = async () => {
    if (!checkinForm.returned_by) return toast.error('Returned by is required')
    try {
      await api.post(`/tools/${checkinModal.tool.id}/checkin`, checkinForm)
      toast.success('Tool checked in')
      setCheckinModal({ open: false, tool: null, checkoutRecord: null })
      setCheckinForm({ condition_on_return: 'good', notes: '', returned_by: '' })
      load(search)
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Checkin failed') }
  }

  const openHistory = async (tool) => {
    try { const { data } = await api.get(`/tools/${tool.id}/checkout-history`); setHistoryModal({ open: true, tool, history: data }) }
    catch (err) { console.error(err); toast.error('Failed to load history') }
  }

  const isMaintDue = (t) => t.next_maintenance_date && new Date(t.next_maintenance_date) <= new Date()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Tools & Equipment</h1>
          <p className="text-xs text-slate-500 mt-0.5">Track tool inventory, checkouts, and maintenance</p>
        </div>
        {canManage && <Button onClick={() => setModal({ open: true, item: {} })}><Plus size={16} /> Add Tool</Button>}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative max-w-xs w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search tools..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500" />
        </div>
      </div>

      {loading ? <LoadingSkeleton rows={6} cols={8} /> : (
        <Table
          headers={[
            { label: 'Name' }, { label: 'Serial No' }, { label: 'Category' },
            { label: 'Condition' }, { label: 'Status' },
            { label: 'Checked Out To' }, { label: 'Return Due' }, { label: 'Next Maint' },
            { label: 'Actions', align: 'center' },
          ]}
          empty={<EmptyState icon={Wrench} title="No tools found" text="Add your first tool to start tracking"
            action={canManage ? <Button onClick={() => setModal({ open: true, item: {} })}><Plus size={16} /> Add Tool</Button> : null} />}
        >
          {tools.map(t => (
            <tr key={t.id} data-tool-id={t.id} className={`transition-colors ${isMaintDue(t) ? 'bg-amber-50/50' : 'hover:bg-slate-50'} ${highlightedTool === t.id ? 'bg-amber-100/70 ring-2 ring-amber-400' : ''}`}>
              <Td>
                <span className="font-medium text-slate-800">{t.name}</span>
                {isMaintDue(t) && <CircleAlert size={14} className="inline ml-1.5 text-amber-500" title="Maintenance Due" />}
              </Td>
              <Td><span className="font-mono text-xs text-slate-500">{t.serial_number || '-'}</span></Td>
              <Td><span className="text-slate-500">{t.category || '-'}</span></Td>
              <Td>{conditionBadge(t.current_condition)}</Td>
              <Td>{statusBadge(t.current_status)}</Td>
              <Td><span className="text-slate-500">{t.checked_out_to || '-'}</span></Td>
              <Td className="text-xs text-slate-500">{t.return_due_date ? new Date(t.return_due_date).toLocaleDateString() : '-'}</Td>
              <Td className="text-xs text-slate-500">{t.next_maintenance_date ? new Date(t.next_maintenance_date).toLocaleDateString() : '-'}</Td>
              <Td align="center">
                <div className="flex items-center justify-center gap-1">
                  {canManage && t.current_status === 'available' && (
                    <button onClick={() => { setCheckoutModal({ open: true, tool: t }); setCheckoutForm({ checked_out_to: '', employee_name: '', assigned_project_id: '', expected_return_date: '', notes: '' }) }}
                      className="p-1.5 hover:bg-blue-50 rounded text-blue-600 transition-colors" title="Checkout"><ArrowUpFromLine size={15} /></button>
                  )}
                  {canManage && t.current_status === 'checked_out' && (
                    <button onClick={() => openCheckin(t)}
                      className="p-1.5 hover:bg-emerald-50 rounded text-emerald-600 transition-colors" title="Checkin"><ArrowDownToLine size={15} /></button>
                  )}
                  {canManage && (
                    <>
                      <button onClick={() => setModal({ open: true, item: t })} className="p-1.5 hover:bg-blue-50 rounded text-blue-600 transition-colors" title="Edit"><Edit3 size={15} /></button>
                      <button onClick={() => setDeleteConfirm({ open: true, id: t.id })} className="p-1.5 hover:bg-red-50 rounded text-red-600 transition-colors" title="Delete"><Trash2 size={15} /></button>
                    </>
                  )}
                  <button onClick={() => openHistory(t)} className="p-1.5 hover:bg-slate-100 rounded text-slate-400 transition-colors" title="History"><History size={15} /></button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <Modal isOpen={modal.open} onClose={() => setModal({ open: false, item: null })} title={modal.item?.id ? 'Edit Tool' : 'Add Tool'} size="max-w-2xl">
        <ToolForm data={modal.item} onSave={handleSave} onCancel={() => setModal({ open: false, item: null })} />
      </Modal>
      <ConfirmDialog isOpen={deleteConfirm.open} onClose={() => setDeleteConfirm({ open: false, id: null })} onConfirm={handleDelete} message="Are you sure you want to delete this tool?" />

      <Modal isOpen={checkoutModal.open} onClose={() => { setCheckoutModal({ open: false, tool: null }); setCheckoutForm({ checked_out_to: '', employee_name: '', assigned_project_id: '', expected_return_date: '', notes: '' }) }} title={`Checkout: ${checkoutModal.tool?.name}`} size="max-w-sm">
        <div className="space-y-5">
          <div className="bg-blue-50 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
            <Wrench size={16} className="text-blue-600" />
            <span className="text-blue-800">Status: <strong>{checkoutModal.tool?.current_status}</strong></span>
          </div>
          <Input label="Assigned To *" value={checkoutForm.checked_out_to} onChange={e => setCheckoutForm({ ...checkoutForm, checked_out_to: e.target.value })} placeholder="Person name" />
          <Input label="Employee Name" value={checkoutForm.employee_name} onChange={e => setCheckoutForm({ ...checkoutForm, employee_name: e.target.value })} placeholder="Optional" />
          <Input label="Expected Return" type="date" value={checkoutForm.expected_return_date} onChange={e => setCheckoutForm({ ...checkoutForm, expected_return_date: e.target.value })} />
          <Input label="Notes" value={checkoutForm.notes} onChange={e => setCheckoutForm({ ...checkoutForm, notes: e.target.value })} placeholder="Optional notes" />
          <Button onClick={handleCheckout} className="w-full"><ArrowUpFromLine size={16} /> Checkout</Button>
        </div>
      </Modal>

      <Modal isOpen={checkinModal.open} onClose={() => { setCheckinModal({ open: false, tool: null, checkoutRecord: null }); setCheckinForm({ condition_on_return: 'good', notes: '', returned_by: '' }) }} title={`Checkin: ${checkinModal.tool?.name}`} size="max-w-sm">
        <div className="space-y-5">
          <div className="bg-emerald-50 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
            <Wrench size={16} className="text-emerald-600" />
            <span className="text-emerald-800">Returning: <strong>{checkinModal.tool?.name}</strong></span>
          </div>
          <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm space-y-1">
            <div className="text-slate-600">Checked Out To: <strong className="text-slate-800">{checkinModal.tool?.checked_out_to || '-'}</strong></div>
            <div className="text-slate-600">Checkout Date: <strong className="text-slate-800">{checkinModal.checkoutRecord?.check_out_date ? new Date(checkinModal.checkoutRecord.check_out_date).toLocaleDateString() : '-'}</strong></div>
          </div>
          <Input label="Returned By *" value={checkinForm.returned_by} onChange={e => setCheckinForm({ ...checkinForm, returned_by: e.target.value })} placeholder="Person returning the tool" />
          <Select label="Condition on Return" value={checkinForm.condition_on_return} onChange={e => setCheckinForm({ ...checkinForm, condition_on_return: e.target.value })}>
            <option value="new">New</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="damaged">Damaged</option>
          </Select>
          <Input label="Notes" value={checkinForm.notes} onChange={e => setCheckinForm({ ...checkinForm, notes: e.target.value })} placeholder="Return condition notes" />
          <Button onClick={handleCheckin} className="w-full"><ArrowDownToLine size={16} /> Check in</Button>
        </div>
      </Modal>

      <Modal isOpen={historyModal.open} onClose={() => setHistoryModal({ open: false, tool: null, history: [] })} title={`Checkout History: ${historyModal.tool?.name}`} size="max-w-4xl">
        {historyModal.history.length === 0 ? (
          <EmptyState icon={History} title="No history" text="No checkout records for this tool" />
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr>
                {['Checked Out To', 'Employee', 'Project', 'Expected Return', 'Actual Return', 'Condition Returned', 'Notes'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {historyModal.history.map(h => (
                  <tr key={h.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-sm font-medium">{h.checked_out_to || '-'}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600">{h.employee_name || '-'}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600">{h.assigned_project_id || '-'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{h.expected_return_date ? new Date(h.expected_return_date).toLocaleDateString() : '-'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{h.actual_return_date ? new Date(h.actual_return_date).toLocaleDateString() : '-'}</td>
                    <td className="px-4 py-2.5">{h.condition_on_return ? conditionBadge(h.condition_on_return) : '-'}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-500 max-w-[200px] truncate">{h.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  )
}

function ToolForm({ data, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: data?.id || null, name: data?.name || '', serial_number: data?.serial_number || '',
    type: data?.type || '', category: data?.category || '',
    current_condition: data?.current_condition || 'good', current_status: data?.current_status || 'available',
    purchase_cost: data?.purchase_cost || 0, purchase_date: data?.purchase_date || '',
    notes: data?.notes || '', next_maintenance_date: data?.next_maintenance_date || '',
    warehouse_id: data?.warehouse_id || '', storage_location: data?.storage_location || ''
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
        <Input label="Serial No" value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} />
        <Input label="Type" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} placeholder="e.g., power_tool, hand_tool" />
        <Input label="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
        <Select label="Condition" value={form.current_condition} onChange={e => setForm({ ...form, current_condition: e.target.value })}>
          <option value="new">New</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="damaged">Damaged</option>
        </Select>
        <Select label="Status" value={form.current_status} onChange={e => setForm({ ...form, current_status: e.target.value })}>
          <option value="available">Available</option><option value="checked_out">Checked Out</option><option value="under_maintenance">Under Maintenance</option><option value="retired">Retired</option>
        </Select>
        <Input label="Purchase Cost" type="number" value={form.purchase_cost} onChange={e => setForm({ ...form, purchase_cost: e.target.value })} />
        <Input label="Purchase Date" type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} />
        <Input label="Next Maintenance" type="date" value={form.next_maintenance_date} onChange={e => setForm({ ...form, next_maintenance_date: e.target.value })} />
        <Input label="Storage Location" value={form.storage_location} onChange={e => setForm({ ...form, storage_location: e.target.value })} />
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
