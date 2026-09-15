import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { AdminReauthProvider, useAdminReauth } from '@/context/AdminReauthContext';
import Layout from '@/components/Layout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Servers from '@/pages/Servers';
import ServerDetail from '@/pages/ServerDetail';
import Projects from '@/pages/Projects';
import ProjectCreate from '@/pages/ProjectCreate';
import ProjectDetail from '@/pages/ProjectDetail';
import PortRegistry from '@/pages/PortRegistry';
import Variables from '@/pages/Variables';
import Commands from '@/pages/Commands';
import Credentials from '@/pages/Credentials';
import Settings from '@/pages/Settings';
import AdminDashboard from '@/pages/AdminDashboard';
import AuditLogs from '@/pages/AuditLogs';
import LoginSessions from '@/pages/LoginSessions';
import ReverificationPage from '@/pages/ReverificationPage';
import ReauthExpiredPage from '@/pages/ReauthExpiredPage';
import SecretCredentials from '@/pages/SecretCredentials';
import PageLoader from '@/components/PageLoader';

function AppRoutes() {
  const { userRole } = useAuth();
  const { reauthExpired } = useAdminReauth();

  if (reauthExpired) {
    return <ReauthExpiredPage />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/servers" element={<Servers />} />
        <Route path="/servers/:id" element={<ServerDetail />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/new" element={<ProjectCreate />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/ports" element={<PortRegistry />} />
        <Route path="/variables" element={<Variables />} />
        <Route path="/commands" element={<Commands />} />
        <Route path="/credentials" element={<Credentials />} />
        <Route path="/settings" element={<Settings />} />
        <Route
          path="/admin"
          element={userRole === 'admin' ? <AdminDashboard /> : <Navigate to="/" replace />}
        />
        <Route
          path="/audit-logs"
          element={userRole === 'admin' ? <AuditLogs /> : <Navigate to="/" replace />}
        />
        <Route
          path="/login-sessions"
          element={<LoginSessions />}
        />
        <Route
          path="/secret-credentials"
          element={userRole === 'admin' ? <SecretCredentials /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function App() {
  const { session, loading, userRole, pendingOtpEmail, reverificationRequired } = useAuth();

  if (loading) {
    return <PageLoader label="Initializing..." fullscreen />;
  }

  if (!session || pendingOtpEmail) {
    return <Login />;
  }

  if (userRole === 'none') {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <p className="text-text-secondary text-lg font-medium mb-2">Account not activated</p>
          <p className="text-sm text-text-muted mb-6">
            Your account has not been set up by an administrator yet. Please contact your administrator.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (reverificationRequired) {
    return <ReverificationPage />;
  }

  return (
    <BrowserRouter>
      <AdminReauthProvider>
        <AppRoutes />
      </AdminReauthProvider>
    </BrowserRouter>
  );
}

export default App;
