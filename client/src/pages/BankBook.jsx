import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Modal, Button, Input, Badge, LoadingSkeleton, EmptyState, Card, CardHeader, CardContent, StatCard } from '../components/ui'
import { Plus, Landmark, ArrowDownLeft, ArrowUpRight, Trash2, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatPKR } from '../format'
import { d, add, toNumber } from '../utils/decimal'

const safeArray = (data) => Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' }) : '-')

const SOURCE_LABELS = {
  vendor_payment: 'Vendor Payment',
  salary: 'Salary',
  petty_cash: 'Petty Cash',
  amount_received: 'Amount Received',
}

const txStatusBadge = (s) => {
  const map = { active: 'success', deletion_requested: 'warning', deleted: 'error' }
  return <Badge variant={map[s] || 'default'}>{s?.replace(/_/g, ' ') || 'Unknown'}</Badge>
}

export default function BankBook() {
  const [banks, setBanks] = useState([])
  const [selected, setSelected] = useState(null)
  const [ledger, setLedger] = useState([])
  const [ledgerBank, setLedgerBank] = useState(null)
  const [loading, setLoading] = useState(true)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [addBankOpen, setAddBankOpen] = useState(false)
  const [txOpen, setTxOpen] = useState(false)
  const [delTarget, setDelTarget] = useState(null)
  const [delReason, setDelReason] = useState('')

  const load = (keepSelection = true) => {
    setLoading(true)
    api.get('/banks').then(({ data }) => {
      const banksData = data?.data || data || [];
      setBanks(banksData);
      if (selected && keepSelection) {
        const still = banksData.find(b => b.id === selected)
        if (!still) setSelected(null)
      }
    }).catch(err => { console.error(err); toast.error('Failed to load banks') }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const loadLedger = () => {
    if (!selected) { setLedger([]); setLedgerBank(null); return }
    setLedgerLoading(true)
    api.get(`/banks/${selected}/transactions`).then(({ data }) => {
      // API returns { bank: {...}, transactions: [...] }
      const ledgerData = Array.isArray(data?.transactions) ? data.transactions : 
                         (Array.isArray(data?.data?.transactions) ? data.data.transactions : []);
      const bankData = data?.bank || data?.data?.bank;
      setLedger(ledgerData);
      setLedgerBank(bankData);
    }).catch(err => { console.error(err); toast.error('Failed to load ledger'); setLedger([]) }).finally(() => setLedgerLoading(false))
  }

  useEffect(() => { loadLedger() }, [selected])

  const selectedBank = banks.find(b => b.id === selected) || null

  const totals = (Array.isArray(ledger) ? ledger : []).reduce((acc, t) => {
    if (!t || t?.status === 'deleted') return acc
    try {
      const inVal = typeof t?.amount_in === 'number' || typeof t?.amount_in === 'string' ? t.amount_in : 0
      const outVal = typeof t?.amount_out === 'number' || typeof t?.amount_out === 'string' ? t.amount_out : 0
      return {
        in: toNumber(add(d(acc.in), d(inVal))),
        out: toNumber(add(d(acc.out), d(outVal))),
      }
    } catch (e) {
      console.error('totals calc error', t, e)
      return acc
    }
  }, { in: 0, out: 0 })

  const [deleting, setDeleting] = useState(false)

  const submitDeletion = async () => {
    if (deleting) return
    if (!delReason.trim()) return toast.error('Reason is required')
    setDeleting(true)
    try {
      await api.post('/finance/deletion-requests', {
        transaction_type: 'bank_transaction', transaction_id: delTarget.id, reason: delReason.trim(),
      })
      toast.success('Deletion request submitted for approval')
      setDelTarget(null)
      setDelReason('')
      loadLedger()
      load()
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to submit request') }
    finally { setDeleting(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Bank Book</h1>
          <p className="text-sm text-slate-500 mt-1">Running balance ledger for company bank accounts</p>
        </div>
        <Button onClick={() => setAddBankOpen(true)}><Plus size={15} /> Add Bank</Button>
      </div>

      {loading ? <LoadingSkeleton rows={3} cols={4} /> : banks.length === 0 ? (
        <Card><CardContent><EmptyState icon={Landmark} title="No banks added" text="Add a bank account to start recording transactions" /></CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {safeArray(banks).map(bank => {
              const bal = bank?.balance ?? 0
              return (
                <StatCard
                  key={bank.id}
                  label={bank.name}
                  value={formatPKR(bal)}
                  icon={Landmark}
                  color={bal < 0 ? 'red' : 'green'}
                  onClick={() => setSelected(bank.id)}
                />
              )
            })}
          </div>

          {selected && (
            <Card>
              <CardHeader
                title={ledgerBank ? `${ledgerBank.name} — Ledger` : 'Ledger'}
                action={<Button size="sm" onClick={() => setTxOpen(true)}><Plus size={14} /> Add Transaction</Button>}
              />
              <CardContent className="p-0">
                {ledgerLoading ? <div className="p-6"><LoadingSkeleton rows={4} cols={6} /></div> : ledger.length === 0 ? (
                  <EmptyState icon={ArrowDownLeft} title="No transactions" text="Add deposits or payments to see the running balance" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200"><tr>
                        {['Date', 'Payee', 'Cheque No', 'Amount In', 'Amount Out', 'Running Balance', 'Origin', 'Status', 'Added By', 'Actions'].map(h => (
                          <th key={h} className={`text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider ${['Amount In', 'Amount Out', 'Running Balance'].includes(h) ? 'text-right' : ''}`}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {safeArray(ledger).map(t => {
                            const amountIn = t?.amount_in != null ? parseFloat(t.amount_in) : 0
                            const amountOut = t?.amount_out != null ? parseFloat(t.amount_out) : 0
                            const runningBal = t?.running_balance != null ? t.running_balance : null
                            return (
                              <tr key={t.id} className="hover:bg-slate-50">
                                <td className="px-4 py-2.5 text-slate-500">{fmtDate(t.date)}</td>
                                <td className="px-4 py-2.5 font-medium">{t.payee_name}</td>
                                <td className="px-4 py-2.5 text-slate-500">{t.cheque_no || '-'}</td>
                                <td className="px-4 py-2.5 text-right font-semibold text-emerald-600">{amountIn > 0 ? formatPKR(amountIn) : '-'}</td>
                                <td className="px-4 py-2.5 text-right font-semibold text-red-600">{amountOut > 0 ? formatPKR(amountOut) : '-'}</td>
                                <td className="px-4 py-2.5 text-right font-bold">{runningBal === null ? '-' : formatPKR(runningBal)}</td>
                                <td className="px-4 py-2.5">
                                  {t.source_type === 'manual' || !t.source_type ? (
                                    <Badge variant="default">Manual</Badge>
                                  ) : (
                                    <Badge variant="warning">Auto — {SOURCE_LABELS[t.source_type] || t.source_type?.replace(/_/g, ' ')}</Badge>
                                  )}
                                </td>
                                <td className="px-4 py-2.5">{txStatusBadge(t.status)}</td>
                                <td className="px-4 py-2.5 text-slate-500">{t.created_by_name || '-'}</td>
                                <td className="px-4 py-2.5">
                                  {t.status === 'active' && (!t.source_type || t.source_type === 'manual') && (
                                    <button
                                      onClick={() => { setDelReason(''); setDelTarget(t) }}
                                      className="p-1.5 hover:bg-red-50 rounded text-red-600 transition-colors"
                                      title="Request Deletion"
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {selectedBank && totals && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard label="Total In" value={formatPKR(totals.in ?? 0)} icon={ArrowDownLeft} color="green" />
              <StatCard label="Total Out" value={formatPKR(totals.out ?? 0)} icon={ArrowUpRight} color="red" />
              <StatCard label="Closing Balance" value={formatPKR((totals.in ?? 0) - (totals.out ?? 0))} icon={Landmark} color={((totals.in ?? 0) - (totals.out ?? 0)) < 0 ? 'red' : 'teal'} />
            </div>
          )}
        </>
      )}

      <Modal isOpen={addBankOpen} onClose={() => setAddBankOpen(false)} title="Add Bank" size="max-w-md">
        <BankForm onCancel={() => setAddBankOpen(false)} onDone={() => { setAddBankOpen(false); load() }} />
      </Modal>

      <Modal isOpen={txOpen} onClose={() => setTxOpen(false)} title={ledgerBank ? `Add Transaction — ${ledgerBank.name}` : 'Add Transaction'} size="max-w-md">
        <TxForm bankId={selected} onCancel={() => setTxOpen(false)} onDone={() => { setTxOpen(false); loadLedger(); load() }} />
      </Modal>

      {delTarget && (
        <Modal isOpen={true} onClose={() => setDelTarget(null)} title="Request Deletion" size="max-w-md">
          <div className="space-y-4">
            <div className="bg-red-50 rounded-xl px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <Info size={15} className="flex-shrink-0 mt-0.5" />
              <span>You are requesting deletion of the transaction for <b>{delTarget.payee_name}</b> ({formatPKR(parseFloat(delTarget.amount_in) > 0 ? delTarget.amount_in : -delTarget.amount_out)}). An admin and the owner must both approve before it is removed.</span>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Reason *</label>
              <textarea
                value={delReason}
                onChange={e => setDelReason(e.target.value)}
                rows={3}
                placeholder="Explain why this transaction should be deleted"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>
            <div className="flex gap-3">
              <Button onClick={submitDeletion} disabled={deleting}>{deleting ? 'Submitting...' : 'Submit Request'}</Button>
              <Button variant="secondary" onClick={() => setDelTarget(null)} disabled={deleting}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function BankForm({ onCancel, onDone }) {
  const [form, setForm] = useState({ name: '', account_number: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    if (!form.name.trim()) return setError('Bank name required')
    setSubmitting(true)
    try {
      await api.post('/banks', form)
      toast.success('Bank added')
      onDone()
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to add bank') }
    finally { setSubmitting(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Bank Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} error={error} />
      <Input label="Account Number" value={form.account_number} onChange={e => setForm({ ...form, account_number: e.target.value })} />
      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={submitting}>{submitting ? 'Adding...' : 'Add Bank'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>Cancel</Button>
      </div>
    </form>
  )
}

function TxForm({ bankId, onCancel, onDone }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10), payee_name: '', cheque_no: '', amount_in: '', amount_out: '',
  })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    const errs = {}
    if (!form.date) errs.date = 'Date required'
    if (!form.payee_name.trim()) errs.payee_name = 'Payee name required'
    const inAmt = form.amount_in === '' ? 0 : parseFloat(form.amount_in)
    const outAmt = form.amount_out === '' ? 0 : parseFloat(form.amount_out)
    if (form.amount_in !== '' && (isNaN(inAmt) || inAmt < 0)) errs.amount_in = 'Valid amount required'
    if (form.amount_out !== '' && (isNaN(outAmt) || outAmt < 0)) errs.amount_out = 'Valid amount required'
    if (!errs.amount_in && !errs.amount_out && inAmt === 0 && outAmt === 0) errs.amount_in = 'Amount in or out required'
    if (!errs.amount_in && !errs.amount_out && inAmt > 0 && outAmt > 0) errs.amount_in = 'Use either amount in or amount out'
    if (Object.keys(errs).length) return setErrors(errs)
    setSubmitting(true)
    try {
      await api.post(`/banks/${bankId}/transactions`, {
        date: form.date, payee_name: form.payee_name.trim(), cheque_no: form.cheque_no || null,
        amount_in: inAmt || undefined, amount_out: outAmt || undefined,
      })
      toast.success('Transaction added')
      onDone()
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to add transaction') }
    finally { setSubmitting(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Date *" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} error={errors.date} />
      <Input label="Payee Name *" value={form.payee_name} onChange={e => setForm({ ...form, payee_name: e.target.value })} error={errors.payee_name} />
      <Input label="Cheque No" value={form.cheque_no} onChange={e => setForm({ ...form, cheque_no: e.target.value })} />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Amount In" type="number" min="0" step="0.01" value={form.amount_in} onChange={e => setForm({ ...form, amount_in: e.target.value })} error={errors.amount_in} />
        <Input label="Amount Out" type="number" min="0" step="0.01" value={form.amount_out} onChange={e => setForm({ ...form, amount_out: e.target.value })} error={errors.amount_out} />
      </div>
      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={submitting}>{submitting ? 'Adding...' : 'Add Transaction'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>Cancel</Button>
      </div>
    </form>
  )
}