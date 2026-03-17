/**
 * Main React application with routing and auth guard.
 * Uses React Router v7 with lazy-loaded pages for code splitting.
 * Auth state is checked against /api/auth/me on mount.
 */

import React, { Suspense, useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { apiCall } from './hooks/useApi';
import { Toaster } from '@/components/ui/sonner';

// ─── Auth context ─────────────────────────────────────────────────────────────

interface AuthUser {
  id: number;
  username: string;
  email: string | null;
  is_admin: boolean;
  is_active: boolean;
  force_password_change: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refetch: async () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// ─── Lazy page imports ────────────────────────────────────────────────────────

const LoginPage = React.lazy(() => import('./pages/Login'));
const DashboardPage = React.lazy(() => import('./pages/Dashboard'));

// All other pages are dynamically imported from the existing Next.js page components
// wrapped with a client-side loader. These will be progressively migrated.
const ServersPage = React.lazy(() => import('./pages/Servers'));
const SettingsPage = React.lazy(() => import('./pages/Settings'));
const AgentPage = React.lazy(() => import('./pages/Agent'));
const MonitoringPage = React.lazy(() => import('./pages/Monitoring'));
const UsersPage = React.lazy(() => import('./pages/Users'));
const AuditPage = React.lazy(() => import('./pages/Audit'));

const ConfigsPage = React.lazy(() => import('./pages/Configs'));
const ConfigDetailPage = React.lazy(() => import('./pages/ConfigDetail'));
const TagsPage = React.lazy(() => import('./pages/Tags'));
const TasksPage = React.lazy(() => import('./pages/Tasks'));
const OrgansPage = React.lazy(() => import('./pages/Organs'));
const ServerNewPage = React.lazy(() => import('./pages/ServerNew'));
const ServerDetailPage = React.lazy(() => import('./pages/ServerDetail'));

// Newly implemented + additional pages
const NotificationsPage = React.lazy(() => import('./pages/Notifications'));
const ServerTrustPage = React.lazy(() => import('./pages/ServerTrust'));
const ISOSyncPage = React.lazy(() => import('./pages/ISOSync'));

const MigrationsPage = React.lazy(() => import('./pages/Migrations'));
const MigrationNewPage = React.lazy(() => import('./pages/MigrationNew'));
const MigrationDetailPage = React.lazy(() => import('./pages/MigrationDetail'));
const BackupsPage = React.lazy(() => import('./pages/Backups'));
const BackupDetailPage = React.lazy(() => import('./pages/BackupDetail'));
const ConsolePage = React.lazy(() => import('./pages/Console'));
const ConsoleTerminalPage = React.lazy(() => import('./pages/ConsoleTerminal'));
const ToolsPage = React.lazy(() => import('./pages/Tools'));
const BulkCommandPage = React.lazy(() => import('./pages/BulkCommand'));
const StoragePage = React.lazy(() => import('./pages/Storage'));
const DisasterRecoveryPage = React.lazy(() => import('./pages/DisasterRecovery'));
const OptimizerPage = React.lazy(() => import('./pages/Optimizer'));
const HistoryPage = React.lazy(() => import('./pages/History'));
const LogsPage = React.lazy(() => import('./pages/Logs'));

// ─── Page spinner ─────────────────────────────────────────────────────────────

function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

// ─── Sidebar layout ───────────────────────────────────────────────────────────
// Imports the existing Sidebar component. Since it uses next-intl and next/link
// via compat shims, it should work without modification.

const Sidebar = React.lazy(async () => {
  try {
    const mod = await import('../components/layout/Sidebar');
    return { default: mod.Sidebar };
  } catch {
    return {
      default: () => (
        <div className="w-64 h-screen bg-sidebar border-r border-sidebar-border flex items-center justify-center">
          <span className="text-xs text-muted-foreground">Sidebar unavailable</span>
        </div>
      ),
    };
  }
});

function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Suspense fallback={<div className="w-64 h-screen bg-sidebar border-r border-sidebar-border" />}>
        <Sidebar />
      </Suspense>
      <main className="flex-1 ml-64 overflow-y-auto h-screen">
        <div className="p-6 h-full">
          <Suspense fallback={<PageSpinner />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

// ─── Auth provider ────────────────────────────────────────────────────────────

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = async () => {
    try {
      const data = await apiCall<AuthUser>('/api/auth/me');
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await apiCall('/api/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    setUser(null);
    window.location.href = '/login';
  };

  useEffect(() => {
    fetchUser();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refetch: fetchUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Auth guard ───────────────────────────────────────────────────────────────

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Force password change after first login
  if (user.force_password_change && !location.pathname.includes('/login')) {
    return <Navigate to="/login?force_change=true" replace />;
  }

  return <AppLayout />;
}

// Auth guard without sidebar layout (for full-screen pages like terminal)
function RequireAuthBare() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <Outlet />
    </Suspense>
  );
}

// ─── App routes ───────────────────────────────────────────────────────────────

function AppRoutes() {
  return (
    <Routes>
      {/* Public route */}
      <Route
        path="/login"
        element={
          <Suspense fallback={<PageSpinner />}>
            <LoginPage />
          </Suspense>
        }
      />

      {/* Full-screen protected routes (no sidebar) */}
      <Route element={<RequireAuthBare />}>
        <Route path="/servers/:id/console/:vmid" element={<ConsoleTerminalPage />} />
      </Route>

      {/* Protected routes */}
      <Route element={<RequireAuth />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/servers" element={<ServersPage />} />
        <Route path="/servers/new" element={<ServerNewPage />} />
        <Route path="/servers/:id" element={<ServerDetailPage />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/agent" element={<AgentPage />} />
        <Route path="/backups" element={<BackupsPage />} />
        <Route path="/backups/:id" element={<BackupDetailPage />} />
        <Route path="/configs" element={<ConfigsPage />} />
        <Route path="/configs/:id" element={<ConfigDetailPage />} />
        <Route path="/migrations" element={<MigrationsPage />} />
        <Route path="/migrations/new" element={<MigrationNewPage />} />
        <Route path="/migrations/:id" element={<MigrationDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/tools/bulk-command" element={<BulkCommandPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/optimizer" element={<OptimizerPage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/storage" element={<StoragePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/organs" element={<OrgansPage />} />
        <Route path="/console" element={<ConsolePage />} />
        <Route path="/disaster-recovery" element={<DisasterRecoveryPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/server-trust" element={<ServerTrustPage />} />
        <Route path="/iso-sync" element={<ISOSyncPage />} />
        <Route path="/library" element={<Navigate to="/iso-sync" replace />} />
        <Route path="/telegram-trust" element={<Navigate to="/settings" replace />} />
        <Route path="/jobs" element={<Navigate to="/tasks" replace />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// ─── Root App component ───────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
      <Toaster richColors position="top-right" />
    </BrowserRouter>
  );
}
