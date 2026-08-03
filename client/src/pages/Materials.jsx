import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Modal, ConfirmDialog, Table, Td, Button, Input, Select, LoadingSkeleton, EmptyState, useDebouncedValue } from '../components/ui'
import { Plus, Search, Package, History, ArrowDownToLine, ArrowUpFromLine, Edit3, Trash2, ExternalLink, CircleAlert, Ticket } from 'lucide-react'
import { GatePassDetail } from './GatePass'
import toast from 'react-hot-toast'

export default function Materials() {
  const { user } = useAuth()
  const [materials, setMaterials] = useState([])
  const [categories, setCategories] = useState([])
  const [projects, setProjects] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [modal, setModal] = useState({ open: false, item: null })
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null })
  const [detailModal, setDetailModal] = useState({ open: false, material: null, transactions: [] })
  const [dateFilter, setDateFilter] = useState({ mode: 'all', from: '', to: '' })
  const [stockInModal, setStockInModal] = useState({ open: false, material: null })
  const [stockInQty, setStockInQty] = useState({ quantity: '', warehouse_id: '', notes: '', source: '', received_by: '', date: new Date().toISOString().slice(0, 10), transaction_type: '', po_id: '' })
  const [availablePos, setAvailablePos] = useState([])
  const [stockOutModal, setStockOutModal] = useState({ open: false, material: null })
  const [stockOutForm, setStockOutForm] = useState({ quantity: '', project_id: '', warehouse_id: '', location: '', driver_name: '', vehicle_number: '', notes: '', transaction_type: 'project_issue' })
  const [gpPopup, setGpPopup] = useState({ open: false, gp: null })

  const getDateRange = (mode) => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    const d = now.getDate()
    const day = now.getDay()
    const startOfWeek = new Date(now)
    startOfWeek.setDate(d - (day === 0 ? 6 : day - 1))
    startOfWeek.setHours(0, 0, 0, 0)
    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(startOfWeek.getDate() + 6)
    endOfWeek.setHours(23, 59, 59, 999)
    switch (mode) {
      case 'last-week': { const s = new Date(startOfWeek); s.setDate(s.getDate() - 7); const e = new Date(endOfWeek); e.setDate(e.getDate() - 7); return { from: s.toISOString().slice(0, 10), to: e.toISOString().slice(0, 10) } }
      case 'last-month': { const s = new Date(y, m - 1, 1); const e = new Date(y, m, 0, 23, 59, 59, 999); return { from: s.toISOString().slice(0, 10), to: e.toISOString().slice(0, 10) } }
      case 'current-week': return { from: startOfWeek.toISOString().slice(0, 10), to: endOfWeek.toISOString().slice(0, 10) }
      case 'current-month': { const s = new Date(y, m, 1); const e = new Date(y, m + 1, 0, 23, 59, 59, 999); return { from: s.toISOString().slice(0, 10), to: e.toISOString().slice(0, 10) } }
      default: return null
    }
  }

  const filterByDate = (tx) => {
    if (dateFilter.mode === 'all') return true
    const range = dateFilter.mode === 'custom' ? { from: dateFilter.from, to: dateFilter.to } : getDateRange(dateFilter.mode)
    if (!range || !range.from) return true
    const txDate = new Date(tx.created_at)
    const from = new Date(range.from)
    const to = range.to ? new Date(range.to + 'T23:59:59.999') : new Date(864e13)
    return txDate >= from && txDate <= to
  }

  const canEdit = ['owner', 'admin', 'store_manager', 'manager'].includes(user?.role)

  const load = (q = '') => {
    setLoading(true)
    const params = q ? `?search=${q}` : ''
    Promise.all([api.get(`/materials${params}`), api.get('/materials/categories/list'), api.get('/projects'), api.get('/warehouses')])
      .then(([matRes, catRes, projRes, whRes]) => { setMaterials(matRes.data); setCategories(catRes.data); setProjects(projRes.data); setWarehouses(whRes.data) })
      .catch(err => { console.error(err); toast.error('Failed to load materials') })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(debouncedSearch) }, [debouncedSearch])

  const handleSave = async (form) => {
    try {
      if (form.id) { await api.put(`/materials/${form.id}`, form); toast.success('Material updated') }
      else { await api.post('/materials', form); toast.success('Material created') }
      setModal({ open: false, item: null }); load(search)
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to save') }
  }

  const handleDelete = async () => {
    try { await api.delete(`/materials/${deleteConfirm.id}`); toast.success('Material deleted'); setDeleteConfirm({ open: false, id: null }); load(search) }
    catch (err) { console.error(err); toast.error('Failed to delete') }
  }

  const openDetail = async (material) => {
    try { const { data } = await api.get(`/materials/${material.id}/transactions`); setDetailModal({ open: true, material, transactions: data }) }
    catch (err) { console.error(err); toast.error('Failed to load transactions') }
  }

  const handleStockIn = async () => {
    if (!stockInQty.quantity || parseFloat(stockInQty.quantity) <= 0) return toast.error('Enter valid quantity')
    if (!stockInQty.warehouse_id) return toast.error('Warehouse is required')
    try {
      const payload = {
        quantity: parseFloat(stockInQty.quantity),
        warehouse_id: stockInQty.warehouse_id,
        notes: stockInQty.notes,
        source: stockInQty.source,
        received_by: stockInQty.received_by,
        transaction_type: stockInQty.transaction_type,
        date: stockInQty.date
      }
      if (stockInQty.po_id) payload.po_id = stockInQty.po_id
      await api.post(`/materials/${stockInModal.material.id}/stock-in`, payload)
      toast.success('Stock in recorded')
      setStockInModal({ open: false, material: null })
      setStockInQty({ quantity: '', warehouse_id: '', notes: '', source: '', received_by: '', date: new Date().toISOString().slice(0, 10), transaction_type: '', po_id: '' })
      setAvailablePos([])
      load(search)
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to record stock in') }
  }

  const handleStockOut = async () => {
    const errs = []
    if (!stockOutForm.quantity || parseFloat(stockOutForm.quantity) <= 0) errs.push('Valid quantity required')
    if (!stockOutForm.project_id) errs.push('Project is required')
    if (!stockOutForm.warehouse_id) errs.push('Warehouse is required')
    if (!stockOutForm.location.trim()) errs.push('Location/site is required')
    if (!stockOutForm.driver_name.trim()) errs.push('Driver name is required')
    if (!stockOutForm.vehicle_number.trim()) errs.push('Vehicle number is required')
    if (errs.length) return toast.error(errs.join('. '))
    try {
      const { data } = await api.post(`/materials/${stockOutModal.material.id}/stock-out`, { quantity: parseFloat(stockOutForm.quantity), project_id: stockOutForm.project_id, warehouse_id: stockOutForm.warehouse_id, location: stockOutForm.location.trim(), driver_name: stockOutForm.driver_name.trim(), vehicle_number: stockOutForm.vehicle_number.trim(), notes: stockOutForm.notes, transaction_type: stockOutForm.transaction_type || 'project_issue' })
      toast.success('Stock removed successfully')
      setStockOutModal({ open: false, material: null })
      setStockOutForm({ quantity: '', project_id: '', warehouse_id: '', location: '', driver_name: '', vehicle_number: '', notes: '', transaction_type: 'project_issue' })
      if (data.gate_pass) {
        setGpPopup({ open: true, gp: data.gate_pass })
      } else {
        load(search)
      }
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to record stock out') }
  }

  const stockInTx = detailModal.transactions.filter(t => t.type === 'in' && filterByDate(t))
  const stockOutTx = detailModal.transactions.filter(t => t.type === 'out' && filterByDate(t))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Materials Inventory</h1>
          <p className="text-xs text-slate-500 mt-0.5">Manage stock levels, track movements</p>
        </div>
        {canEdit && (
          <Button onClick={() => setModal({ open: true, item: {} })}>
            <Plus size={16} /> Add Material
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative max-w-xs w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search materials..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
          />
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={6} cols={9} />
      ) : (
        <Table
          headers={[
            { label: 'SKU' }, { label: 'Name' }, { label: 'Category' },
            { label: 'Qty', align: 'right' }, { label: 'Unit' },
            { label: 'Unit Cost', align: 'right' }, { label: 'Total Value', align: 'right' },
            { label: 'Location' }, { label: 'Actions', align: 'center' },
          ]}
          empty={
            <EmptyState icon={Package} title="No materials found" text="Add your first material to start tracking inventory"
              action={canEdit ? <Button onClick={() => setModal({ open: true, item: {} })}><Plus size={16} /> Add Material</Button> : null}
            />
          }
        >
          {materials.map(m => (
            <tr key={m.id} className={`hover:bg-slate-50 transition-colors ${(parseFloat(m.quantity) || 0) <= (parseFloat(m.reorder_level) || 0) ? 'bg-red-50/50' : ''}`}>
              <Td><span className="font-mono text-xs text-slate-500">{m.sku || '-'}</span></Td>
              <Td>
                <button onClick={() => openDetail(m)} className="font-medium text-amber-600 hover:text-amber-700 hover:underline text-left flex items-center gap-1">
                  {m.name} <ExternalLink size={12} />
                </button>
              </Td>
              <Td><span className="text-slate-500">{m.category_name || '-'}</span></Td>
              <Td align="right">
                <span className={`font-semibold ${(parseFloat(m.quantity) || 0) <= (parseFloat(m.reorder_level) || 0) ? 'text-red-600' : 'text-slate-800'}`}>
                  {(parseFloat(m.quantity) || 0).toLocaleString()}
                </span>
                {(parseFloat(m.quantity) || 0) <= (parseFloat(m.reorder_level) || 0) && <CircleAlert size={14} className="inline ml-1 text-red-500" />}
              </Td>
              <Td><span className="text-slate-500">{m.unit || '-'}</span></Td>
              <Td align="right">PKR {(parseFloat(m.unit_cost) || 0).toLocaleString()}</Td>
              <Td align="right" className="font-semibold text-slate-800">PKR {((parseFloat(m.quantity) || 0) * (parseFloat(m.unit_cost) || 0)).toLocaleString()}</Td>
              <Td><span className="text-slate-500">{m.storage_location || '-'}</span></Td>
              <Td align="center">
                <div className="flex items-center justify-center gap-1">
                  {canEdit && (
                    <>
                      <button onClick={() => {
  setStockInModal({ open: true, material: m });
  setStockInQty({ quantity: '', warehouse_id: m.warehouse_id || '', notes: '', source: '', received_by: '', date: new Date().toISOString().slice(0, 10), transaction_type: '', po_id: '' });
  api.get('/purchase-orders').then(({ data }) => setAvailablePos((data || []).filter(p => ['approved', 'partial_received'].includes(p.status)))).catch(() => {});
}} className="p-1.5 hover:bg-emerald-50 rounded text-emerald-600 transition-colors" title="Stock In"><ArrowDownToLine size={15} /></button>
                      <button onClick={() => { setStockOutModal({ open: true, material: m }); setStockOutForm({ quantity: '', project_id: '', warehouse_id: m.warehouse_id || '', location: '', driver_name: '', vehicle_number: '', notes: '', transaction_type: 'project_issue' }) }} className="p-1.5 hover:bg-amber-50 rounded text-amber-600 transition-colors" title="Stock Out"><ArrowUpFromLine size={15} /></button>
                      <button onClick={() => setModal({ open: true, item: m })} className="p-1.5 hover:bg-blue-50 rounded text-blue-600 transition-colors" title="Edit"><Edit3 size={15} /></button>
                      <button onClick={() => setDeleteConfirm({ open: true, id: m.id })} className="p-1.5 hover:bg-red-50 rounded text-red-600 transition-colors" title="Delete"><Trash2 size={15} /></button>
                    </>
                  )}
                  <button onClick={() => openDetail(m)} className="p-1.5 hover:bg-slate-100 rounded text-slate-400 transition-colors" title="History"><History size={15} /></button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <Modal isOpen={modal.open} onClose={() => setModal({ open: false, item: null })} title={modal.item?.id ? 'Edit Material' : 'Add Material'} size="max-w-2xl">
        <MaterialForm data={modal.item} categories={categories} onSave={handleSave} onCancel={() => setModal({ open: false, item: null })} />
      </Modal>
      <ConfirmDialog isOpen={deleteConfirm.open} onClose={() => setDeleteConfirm({ open: false, id: null })} onConfirm={handleDelete} message="Are you sure you want to delete this material?" />

      {/* Detail Modal */}
      <Modal isOpen={detailModal.open} onClose={() => setDetailModal({ open: false, material: null, transactions: [] })} title={detailModal.material?.name || 'Material Details'} size="max-w-5xl">
        {detailModal.material && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 rounded-xl p-5">
              {[
                ['SKU', detailModal.material.sku],
                ['Category', detailModal.material.category_name],
                ['Current Quantity', `${(parseFloat(detailModal.material.quantity) || 0).toLocaleString()} ${detailModal.material.unit}`],
                ['Unit Cost', `PKR ${(parseFloat(detailModal.material.unit_cost) || 0).toLocaleString()}`],
                ['Storage Location', detailModal.material.storage_location],
                ['Warehouse', detailModal.material.warehouse_name],
                ['Supplier', detailModal.material.supplier_name],
                ['Reorder Level', (parseFloat(detailModal.material.reorder_level) || 0).toLocaleString()],
              ].map(([label, value]) => (
                <div key={label}>
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">{label}</span>
                  <span className="text-sm font-semibold text-slate-800">{value || '-'}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Filter:</span>
              {['all', 'last-week', 'last-month', 'current-week', 'current-month', 'custom'].map(mode => (
                <button key={mode} onClick={() => setDateFilter({ mode, from: '', to: '' })}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${dateFilter.mode === mode ? 'bg-amber-500 text-white' : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'}`}>
                  {mode === 'all' ? 'All' : mode === 'last-week' ? 'Last Week' : mode === 'last-month' ? 'Last Month' : mode === 'current-week' ? 'This Week' : mode === 'current-month' ? 'This Month' : 'Custom'}
                </button>
              ))}
              {dateFilter.mode === 'custom' && (
                <div className="flex items-center gap-2">
                  <input type="date" value={dateFilter.from} onChange={e => setDateFilter({ ...dateFilter, from: e.target.value })} className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs" />
                  <span className="text-xs text-slate-400">to</span>
                  <input type="date" value={dateFilter.to} onChange={e => setDateFilter({ ...dateFilter, to: e.target.value })} className="px-2 py-1.5 border border-slate-300 rounded-lg text-xs" />
                </div>
              )}
              <span className="text-xs text-slate-400 ml-auto">{stockInTx.length + stockOutTx.length} records</span>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><ArrowDownToLine size={16} className="text-emerald-500" /> Stock In History</h3>
              {stockInTx.length === 0 ? (
                <EmptyState icon={Package} title="No stock-in records" text="Stock-in transactions will appear here" />
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50"><tr>
                      {['Date', 'Quantity', 'Running Total', 'Warehouse', 'Source', 'Received By', 'Added By', 'Notes'].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {stockInTx.map(t => (
                        <tr key={t.id} className="hover:bg-slate-50"><td className="px-4 py-2.5 text-xs text-slate-500">{t.date ? new Date(t.date).toLocaleString() : '-'}</td><td className="px-4 py-2.5 font-semibold text-emerald-600">+{(parseFloat(t.quantity) || 0).toLocaleString()}</td><td className="px-4 py-2.5 font-medium">{(parseFloat(t.running_total) || 0).toLocaleString()}</td><td className="px-4 py-2.5 text-slate-600">{t.warehouse_name || '-'}</td><td className="px-4 py-2.5 text-slate-600">{t.source ? t.source.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '-'}</td><td className="px-4 py-2.5 text-slate-600">{t.received_by || '-'}</td><td className="px-4 py-2.5 text-slate-600">{t.added_by || '-'}</td><td className="px-4 py-2.5 text-slate-500 max-w-[200px] truncate">{t.notes || '-'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><ArrowUpFromLine size={16} className="text-amber-500" /> Stock Out History</h3>
              {stockOutTx.length === 0 ? (
                <EmptyState icon={Package} title="No stock-out records" text="Stock-out transactions will appear here" />
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50"><tr>
                      {['Date', 'Qty Out', 'Remaining', 'Warehouse', 'Project', 'Location', 'Driver', 'Vehicle', 'Issued By', 'Notes'].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {stockOutTx.map(t => (
                        <tr key={t.id} className="hover:bg-slate-50"><td className="px-4 py-2.5 text-xs text-slate-500">{t.created_at ? new Date(t.created_at).toLocaleString() : '-'}</td><td className="px-4 py-2.5 font-semibold text-amber-600">-{(parseFloat(t.quantity) || 0).toLocaleString()}</td><td className="px-4 py-2.5 font-medium">{(parseFloat(t.running_total) || 0).toLocaleString()}</td><td className="px-4 py-2.5 text-slate-600">{t.warehouse_name || '-'}</td><td className="px-4 py-2.5 text-slate-600">{t.project_name || '-'}</td><td className="px-4 py-2.5 text-slate-600">{t.location || '-'}</td><td className="px-4 py-2.5 text-slate-600">{t.driver_name || '-'}</td><td className="px-4 py-2.5 text-slate-600">{t.vehicle_number || '-'}</td><td className="px-4 py-2.5 text-slate-600">{t.added_by || '-'}</td><td className="px-4 py-2.5 text-slate-500 max-w-[150px] truncate">{t.notes || '-'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={stockInModal.open} onClose={() => { setStockInModal({ open: false, material: null }); setStockInQty({ quantity: '', warehouse_id: '', notes: '', source: '', received_by: '', date: new Date().toISOString().slice(0, 10), transaction_type: '', po_id: '' }); setAvailablePos([]) }} title={`Stock In: ${stockInModal.material?.name}`} size="max-w-sm">
        <div className="space-y-5">
          <div className="bg-emerald-50 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
            <Package size={16} className="text-emerald-600" />
            <span className="text-emerald-800">Current: <strong>{parseFloat(stockInModal.material?.quantity || 0).toLocaleString()} {stockInModal.material?.unit}</strong></span>
          </div>
          <Input label="Quantity *" type="number" step="0.01" value={stockInQty.quantity} onChange={e => setStockInQty({ ...stockInQty, quantity: e.target.value })} placeholder="Enter quantity" />
          <Select label="Warehouse / Location *" value={stockInQty.warehouse_id} onChange={e => setStockInQty({ ...stockInQty, warehouse_id: e.target.value })}>
            <option value="">Select warehouse</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}{w.location ? ` - ${w.location}` : ''}</option>)}
          </Select>
          <Select label="Linked PO (optional)" value={stockInQty.po_id} onChange={e => setStockInQty({ ...stockInQty, po_id: e.target.value })}>
            <option value="">No PO link</option>
            {availablePos.filter(p => p.status === 'approved' || p.status === 'partial_received').map(p => (
              <option key={p.id} value={p.id}>{p.po_number} - {p.vendor_name} (PKR {(parseFloat(p.total_amount) || 0).toLocaleString()})</option>
            ))}
          </Select>
          <Select label="Source *" value={stockInQty.source} onChange={e => setStockInQty({ ...stockInQty, source: e.target.value })}>
            <option value="">Select source</option>
            <option value="supplier">Supplier</option>
            <option value="purchase_order">Purchase Order</option>
            <option value="return">Return</option>
            <option value="transfer">Transfer</option>
            <option value="other">Other</option>
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Received By" value={stockInQty.received_by} onChange={e => setStockInQty({ ...stockInQty, received_by: e.target.value })} placeholder="Person name" />
            <Input label="Date" type="date" value={stockInQty.date} onChange={e => setStockInQty({ ...stockInQty, date: e.target.value })} />
          </div>
          <Input label="Notes" value={stockInQty.notes} onChange={e => setStockInQty({ ...stockInQty, notes: e.target.value })} placeholder="Optional notes" />
          <Button onClick={handleStockIn} className="w-full"><ArrowDownToLine size={16} /> Add to Stock</Button>
        </div>
      </Modal>

      <Modal isOpen={stockOutModal.open} onClose={() => { setStockOutModal({ open: false, material: null }); setStockOutForm({ quantity: '', project_id: '', warehouse_id: '', location: '', driver_name: '', vehicle_number: '', notes: '', transaction_type: 'project_issue' }) }} title={`Stock Out: ${stockOutModal.material?.name}`} size="max-w-md">
        <div className="space-y-5">
          <div className="bg-amber-50 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
            <Package size={16} className="text-amber-600" />
            <span className="text-amber-800">Current: <strong>{parseFloat(stockOutModal.material?.quantity || 0).toLocaleString()} {stockOutModal.material?.unit}</strong></span>
          </div>
          <Input label="Quantity *" type="number" step="0.01" value={stockOutForm.quantity} onChange={e => setStockOutForm({ ...stockOutForm, quantity: e.target.value })} placeholder="Enter quantity" />
          <Select label="From Warehouse *" value={stockOutForm.warehouse_id} onChange={e => setStockOutForm({ ...stockOutForm, warehouse_id: e.target.value })}>
            <option value="">Select warehouse</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}{w.location ? ` - ${w.location}` : ''}</option>)}
          </Select>
          <Select label="Project *" value={stockOutForm.project_id} onChange={e => setStockOutForm({ ...stockOutForm, project_id: e.target.value })}>
            <option value="">Select project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.location ? ` - ${p.location}` : ''}</option>)}
          </Select>
          <Input label="Destination Location / Site *" value={stockOutForm.location} onChange={e => setStockOutForm({ ...stockOutForm, location: e.target.value })} placeholder="e.g., Site A, Main Store" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Driver Name *" value={stockOutForm.driver_name} onChange={e => setStockOutForm({ ...stockOutForm, driver_name: e.target.value })} placeholder="Driver name" />
            <Input label="Vehicle Number *" value={stockOutForm.vehicle_number} onChange={e => setStockOutForm({ ...stockOutForm, vehicle_number: e.target.value })} placeholder="e.g., LEH-1234" />
          </div>
          <Input label="Notes" value={stockOutForm.notes} onChange={e => setStockOutForm({ ...stockOutForm, notes: e.target.value })} placeholder="Optional notes" />
          <Button onClick={handleStockOut} className="w-full"><ArrowUpFromLine size={16} /> Remove from Stock</Button>
        </div>
      </Modal>

      <Modal isOpen={gpPopup.open} onClose={() => { setGpPopup({ open: false, gp: null }); load(search) }}
        title={`Gate Pass Generated: ${gpPopup.gp?.gate_pass_no}`} size="max-w-2xl">
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
            <Ticket size={16} className="text-amber-600 shrink-0" />
            <span className="text-amber-800">Gate pass <strong>{gpPopup.gp?.gate_pass_no}</strong> auto-generated for this stock-out transaction.</span>
          </div>
          <GatePassDetail gp={gpPopup.gp}
            onPrint={() => {
              const win = window.open('', '_blank')
              const g = gpPopup.gp
              const dateStr = g?.created_at ? new Date(g.created_at).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' }) : ''
              win.document.write(gatePassPrintHtml(g, dateStr))
              win.document.close()
              win.print()
            }}
            onPdf={async () => {
              try {
                const { data: blob } = await api.get(`/gatepass/${gpPopup.gp.id}/pdf`, { responseType: 'blob' })
                const url = window.URL.createObjectURL(new Blob([blob]))
                const a = document.createElement('a'); a.href = url; a.download = `GatePass_${gpPopup.gp.gate_pass_no}.pdf`; a.click()
                window.URL.revokeObjectURL(url)
                toast.success('PDF exported')
              } catch (err) { console.error(err); toast.error('PDF export not available') }
            }}
          />
        </div>
      </Modal>
    </div>
  )
}

function gatePassPrintHtml(gp, dateStr) {
  return `<!DOCTYPE html><html><head><title>Gate Pass ${gp?.gate_pass_no}</title>
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
      @media print { body { padding: 0; } }
    </style></head><body><div class="page">
    <div class="letterhead">
      <h1>AL-FAJAR CONSTRUCTION</h1>
      <div class="sub">Engineering &amp; Contracting Division</div>
      <div class="address">Plot # 12, Sector G-11, Islamabad - Pakistan &bull; Tel: +92-51-1234567 &bull; info@alfajar.com</div>
    </div>
    <div class="title-block"><h2>GATE PASS</h2></div>
    <div class="gp-no"># ${gp?.gate_pass_no || ''}</div>
    <table class="details">
      <tr><td>Date</td><td>${dateStr}</td></tr>
      <tr><td>Material</td><td>${gp?.material_name || ''}</td></tr>
      <tr><td>Quantity</td><td>${gp?.quantity || ''} ${gp?.unit || ''}</td></tr>
      <tr><td>Project</td><td>${gp?.project_name || ''}</td></tr>
      <tr><td>Vehicle Number</td><td>${gp?.vehicle_number || ''}</td></tr>
      <tr><td>Driver Name</td><td>${gp?.driver_name || ''}</td></tr>
      <tr><td>Destination</td><td>${gp?.destination || ''}</td></tr>
      <tr><td>Issued By</td><td>${gp?.issued_by || ''}</td></tr>
      <tr><td>Authorized By</td><td>${gp?.authorized_by || ''}</td></tr>
      <tr><td>Notes</td><td>${gp?.notes || ''}</td></tr>
    </table>
    <div class="signatures">
      <div class="sig"><div class="line">Issued By Signature</div></div>
      <div class="sig"><div class="line">Authorized Signature</div></div>
      <div class="sig"><div class="line">Security Officer</div></div>
    </div>
    <div class="footer-note">This is a computer-generated document. No signature required for verification.</div>
  </div></body></html>`
}

function MaterialForm({ data, categories, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: data?.id || null, sku: data?.sku || '', name: data?.name || '', description: data?.description || '',
    category_id: data?.category_id || '', unit: data?.unit || '', quantity: data?.quantity || 0,
    reorder_level: data?.reorder_level || 0, unit_cost: data?.unit_cost || 0, storage_location: data?.storage_location || '',
  })
  const [errors, setErrors] = useState({})

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.sku) errs.sku = 'SKU is required'
    if (!form.name) errs.name = 'Name is required'
    if (!form.unit) errs.unit = 'Unit is required'
    if (Object.keys(errs).length) return setErrors(errs)
    setErrors({})
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <Input label="SKU *" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} error={errors.sku} />
        <Input label="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} error={errors.name} />
        <Select label="Category" value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}>
          <option value="">Select category</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input label="Unit *" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="bags, tonnes, pcs" error={errors.unit} />
        <Input label="Quantity" type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
        <Input label="Reorder Level" type="number" value={form.reorder_level} onChange={e => setForm({ ...form, reorder_level: e.target.value })} />
        <Input label="Unit Cost (PKR)" type="number" value={form.unit_cost} onChange={e => setForm({ ...form, unit_cost: e.target.value })} />
        <Input label="Storage Location" value={form.storage_location} onChange={e => setForm({ ...form, storage_location: e.target.value })} />
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
