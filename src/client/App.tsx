/**
 * Main React application with routing and auth guard.
 * Uses React Router v7 with lazy-loaded pages for code splitting.
 * Auth state is checked against /api/auth/me on mount.
 */

import React, { Suspense, useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, Outlet } from 'react-router-dom';
import { apiCall } from './hooks/useApi';

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

// Placeholder for pages not yet migrated
function PlaceholderPage({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center space-y-4">
      <div className="text-4xl">🚧</div>
      <h2 className="text-xl font-semibold">{name}</h2>
      <p className="text-muted-foreground text-sm">This page is being migrated from Next.js.</p>
    </div>
  );
}

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
  if (user.force_password_change && !window.location.pathname.includes('/login')) {
    return <Navigate to="/login" replace />;
  }

  return <AppLayout />;
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

      {/* Protected routes */}
      <Route element={<RequireAuth />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/servers" element={<ServersPage />} />
        <Route path="/servers/new" element={<PlaceholderPage name="Add Server" />} />
        <Route path="/servers/:id" element={<PlaceholderPage name="Server Details" />} />
        <Route path="/servers/:id/console/:vmid" element={<PlaceholderPage name="Console" />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/agent" element={<AgentPage />} />
        <Route path="/backups" element={<PlaceholderPage name="Backups" />} />
        <Route path="/backups/:id" element={<PlaceholderPage name="Backup Details" />} />
        <Route path="/configs" element={<PlaceholderPage name="Config Backups" />} />
        <Route path="/configs/:id" element={<PlaceholderPage name="Config Backup Details" />} />
        <Route path="/migrations" element={<PlaceholderPage name="Migrations" />} />
        <Route path="/migrations/new" element={<PlaceholderPage name="New Migration" />} />
        <Route path="/migrations/:id" element={<PlaceholderPage name="Migration Details" />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/tasks" element={<PlaceholderPage name="Tasks" />} />
        <Route path="/tools" element={<PlaceholderPage name="Agent Tools" />} />
        <Route path="/tools/bulk-command" element={<PlaceholderPage name="Bulk Command" />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/optimizer" element={<PlaceholderPage name="Optimizer" />} />
        <Route path="/tags" element={<PlaceholderPage name="Tags" />} />
        <Route path="/storage" element={<PlaceholderPage name="Storage" />} />
        <Route path="/history" element={<PlaceholderPage name="History" />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/library" element={<PlaceholderPage name="Library" />} />
        <Route path="/organs" element={<PlaceholderPage name="Organs (Agent Health)" />} />
        <Route path="/console" element={<PlaceholderPage name="Console Overview" />} />
        <Route path="/disaster-recovery" element={<PlaceholderPage name="Disaster Recovery" />} />
        <Route path="/jobs" element={<PlaceholderPage name="Jobs" />} />
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
    </BrowserRouter>
  );
}
