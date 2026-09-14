import { useState, useEffect, useRef, useId } from 'react'
import { X, AlertTriangle, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, Inbox, AlertCircle } from 'lucide-react'

export function useDebouncedValue(value, delay = 400) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

/* ------------------------------------------------------------------ */
/* Page scaffolding                                                    */
/* ------------------------------------------------------------------ */

export function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

export function Table({ headers, children, empty, loading }) {
  if (loading) return <LoadingSkeleton rows={5} cols={headers.length} />
  if (!children || (Array.isArray(children) && children.length === 0)) {
    return empty || <EmptyState icon={Inbox} title="No data" text="No records found" />
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className={h.align === 'right' ? 'text-right' : h.align === 'center' ? 'text-center' : 'text-left'}>{h.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function TableRow({ children, onClick }) {
  return (
    <tr onClick={onClick} className={onClick ? 'cursor-pointer' : ''}>
      {children}
    </tr>
  )
}

export function Td({ children, align = 'left', className = '' }) {
  return (
    <td className={`${align === 'right' ? 'text-right tabular-nums' : align === 'center' ? 'text-center' : 'text-left'} ${className}`}>
      {children}
    </td>
  )
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

export function Card({ children, className = '', onClick }) {
  return (
    <div onClick={onClick} className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${onClick ? 'card-hover cursor-pointer' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  )
}

export function CardContent({ children, className = '' }) {
  return <div className={`p-5 ${className}`}>{children}</div>
}

const STAT_TONES = {
  emerald: { tile: 'bg-emerald-100 text-emerald-700', value: 'text-emerald-800', ring: 'hover:border-emerald-300' },
  green:   { tile: 'bg-emerald-100 text-emerald-700', value: 'text-emerald-800', ring: 'hover:border-emerald-300' },
  blue:    { tile: 'bg-sky-100 text-sky-700',         value: 'text-sky-900',     ring: 'hover:border-sky-300' },
  amber:   { tile: 'bg-amber-100 text-amber-700',     value: 'text-amber-900',   ring: 'hover:border-amber-300' },
  purple:  { tile: 'bg-violet-100 text-violet-700',   value: 'text-violet-900',  ring: 'hover:border-violet-300' },
  red:     { tile: 'bg-red-100 text-red-700',         value: 'text-red-800',     ring: 'hover:border-red-300' },
  teal:    { tile: 'bg-teal-100 text-teal-700',       value: 'text-teal-900',    ring: 'hover:border-teal-300' },
  slate:   { tile: 'bg-slate-100 text-slate-700',     value: 'text-slate-900',   ring: 'hover:border-slate-300' },
}

export function StatCard({ label, value, icon: Icon, color, trend, onClick, hint }) {
  const tone = STAT_TONES[color] || STAT_TONES.slate
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`group min-w-0 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all sm:p-5 ${onClick ? `cursor-pointer ${tone.ring} hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500` : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tone.tile}`}>{Icon && <Icon size={20} />}</div>
        {trend != null && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${trend > 0 ? 'bg-emerald-50 text-emerald-700' : trend < 0 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <div className={`mt-3 break-words text-xl font-semibold tracking-tight tabular-nums sm:text-2xl ${tone.value}`}>{value}</div>
      <div className="mt-1 text-xs font-medium text-slate-500">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </Comp>
  )
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} />
}

export function LoadingSkeleton({ rows = 3, cols = 4 }) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-busy="true" aria-live="polite">
      <div className="flex gap-4">
        {Array.from({ length: cols }).map((_, j) => <Skeleton key={j} className="h-3 flex-1 opacity-60" />)}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => <Skeleton key={j} className="h-4 flex-1" />)}
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon: Icon = Inbox, title, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
        <Icon size={22} />
      </div>
      <h4 className="text-sm font-semibold text-slate-700">{title || 'Nothing here yet'}</h4>
      <p className="mt-1 max-w-xs text-xs text-slate-500">{text || 'Records you add will show up here.'}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Badge({ children, variant = 'default', dot = false }) {
  const variants = {
    default: 'bg-slate-100 text-slate-700 ring-slate-200',
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warning: 'bg-amber-50 text-amber-800 ring-amber-200',
    error: 'bg-red-50 text-red-700 ring-red-200',
    info: 'bg-sky-50 text-sky-700 ring-sky-200',
    purple: 'bg-violet-50 text-violet-700 ring-violet-200',
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  }
  const dots = { default: 'bg-slate-400', success: 'bg-emerald-500', warning: 'bg-amber-500', error: 'bg-red-500', info: 'bg-sky-500', purple: 'bg-violet-500', indigo: 'bg-indigo-500' }
  return (
    <span className={`badge ring-1 ring-inset ${variants[variant] || variants.default}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dots[variant] || dots.default}`} aria-hidden="true" />}
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export function Button({ children, variant = 'primary', size = 'md', className = '', loading = false, disabled, ...props }) {
  const base = 'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,box-shadow,transform] duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 active:translate-y-px'
  const variants = {
    primary: 'bg-amber-500 text-white shadow-sm hover:bg-amber-600 focus-visible:ring-amber-500',
    secondary: 'border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-400 focus-visible:ring-slate-400',
    destructive: 'bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-500',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-400',
    dark: 'bg-slate-900 text-white shadow-sm hover:bg-slate-800 focus-visible:ring-slate-700',
  }
  const sizes = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-11 px-6 text-[15px]' }
  return (
    <button className={`${base} ${variants[variant] || variants.primary} ${sizes[size] || sizes.md} ${className}`} disabled={disabled || loading} {...props}>
      {loading && <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}

const fieldBase = 'block w-full rounded-lg border bg-white px-3.5 text-sm text-slate-900 shadow-[inset_0_1px_1px_rgba(15,23,42,0.03)] transition-colors placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-amber-500/15 focus:border-amber-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'
const fieldOk = 'border-slate-300 hover:border-slate-400'
const fieldBad = 'border-red-400 bg-red-50/40 focus:ring-red-500/15 focus:border-red-500'

function FieldLabel({ id, children, required }) {
  if (!children) return null
  return (
    <label htmlFor={id} className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
      {children}{required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
    </label>
  )
}
function FieldError({ id, error, hint }) {
  if (error) return <p id={id} className="mt-1.5 flex items-center gap-1 text-xs text-red-600"><AlertCircle size={13} aria-hidden="true" />{error}</p>
  if (hint) return <p id={id} className="mt-1.5 text-xs text-slate-500">{hint}</p>
  return null
}

export function Input({ label, error, hint, id, className = '', required, ...props }) {
  const auto = useId()
  const inputId = id || (label ? `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${auto}` : auto)
  const descId = (error || hint) ? `${inputId}-desc` : undefined
  return (
    <div>
      <FieldLabel id={inputId} required={required}>{label}</FieldLabel>
      <input id={inputId} aria-invalid={!!error} aria-describedby={descId} required={required} className={`${fieldBase} h-10 ${error ? fieldBad : fieldOk} ${className}`} {...props} />
      <FieldError id={descId} error={error} hint={hint} />
    </div>
  )
}

export function Select({ label, error, hint, id, children, className = '', required, ...props }) {
  const auto = useId()
  const inputId = id || (label ? `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${auto}` : auto)
  const descId = (error || hint) ? `${inputId}-desc` : undefined
  return (
    <div>
      <FieldLabel id={inputId} required={required}>{label}</FieldLabel>
      <select id={inputId} aria-invalid={!!error} aria-describedby={descId} required={required} className={`${fieldBase} h-10 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-10 ${error ? fieldBad : fieldOk} ${className}`} {...props}>
        {children}
      </select>
      <FieldError id={descId} error={error} hint={hint} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Overlays                                                            */
/* ------------------------------------------------------------------ */

function useDialogBehaviour(isOpen, onClose, panelRef) {
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const previouslyFocused = document.activeElement
    // Focus the first field (or the panel) so keyboard users land inside the dialog
    const t = setTimeout(() => {
      const el = panelRef.current?.querySelector('input:not([type=hidden]),select,textarea,button:not([data-dialog-close])')
      ;(el || panelRef.current)?.focus?.()
    }, 10)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [isOpen, onClose, panelRef])
}

export function Modal({ isOpen, onClose, title, subtitle, children, footer, size = 'max-w-lg' }) {
  const panelRef = useRef(null)
  useDialogBehaviour(isOpen, onClose, panelRef)
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="presentation">
      <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-[2px] animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className={`relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl shadow-slate-900/20 outline-none animate-slide-up sm:max-h-[88vh] sm:rounded-2xl sm:animate-pop ${size}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 id="modal-title" className="text-base font-semibold text-slate-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" data-dialog-close onClick={onClose} aria-label="Close" className="-mr-1.5 -mt-1 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 sm:px-6">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmLabel = 'Delete', variant = 'destructive', loading = false }) {
  const panelRef = useRef(null)
  useDialogBehaviour(isOpen, onClose, panelRef)
  if (!isOpen) return null
  const danger = variant === 'destructive'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-[2px] animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc" tabIndex={-1} className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl shadow-slate-900/20 outline-none animate-pop">
        <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ${danger ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
          <AlertTriangle size={24} />
        </div>
        <h3 id="confirm-title" className="text-center text-lg font-semibold text-slate-900">{title || 'Are you sure?'}</h3>
        <p id="confirm-desc" className="mt-2 text-center text-sm text-slate-500">{message || 'This action cannot be undone.'}</p>
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1" data-dialog-close>Cancel</Button>
          <Button variant={danger ? 'destructive' : 'primary'} onClick={onConfirm} className="flex-1" loading={loading}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export function Pagination({ page, totalPages, onPageChange, showTotal = false, total = 0, pageSize = 50 }) {
  if (!totalPages || totalPages <= 1) return null
  const maxVisible = 5
  let start = Math.max(1, page - Math.floor(maxVisible / 2))
  const end = Math.min(totalPages, start + maxVisible - 1)
  if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1)
  const pages = []
  for (let i = start; i <= end; i++) pages.push(i)

  const Nav = ({ onClick, disabled, label, children }) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
      {children}
    </button>
  )

  return (
    <nav aria-label="Pagination" className="flex flex-col gap-2 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs text-slate-500">
        {showTotal && total > 0
          ? <>Showing <span className="font-medium text-slate-700">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</span> of <span className="font-medium text-slate-700">{total}</span></>
          : <>Page <span className="font-medium text-slate-700">{page}</span> of {totalPages}</>}
      </span>
      <div className="flex items-center gap-0.5">
        <Nav onClick={() => onPageChange(1)} disabled={page === 1} label="First page"><ChevronsLeft size={16} /></Nav>
        <Nav onClick={() => onPageChange(page - 1)} disabled={page === 1} label="Previous page"><ChevronLeft size={16} /></Nav>
        {start > 1 && <><PageBtn n={1} page={page} onPageChange={onPageChange} />{start > 2 && <span className="px-1 text-slate-400">…</span>}</>}
        {pages.map(p => <PageBtn key={p} n={p} page={page} onPageChange={onPageChange} />)}
        {end < totalPages && <>{end < totalPages - 1 && <span className="px-1 text-slate-400">…</span>}<PageBtn n={totalPages} page={page} onPageChange={onPageChange} /></>}
        <Nav onClick={() => onPageChange(page + 1)} disabled={page === totalPages} label="Next page"><ChevronRight size={16} /></Nav>
        <Nav onClick={() => onPageChange(totalPages)} disabled={page === totalPages} label="Last page"><ChevronsRight size={16} /></Nav>
      </div>
    </nav>
  )
}

function PageBtn({ n, page, onPageChange }) {
  const active = n === page
  return (
    <button type="button" onClick={() => onPageChange(n)} aria-current={active ? 'page' : undefined} className={`h-8 min-w-[32px] rounded-md px-2 text-xs font-medium transition-colors ${active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
      {n}
    </button>
  )
}
