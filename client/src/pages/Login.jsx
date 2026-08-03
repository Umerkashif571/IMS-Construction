import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import logo from '../assets/logo.jpg'
import bgImg from '../assets/site-photo2.jpg'
import toast from 'react-hot-toast'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
      navigate('/')
      toast.success('Login successful')
    } catch (err) {
      console.error(err); toast.error(err.response?.data?.error || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative" style={{ backgroundImage: `url(${bgImg})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl mb-4 overflow-hidden p-1">
            <img src={logo} alt="Logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-bold text-white">Al Shafi Enterprises</h1>
          <p className="text-blue-200 mt-1">Asset Management</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Sign In</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {import.meta.env.VITE_DEMO_MODE ? (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-3 text-center">Demo Credentials</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { role: 'Admin', email: 'admin@ims.com', badge: 'bg-red-100 text-red-700' },
                  { role: 'Store Manager', email: 'store@ims.com', badge: 'bg-blue-100 text-blue-700' },
                  { role: 'Site Engineer', email: 'engineer@ims.com', badge: 'bg-green-100 text-green-700' },
                  { role: 'Procurement', email: 'procurement@ims.com', badge: 'bg-purple-100 text-purple-700' },
                  { role: 'Finance', email: 'finance@ims.com', badge: 'bg-teal-100 text-teal-700' },
                ].map(d => (
                  <div key={d.email} className={`p-2 rounded-lg ${d.badge}`}>
                    <div className="font-medium">{d.role}</div>
                    <div className="opacity-75">{d.email}</div>
                    <div className="opacity-60">Password set by administrator</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}