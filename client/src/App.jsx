import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout, { navItems } from './components/Layout'
import Login from './pages/Login'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Materials = lazy(() => import('./pages/Materials'))
const Vehicles = lazy(() => import('./pages/Vehicles'))
const Tools = lazy(() => import('./pages/Tools'))
const Projects = lazy(() => import('./pages/Projects'))
const Vendors = lazy(() => import('./pages/Vendors'))
const Warehouses = lazy(() => import('./pages/Warehouses'))
const Reports = lazy(() => import('./pages/Reports'))
const Users = lazy(() => import('./pages/Users'))
const Backup = lazy(() => import('./pages/Backup'))
const GatePass = lazy(() => import('./pages/GatePass'))
const BankBook = lazy(() => import('./pages/BankBook'))

function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="animate-pulse text-sm text-slate-400">Loading...</div>
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="text-2xl text-gray-400">Loading...</div></div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

// Role guards mirror the sidebar navItems (Layout.jsx). Server still enforces
// real authorization on every API; this only prevents direct-URL access.
// Roles are defined once, in the sidebar's navItems (components/Layout.jsx); the API enforces
// the same lists in server/src/middleware/auth.js ROLES. This guard only prevents direct-URL access.
function RoleRoute({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  const path = location.pathname
  const item = navItems.find(i => i.to === path) || navItems.find(i => i.to !== '/' && path.startsWith(i.to))
  if (!user || (item && !item.roles.includes(user.role))) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Suspense fallback={<PageFallback />}><Dashboard /></Suspense>} />
        <Route path="materials" element={<RoleRoute><Suspense fallback={<PageFallback />}><Materials /></Suspense></RoleRoute>} />
        <Route path="vehicles" element={<RoleRoute><Suspense fallback={<PageFallback />}><Vehicles /></Suspense></RoleRoute>} />
        <Route path="tools" element={<RoleRoute><Suspense fallback={<PageFallback />}><Tools /></Suspense></RoleRoute>} />
        <Route path="projects" element={<RoleRoute><Suspense fallback={<PageFallback />}><Projects /></Suspense></RoleRoute>} />
        <Route path="vendors" element={<RoleRoute><Suspense fallback={<PageFallback />}><Vendors /></Suspense></RoleRoute>} />
        <Route path="warehouses" element={<RoleRoute><Suspense fallback={<PageFallback />}><Warehouses /></Suspense></RoleRoute>} />
        <Route path="reports" element={<RoleRoute><Suspense fallback={<PageFallback />}><Reports /></Suspense></RoleRoute>} />
        <Route path="users" element={<RoleRoute><Suspense fallback={<PageFallback />}><Users /></Suspense></RoleRoute>} />
        <Route path="backup" element={<RoleRoute><Suspense fallback={<PageFallback />}><Backup /></Suspense></RoleRoute>} />
        <Route path="gatepass" element={<RoleRoute><Suspense fallback={<PageFallback />}><GatePass /></Suspense></RoleRoute>} />
        <Route path="gatepass/:id" element={<RoleRoute><Suspense fallback={<PageFallback />}><GatePass /></Suspense></RoleRoute>} />
        <Route path="bankbook" element={<RoleRoute><Suspense fallback={<PageFallback />}><BankBook /></Suspense></RoleRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
