import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import { Modal, Button, Input, Select, LoadingSkeleton, EmptyState, Badge } from '../components/ui'
import { Plus, Edit3, Users as UsersIcon, Shield, ShieldOff, Activity } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Users() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState({ open: false, item: null })
  const [auditLogs, setAuditLogs] = useState([])

  const isAdmin = user?.role === 'admin' || user?.role === 'owner'

  const load = () => {
    setLoading(true)
    Promise.all([
      api.get('/users'),
      api.get('/users/audit-logs')
    ]).then(([uRes, aRes]) => {
      setUsers(uRes.data || [])
      setAuditLogs(aRes.data || [])
    }).catch(() => toast.error('Failed to load users'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleSave = async (form) => {
    try {
      if (form.id) {
        await api.put(`/users/${form.id}`, form)
        toast.success('User updated')
      } else {
        await api.post('/users', form)
        toast.success('User created')
      }
      setModal({ open: false, item: null }); load()
    } catch (err) { console.error(err); toast.error(err.response?.data?.error || 'Failed to save') }
  }

  const toggleActive = async (u) => {
    try {
      await api.put(`/users/${u.id}`, { is_active: !u.is_active })
      toast.success(`User ${u.is_active ? 'deactivated' : 'activated'}`)
      load()
    } catch (err) { console.error(err); toast.error('Failed to update user') }
  }

  if (!isAdmin) {
    return <EmptyState icon={ShieldOff} title="Access denied" text="Admin only. You do not have permission to view this page." />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Users Management</h1>
          <p className="text-xs text-slate-500 mt-0.5">Manage system users and permissions</p>
        </div>
        <Button onClick={() => setModal({ open: true, item: {} })}><Plus size={16} /> Add User</Button>
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} cols={6} />
      ) : users.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No users found" text="No users match your search criteria" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Email</th>
                  <th className="text-left px-4 py-3 font-medium">Full Name</th>
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <th className="text-left px-4 py-3 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 font-medium">Active</th>
                  <th className="text-left px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{u.email}</td>
                    <td className="px-4 py-3 font-medium">{u.full_name || '-'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={
                        u.role === 'owner' ? 'purple' :
                        u.role === 'admin' ? 'error' :
                        u.role === 'store_manager' ? 'info' :
                        u.role === 'site_engineer' ? 'success' :
                        u.role === 'manager' ? 'indigo' :
                        u.role === 'finance' ? 'default' :
                        u.role === 'staff' ? 'warning' : 'default'
                      }>{u.role?.replace(/_/g, ' ')}</Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{u.phone || '-'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={u.is_active ? 'success' : 'error'}>{u.is_active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {u.role === 'owner' ? (
                          <span className="text-xs text-slate-400 italic">Protected</span>
                        ) : (
                          <>
                            <button onClick={() => setModal({ open: true, item: u })} className="p-1.5 hover:bg-green-50 rounded text-green-600" title="Edit"><Edit3 size={16} /></button>
                            <button onClick={() => toggleActive(u)} className={`p-1.5 rounded ${u.is_active ? 'hover:bg-red-50 text-red-600' : 'hover:bg-green-50 text-green-600'}`} title={u.is_active ? 'Deactivate' : 'Activate'}>
                              {u.is_active ? <ShieldOff size={16} /> : <Shield size={16} />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Audit Logs */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-4">Audit Log</h3>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Time</th>
                <th className="text-left px-4 py-2 font-medium">User</th>
                <th className="text-left px-4 py-2 font-medium">Action</th>
                <th className="text-left px-4 py-2 font-medium">Entity</th>
                <th className="text-left px-4 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {auditLogs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-500">{log.created_at ? new Date(log.created_at).toLocaleString() : '-'}</td>
                  <td className="px-4 py-2 text-sm">{log.user_name || '-'}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      log.action === 'created' ? 'bg-green-100 text-green-700' :
                      log.action === 'updated' ? 'bg-blue-100 text-blue-700' :
                      log.action === 'deleted' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{log.action}</span>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600">{log.entity_type} #{log.entity_id}</td>
                  <td className="px-4 py-2 text-sm text-gray-500 max-w-xs truncate">{log.description}</td>
                </tr>
              ))}
              {auditLogs.length === 0 && <tr><td colSpan={5} className="text-center py-6"><EmptyState icon={Activity} title="No audit logs" text="No audit log entries yet" /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={modal.open} onClose={() => setModal({ open: false, item: null })} title={modal.item?.id ? 'Edit User' : 'Add User'} size="max-w-md">
        <UserForm data={modal.item} onSave={handleSave} onCancel={() => setModal({ open: false, item: null })} />
      </Modal>
    </div>
  )
}

function UserForm({ data, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: data?.id || null, email: data?.email || '', password: data?.password || '',
    full_name: data?.full_name || '', role: data?.role || 'site_engineer',
    phone: data?.phone || '', is_active: data?.is_active ?? true
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.email) return toast.error('Email required')
    if (!form.id && !form.password) return toast.error('Password required for new users')
    const payload = { ...form }
    if (!payload.password) delete payload.password
    onSave(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Email *" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
      <Input label={form.id ? 'New Password (leave blank to keep)' : 'Password *'} type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
      <Input label="Full Name" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
      <Select label="Role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{user?.role === 'owner' && <option value="owner">Owner</option>}<option value="admin">Admin</option><option value="manager">Manager</option><option value="finance">Finance</option><option value="staff">Staff</option><option value="store_manager">Store Manager</option><option value="site_engineer">Site Engineer</option><option value="procurement_officer">Procurement Officer</option></Select>
      <Input label="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
      <div className="flex gap-3 pt-2">
        <Button type="submit">{form.id ? 'Update' : 'Create'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}