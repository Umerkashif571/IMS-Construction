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
function RoleRoute({ roles, children }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Suspense fallback={<PageFallback />}><Dashboard /></Suspense>} />
        <Route path="materials" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff']}><Suspense fallback={<PageFallback />}><Materials /></Suspense></RoleRoute>} />
        <Route path="vehicles" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'site_engineer', 'manager', 'staff']}><Suspense fallback={<PageFallback />}><Vehicles /></Suspense></RoleRoute>} />
        <Route path="tools" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'site_engineer', 'manager', 'staff']}><Suspense fallback={<PageFallback />}><Tools /></Suspense></RoleRoute>} />
        <Route path="projects" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff', 'finance']}><Suspense fallback={<PageFallback />}><Projects /></Suspense></RoleRoute>} />
        <Route path="vendors" element={<RoleRoute roles={['owner', 'admin', 'procurement_officer', 'store_manager', 'manager', 'staff', 'finance']}><Suspense fallback={<PageFallback />}><Vendors /></Suspense></RoleRoute>} />
        <Route path="warehouses" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'manager', 'staff']}><Suspense fallback={<PageFallback />}><Warehouses /></Suspense></RoleRoute>} />
        <Route path="reports" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'procurement_officer', 'manager', 'staff']}><Suspense fallback={<PageFallback />}><Reports /></Suspense></RoleRoute>} />
        <Route path="users" element={<RoleRoute roles={['owner', 'admin']}><Suspense fallback={<PageFallback />}><Users /></Suspense></RoleRoute>} />
        <Route path="backup" element={<RoleRoute roles={['owner', 'admin']}><Suspense fallback={<PageFallback />}><Backup /></Suspense></RoleRoute>} />
        <Route path="gatepass" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'manager', 'staff']}><Suspense fallback={<PageFallback />}><GatePass /></Suspense></RoleRoute>} />
        <Route path="gatepass/:id" element={<RoleRoute roles={['owner', 'admin', 'store_manager', 'manager', 'staff']}><Suspense fallback={<PageFallback />}><GatePass /></Suspense></RoleRoute>} />
        <Route path="bankbook" element={<RoleRoute roles={['owner', 'admin', 'finance']}><Suspense fallback={<PageFallback />}><BankBook /></Suspense></RoleRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
