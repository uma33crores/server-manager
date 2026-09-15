import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useAdminReauth, formatCountdown } from '@/context/AdminReauthContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  LayoutDashboard,
  Server,
  FolderGit2,
  Network,
  KeyRound,
  Terminal,
  Settings,
  LogOut,
  Variable,
  ShieldCheck,
  ScrollText,
  MonitorSmartphone,
  Clock,
  AlertTriangle,
  Eye,
  Lock,
} from 'lucide-react';
import type { ReactNode } from 'react';

const mainNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/servers', label: 'Servers', icon: Server },
  { to: '/projects', label: 'Projects', icon: FolderGit2 },
];

const infraNav = [
  { to: '/ports', label: 'Port Registry', icon: Network },
  { to: '/variables', label: 'Variables', icon: Variable },
  { to: '/commands', label: 'Commands', icon: Terminal },
  { to: '/credentials', label: 'Credentials', icon: KeyRound },
];

const adminNav = [
  { to: '/admin', label: 'Admin Dashboard', icon: ShieldCheck },
  { to: '/audit-logs', label: 'Audit Logs', icon: ScrollText },
  { to: '/login-sessions', label: 'Login Sessions', icon: MonitorSmartphone },
  { to: '/secret-credentials', label: 'Secret Credentials', icon: Lock },
];

type NavItem = { to: string; label: string; icon: typeof Server };

function NavSection({ label, items }: { label: string; items: NavItem[] }) {
  const location = useLocation();
  return (
    <div className="mb-1">
      <p className="px-4 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-faint">
        {label}
      </p>
      <div className="space-y-0.5 px-2">
        {items.map((item) => {
          const isActive =
            item.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.to);
          const isAdminRoute = item.to === '/admin';
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
                isActive
                  ? isAdminRoute
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-sky-600 dark:text-sky-400'
                  : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              {isActive && (
                <span
                  className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full ${
                    isAdminRoute ? 'bg-emerald-500' : 'bg-sky-500'
                  }`}
                />
              )}
              <span
                className={`absolute inset-0 rounded-lg transition-opacity ${
                  isActive
                    ? isAdminRoute
                      ? 'bg-emerald-500/10 opacity-100'
                      : 'bg-sky-500/10 opacity-100'
                    : 'bg-surface-hover opacity-0 group-hover:opacity-100'
                }`}
              />
              <item.icon
                className={`relative w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                  isActive
                    ? isAdminRoute
                      ? 'text-emerald-500'
                      : 'text-sky-500'
                    : 'text-text-faint group-hover:text-text-secondary'
                }`}
              />
              <span className="relative truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, signOut, isAdmin, isReadOnly } = useAuth();
  const { timeRemainingMs, reauthExpired } = useAdminReauth();

  const isUrgent = timeRemainingMs > 0 && timeRemainingMs <= 5 * 60 * 1000;
  const isExpired = reauthExpired || timeRemainingMs <= 0;

  return (
    <div className="h-screen bg-surface flex overflow-hidden">
      <aside className="w-64 h-screen bg-surface-2 border-r border-border flex flex-col flex-shrink-0 fixed left-0 top-0 z-30">
        {/* Brand */}
        <div className="px-5 h-16 flex items-center border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center shadow-sm shadow-sky-500/20">
              <Server className="w-4.5 h-4.5 text-white" strokeWidth={2.5} />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[15px] font-bold text-text-primary tracking-tight">Server Manager</span>
              <span className="text-[10px] text-text-faint font-medium mt-0.5">Infrastructure Console</span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-1">
          <NavSection label="Overview" items={mainNav} />
          <NavSection label="Infrastructure" items={infraNav} />
          {isAdmin && <NavSection label="Administration" items={adminNav} />}
        </nav>

        {/* Bottom section */}
        <div className="flex-shrink-0 border-t border-border px-3 py-3 space-y-2">
          {/* Re-verification timer */}
          {timeRemainingMs > 0 || isExpired ? (
            <div
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-xs transition-colors ${
                isExpired
                  ? 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
                  : isUrgent
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                    : 'bg-surface-hover border-border text-text-secondary'
              }`}
            >
              {isExpired ? (
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              ) : (
                <Clock className="w-4 h-4 flex-shrink-0" />
              )}
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-medium opacity-80">
                  {isExpired ? 'Session Expired' : 'Re-verify in'}
                </span>
                {!isExpired && (
                  <span className="text-sm font-mono font-bold tabular-nums leading-tight">
                    {formatCountdown(timeRemainingMs)}
                  </span>
                )}
              </div>
            </div>
          ) : null}

          {/* User + actions row */}
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-xs text-white font-semibold flex-shrink-0">
              {(user?.email ?? '?')[0].toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-medium text-text-secondary truncate leading-tight">{user?.email}</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-text-faint capitalize">
                  {isAdmin ? 'Admin' : 'User'}
                </span>
                {isReadOnly && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                    <Eye className="w-2.5 h-2.5" />
                    Read Only
                  </span>
                )}
              </div>
            </div>
            <ThemeToggle />
            <button
              onClick={signOut}
              title="Sign Out"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content - only this scrolls */}
      <main className="flex-1 h-screen overflow-y-auto overflow-x-auto ml-64">
        <div className="p-6 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}
