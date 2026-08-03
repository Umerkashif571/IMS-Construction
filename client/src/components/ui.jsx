import { useState, useEffect } from 'react'
import { X, AlertTriangle } from 'lucide-react'

export function useDebouncedValue(value, delay = 400) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export function Table({ headers, children, empty, loading }) {
  if (loading) return <LoadingSkeleton rows={5} cols={headers.length} />
  if (!children || (Array.isArray(children) && children.length === 0)) {
    return empty || <EmptyState icon={AlertTriangle} title="No data" text="No records found" />
  }
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {headers.map((h, i) => (
              <th key={i} className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider ${
                h.align === 'right' ? 'text-right' : h.align === 'center' ? 'text-center' : 'text-left'
              }`}>{h.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {children}
        </tbody>
      </table>
    </div>
  )
}

export function TableRow({ children, onClick }) {
  return (
    <tr onClick={onClick} className={`${onClick ? 'cursor-pointer' : ''} hover:bg-slate-50 transition-colors`}>
      {children}
    </tr>
  )
}

export function Td({ children, align = 'left', className = '' }) {
  return (
    <td className={`px-4 py-3 text-sm text-slate-700 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${className}`}>
      {children}
    </td>
  )
}

export function Card({ children, className = '', onClick }) {
  return (
    <div onClick={onClick} className={`bg-white rounded-xl border border-slate-200 shadow-sm ${onClick ? 'card-hover cursor-pointer' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function CardHeader({ title, action }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  )
}

export function CardContent({ children, className = '' }) {
  return <div className={`p-5 ${className}`}>{children}</div>
}

export function StatCard({ label, value, icon: Icon, color, trend, to, onClick }) {
  const colorMap = {
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    amber: 'bg-amber-50 text-amber-600 border-amber-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  }
  const bgColor = colorMap[color] || colorMap.slate
  return (
    <div onClick={onClick} className={`rounded-xl border p-5 ${bgColor} card-hover ${onClick ? 'cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-lg">{Icon && <Icon size={22} />}</span>
        {trend && <span className={`text-xs font-semibold ${trend > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{trend > 0 ? '+' : ''}{trend}%</span>}
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-xs mt-1 font-medium opacity-70">{label}</div>
    </div>
  )
}

export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} />
}

export function LoadingSkeleton({ rows = 3, cols = 4 }) {
  return (
    <div className="border border-slate-200 rounded-xl bg-white p-4 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {Icon && <Icon size={40} className="text-slate-300 mb-3" />}
      <h4 className="text-sm font-semibold text-slate-500 mb-1">{title || 'No data'}</h4>
      <p className="text-xs text-slate-400 max-w-xs">{text || 'Nothing to show yet'}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Badge({ children, variant = 'default' }) {
  const variants = {
    default: 'bg-slate-100 text-slate-700',
    success: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-amber-100 text-amber-700',
    error: 'bg-red-100 text-red-700',
    info: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
    indigo: 'bg-indigo-100 text-indigo-700',
  }
  return <span className={`badge ${variants[variant] || variants.default}`}>{children}</span>
}

export function Button({ children, variant = 'primary', size = 'md', className = '', ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2'
  const variants = {
    primary: 'bg-amber-500 text-white hover:bg-amber-600 focus:ring-amber-500 shadow-sm',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-slate-400',
    destructive: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm',
    ghost: 'text-slate-600 hover:bg-slate-100 focus:ring-slate-400',
  }
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-2.5 text-base',
  }
  return (
    <button className={`${base} ${variants[variant] || variants.primary} ${sizes[size] || sizes.md} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function Input({ label, error, id, className = '', ...props }) {
  const inputId = id || (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : undefined)
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={inputId} className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">{label}</label>}
      <input id={inputId} className={`w-full px-3.5 py-2.5 text-sm border rounded-lg bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 ${
        error ? 'border-red-300 bg-red-50' : 'border-slate-300 hover:border-slate-400'
      } ${className}`} {...props} />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

export function Select({ label, error, id, children, className = '', ...props }) {
  const inputId = id || (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : undefined)
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={inputId} className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">{label}</label>}
      <select id={inputId} className={`w-full px-3.5 py-2.5 text-sm border rounded-lg bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 ${
        error ? 'border-red-300 bg-red-50' : 'border-slate-300 hover:border-slate-400'
      } ${className}`} {...props}>{children}</select>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

export function Modal({ isOpen, onClose, title, children, size = 'max-w-lg' }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${size} max-h-[90vh] overflow-y-auto animate-in`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

export function ConfirmDialog({ isOpen, onClose, onConfirm, title, message }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <AlertTriangle size={24} className="text-red-600" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">{title || 'Confirm Delete'}</h3>
          <p className="text-sm text-slate-500 mb-6">{message || 'This action cannot be undone.'}</p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
            <Button variant="destructive" onClick={onConfirm} className="flex-1">Delete</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
