import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
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
function RoleRoute({ roles, children }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />
  return children
}

function Lazy({ children }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>
}

export default function App() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Lazy><Dashboard /></Lazy>} />
        <Route path="materials" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff']}><Lazy><Materials /></Lazy></RoleRoute>} />
        <Route path="vehicles" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'site_engineer', 'manager', 'staff']}><Lazy><Vehicles /></Lazy></RoleRoute>} />
        <Route path="tools" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'site_engineer', 'manager', 'staff']}><Lazy><Tools /></Lazy></RoleRoute>} />
        <Route path="projects" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff', 'finance']}><Lazy><Projects /></Lazy></RoleRoute>} />
        <Route path="vendors" element={<RoleRoute roles={['owner', 'admin', 'procurement_officer', 'store_manager', 'manager', 'staff']}><Lazy><Vendors /></Lazy></RoleRoute>} />
        <Route path="warehouses" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'manager', 'staff']}><Lazy><Warehouses /></Lazy></RoleRoute>} />
        <Route path="reports" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'procurement_officer', 'manager', 'staff']}><Lazy><Reports /></Lazy></RoleRoute>} />
        <Route path="users" element={<RoleRoute roles={['owner', 'admin']}><Lazy><Users /></Lazy></RoleRoute>} />
        <Route path="backup" element={<RoleRoute roles={['owner', 'admin']}><Lazy><Backup /></Lazy></RoleRoute>} />
        <Route path="gatepass" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'manager', 'staff']}><Lazy><GatePass /></Lazy></RoleRoute>} />
        <Route path="gatepass/:id" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'manager', 'staff']}><Lazy><GatePass /></Lazy></RoleRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
