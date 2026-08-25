import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../api'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)

  const validateToken = useCallback(async () => {
    if (!mounted) return false
    const token = localStorage.getItem('ims_token')
    const stored = localStorage.getItem('ims_user')
    if (!token || !stored) {
      setLoading(false)
      return false
    }
    try {
      const userData = JSON.parse(stored)
      // Verify token by making a lightweight request
      await api.get('/auth/me')
      setUser(userData)
      return true
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.removeItem('ims_token')
        localStorage.removeItem('ims_user')
      }
      return false
    } finally {
      setLoading(false)
    }
  }, [mounted])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted) {
      validateToken()
    }
  }, [validateToken, mounted])

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