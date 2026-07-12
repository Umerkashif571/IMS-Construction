import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Button, LoadingSkeleton, EmptyState } from '../components/ui'
import { BarChart3, Building2, Truck, Wrench, Settings, Package, Printer, FileSpreadsheet, FileText } from 'lucide-react'
import toast from 'react-hot-toast'

const reportTypes = [
  { key: 'stock-valuation', label: 'Stock Valuation', icon: BarChart3, color: 'border-blue-200 bg-blue-50' },
  { key: 'project-usage', label: 'Project Material Usage', icon: Building2, color: 'border-green-200 bg-green-50' },
  { key: 'vehicle-utilization', label: 'Vehicle Utilization', icon: Truck, color: 'border-yellow-200 bg-yellow-50' },
  { key: 'tool-checkout', label: 'Tool Checkout History', icon: Wrench, color: 'border-purple-200 bg-purple-50' },
  { key: 'maintenance-due', label: 'Maintenance Due', icon: Settings, color: 'border-orange-200 bg-orange-50' },
  { key: 'vendor-purchases', label: 'Vendor Purchases', icon: Package, color: 'border-teal-200 bg-teal-50' },
]

const exportUrl = (key, fmt) => `/api/reports/${key}?format=${fmt === 'xlsx' ? 'excel' : fmt}`

const tableConfig = {
  'stock-valuation': { cols: ['SKU', 'Name', 'Category', 'Qty', 'Unit', 'Unit Cost', 'Total Value'], keys: ['sku', 'name', 'category_name', 'quantity', 'unit', 'unit_cost', 'total_value'] },
  'project-usage': { cols: ['Project', 'Item', 'Qty', 'Unit', 'Unit Cost', 'Total Cost', 'Location', 'Driver', 'Vehicle', 'Date', 'Issued By'], keys: ['project', 'entity_name', 'quantity', 'unit', 'unit_cost', 'total_cost', 'location', 'driver_name', 'vehicle_number', 'created_at', 'allocated_by'] },
  'vehicle-utilization': { cols: ['Reg No', 'Type', 'Brand', 'Status', 'Project', 'Last Maint', 'Next Maint', 'Total Fuel'], keys: ['registration_no', 'type', 'brand', 'current_status', 'project', 'last_maintenance_date', 'next_maintenance_date', 'total_fuel_used'] },
  'tool-checkout': { cols: ['Tool Name', 'Checked Out To', 'Employee', 'Check Out', 'Due Date', 'Returned'], keys: ['tool_name', 'checked_out_to', 'employee_name', 'check_out_date', 'expected_return_date', 'actual_return_date'] },
  'maintenance-due': { cols: ['Item', 'Type', 'Next Maint', 'Insurance Exp', 'Reg Exp'], keys: ['item_name', 'item_type', 'next_due_date', 'insurance_expiry', 'registration_expiry'] },
  'vendor-purchases': { cols: ['PO #', 'Vendor', 'Order Date', 'Total Amount', 'Status', 'Delivery'], keys: ['po_number', 'vendor', 'order_date', 'total_amount', 'status', 'delivery_status'] },
}

const printStyleId = 'ims-print-styles'

export default function Reports() {
  const [activeReport, setActiveReport] = useState(null)
  const [data, setData] = useState([])
  const [loadingReport, setLoadingReport] = useState(false)

  useEffect(() => {
    if (!document.getElementById(printStyleId)) {
      const style = document.createElement('style')
      style.id = printStyleId
      style.textContent = `@media print {
        @page { margin: 15mm; size: landscape; }
        body * { visibility: hidden; }
        .print-area, .print-area * { visibility: visible; }
        .print-area { position: absolute; left: 0; top: 0; width: 100%; }
        .print-area table { border-collapse: collapse; width: 100%; font-size: 10pt; }
        .print-area th { background: #f3f4f6 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; font-weight: 600; }
        .print-area td { border: 1px solid #d1d5db; padding: 4px 8px; }
        .print-area h2 { font-size: 14pt; margin-bottom: 8px; }
        .no-print { display: none !important; }
      }`
      document.head.appendChild(style)
    }
  }, [])

  const handlePrint = () => window.print()

  const loadReport = async (key) => {
    setActiveReport(key)
    setLoadingReport(true)
    try {
      const { data: result } = await api.get(`/reports/${key}`)
      setData(result || [])
    } catch (err) {
      console.error(err); toast.error('Failed to load report')
      setData([])
    } finally {
      setLoadingReport(false)
    }
  }

  const cfg = activeReport ? tableConfig[activeReport] : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Reports</h1>
          <p className="text-xs text-slate-500 mt-0.5">View and export system reports</p>
        </div>
      </div>

      {/* Report Type Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {reportTypes.map(r => (
          <div
            key={r.key}
            onClick={() => loadReport(r.key)}
            className={`rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md ${r.color} ${activeReport === r.key ? 'ring-2 ring-blue-500' : ''}`}
          >
            <div className="flex items-start justify-between">
              <r.icon size={24} className="text-slate-600" />
            </div>
            <h3 className="font-semibold text-gray-800 mt-2">{r.label}</h3>
            <p className="text-xs text-gray-500 mt-1">View report data and export</p>
          </div>
        ))}
      </div>

      {/* Report Table */}
      {activeReport && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800">{reportTypes.find(r => r.key === activeReport)?.label}</h3>
            <div className="flex gap-2 no-print">
              <Button variant="secondary" size="sm" onClick={handlePrint}><Printer size={14} /> Print</Button>
              <a href={exportUrl(activeReport, 'xlsx')} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm"><FileSpreadsheet size={14} /> Excel</Button>
              </a>
              <a href={exportUrl(activeReport, 'pdf')} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm"><FileText size={14} /> PDF</Button>
              </a>
            </div>
          </div>
          {loadingReport ? (
            <div className="no-print"><LoadingSkeleton rows={5} cols={cfg.keys.length} /></div>
          ) : (
            <div className="print-area">
              <h2 className="hidden print:block text-lg font-bold mb-2">{reportTypes.find(r => r.key === activeReport)?.label}</h2>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    {cfg.cols.map(h => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      {cfg.keys.map(k => (
                        <td key={k} className="px-4 py-3 text-gray-600">
                          {k === 'total_value' || k === 'total_amount' || k === 'unit_cost' || k === 'total_cost' || k === 'fuel_cost' || k === 'maintenance_cost'
                            ? `PKR ${parseFloat(row[k] || 0).toLocaleString()}`
                            : k === 'created_at' || k === 'due_date' || k === 'checked_out_date' || k === 'returned_date' || k === 'next_due_date' || k === 'last_maintenance_date' || k === 'next_maintenance_date' || k === 'insurance_expiry' || k === 'registration_expiry' || k === 'order_date'
                            ? row[k] ? new Date(row[k]).toLocaleDateString() : '-'
                            : row[k] ?? '-'
                          }
                        </td>
                      ))}
                    </tr>
                  ))}
                  {data.length === 0 && (
                    <tr><td colSpan={cfg.keys.length} className="text-center py-10"><EmptyState icon={BarChart3} title="No data" text="No data available for this report" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}