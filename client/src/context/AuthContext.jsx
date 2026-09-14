import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../api'

const AuthContext = createContext(null)

const readStoredUser = () => {
  try { return JSON.parse(localStorage.getItem('ims_user') || 'null') } catch { return null }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // On load: if a token exists, confirm it with the server and take the CURRENT identity
  // (role/name may have changed since login). A 401 ends the session; any other failure
  // (server down, 500) keeps the stored session so a blip doesn't log everyone out.
  const validateToken = useCallback(async () => {
    const token = localStorage.getItem('ims_token')
    const stored = readStoredUser()
    if (!token || !stored) { setUser(null); setLoading(false); return false }
    try {
      const { data } = await api.get('/auth/me')
      const fresh = data?.user || data
      const next = fresh && fresh.id ? { ...stored, ...fresh } : stored
      localStorage.setItem('ims_user', JSON.stringify(next))
      setUser(next)
      return true
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.removeItem('ims_token'); localStorage.removeItem('ims_user'); setUser(null)
        return false
      }
      setUser(stored)
      return true
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { validateToken() }, [validateToken])

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    localStorage.setItem('ims_token', data.token)
    localStorage.setItem('ims_user', JSON.stringify(data.user))
    setUser(data.user)
    return data.user
  }

  const logout = () => {
    localStorage.removeItem('ims_token')
    localStorage.removeItem('ims_user')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, validateToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
