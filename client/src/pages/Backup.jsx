import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { ConfirmDialog, Button, LoadingSkeleton, EmptyState } from '../components/ui'
import { Download, Upload, Database, Shield, ShieldOff, HardDrive, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Backup() {
  const { user } = useAuth()
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [backingUp, setBackingUp] = useState(false)
  const [restoreConfirm, setRestoreConfirm] = useState({ open: false, name: '' })

  const isAdmin = user?.role === 'admin' || user?.role === 'owner'

  const load = () => {
    setLoading(true)
    api.get('/backup/list').then(({ data }) => setBackups(data || [])).catch(() => toast.error('Failed to load backups')).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleBackup = async () => {
    setBackingUp(true)
    try {
      const response = await api.get('/backup/export', { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `ims_backup_${new Date().toISOString().slice(0, 10)}.sql`
      a.click()
      window.URL.revokeObjectURL(url)
      toast.success('Backup exported')
      load()
    } catch (err) {
      toast.error('Backup failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setBackingUp(false)
    }
  }

  const handleRestore = async () => {
    try {
      await api.post('/backup/restore', { filename: restoreConfirm.name })
      toast.success('Database restored from backup')
      setRestoreConfirm({ open: false, name: '' })
    } catch (err) {
      toast.error('Restore failed: ' + (err.response?.data?.error || err.message))
    }
  }

  if (!isAdmin) {
    return <EmptyState icon={ShieldOff} title="Access denied" text="Admin only. You do not have permission to view this page." />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Database Backup & Restore</h1>
          <p className="text-xs text-slate-500 mt-0.5">Export and restore database backups</p>
        </div>
        <Button onClick={handleBackup} disabled={backingUp}>
          {backingUp ? <><RotateCcw size={16} className="animate-spin" /> Exporting...</> : <><Download size={16} /> Export Backup (SQL)</>}
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800">Existing Backups</h3>
        </div>
        {loading ? (
          <LoadingSkeleton rows={3} cols={5} />
        ) : backups.length === 0 ? (
          <EmptyState icon={HardDrive} title="No backups found" text="Run your first backup to see files here" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['File Name', 'Date', 'Size', 'Created By', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {backups.map((b, idx) => (
                  <tr key={b.name || idx} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{b.name}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{b.created ? new Date(b.created).toLocaleString() : '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{b.size ? `${(parseFloat(b.size) / 1024).toFixed(1)} KB` : '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">-</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={() => window.open(`/api/backup/export`, '_blank')}>
                          <Download size={14} /> Download
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setRestoreConfirm({ open: true, name: b.name })}>
                          <Upload size={14} /> Restore
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={restoreConfirm.open}
        onClose={() => setRestoreConfirm({ open: false, id: null, name: '' })}
        onConfirm={handleRestore}
        title="Confirm Database Restore"
        message={`Are you sure you want to restore from "${restoreConfirm.name}"? This will overwrite the current database.`}
      />
    </div>
  )
}