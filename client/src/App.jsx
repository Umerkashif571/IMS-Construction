import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Materials from './pages/Materials'
import Vehicles from './pages/Vehicles'
import Tools from './pages/Tools'
import Projects from './pages/Projects'
import Vendors from './pages/Vendors'
import Warehouses from './pages/Warehouses'
import Reports from './pages/Reports'
import Users from './pages/Users'
import Backup from './pages/Backup'
import GatePass from './pages/GatePass'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="text-2xl text-gray-400">Loading...</div></div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="materials" element={<Materials />} />
        <Route path="vehicles" element={<Vehicles />} />
        <Route path="tools" element={<Tools />} />
        <Route path="projects" element={<Projects />} />
        <Route path="vendors" element={<Vendors />} />
        <Route path="warehouses" element={<Warehouses />} />
        <Route path="reports" element={<Reports />} />
        <Route path="users" element={<Users />} />
        <Route path="backup" element={<Backup />} />
        <Route path="gatepass" element={<GatePass />} />
        <Route path="gatepass/:id" element={<GatePass />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}