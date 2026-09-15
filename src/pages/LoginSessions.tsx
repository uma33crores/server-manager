import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { LoginSession } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Search, ChevronLeft, ChevronRight, LogIn, LogOut, CheckCircle2, XCircle, Monitor } from 'lucide-react';
import PageLoader from '@/components/PageLoader';

const PAGE_SIZE = 25;

const EVENT_OPTIONS = ['LOGIN', 'LOGOUT'];
const STATUS_OPTIONS = ['SUCCESS', 'FAILURE'];
const ROLE_OPTIONS = ['admin', 'user'];

export default function LoginSessions() {
  const { isAdmin } = useAuth();
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const [filters, setFilters] = useState({
    user_email: '',
    event_type: '',
    status: '',
    user_role: '',
    ip_address: '',
    from_date: '',
    to_date: '',
  });

  const loadSessions = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('login_sessions')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (filters.user_email) query = query.ilike('user_email', `%${filters.user_email}%`);
    if (filters.event_type) query = query.eq('event_type', filters.event_type);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.user_role) query = query.eq('user_role', filters.user_role);
    if (filters.ip_address) query = query.ilike('ip_address', `%${filters.ip_address}%`);
    if (filters.from_date) query = query.gte('created_at', filters.from_date);
    if (filters.to_date) query = query.lte('created_at', `${filters.to_date}T23:59:59`);

    query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const { data, count } = await query;
    setSessions((data as LoginSession[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [filters, page]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  function applyFilters() {
    setPage(0);
    loadSessions();
  }

  function clearFilters() {
    setFilters({ user_email: '', event_type: '', status: '', user_role: '', ip_address: '', from_date: '', to_date: '' });
    setPage(0);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilters = Object.values(filters).some((v) => v !== '');

  const stats = {
    total: total,
    logins: sessions.filter((s) => s.event_type === 'LOGIN').length,
    failures: sessions.filter((s) => s.status === 'FAILURE').length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Login Sessions</h1>
          <p className="text-sm text-text-muted mt-1">Track all login and logout activity</p>
        </div>
      </div>

      {!isAdmin && (
        <div className="mb-4 text-sm text-text-muted bg-surface-2 border border-border rounded-lg px-4 py-3">
          You can view your own login sessions. Admins can see all user sessions.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <LogIn className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            <span className="text-2xl font-bold text-text-primary">{total}</span>
          </div>
          <p className="text-sm text-text-muted">Total Events</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-2xl font-bold text-text-primary">{stats.logins}</span>
          </div>
          <p className="text-sm text-text-muted">Logins (this page)</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <span className="text-2xl font-bold text-text-primary">{stats.failures}</span>
          </div>
          <p className="text-sm text-text-muted">Failed (this page)</p>
        </div>
      </div>

      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">User Email</label>
            <input
              value={filters.user_email}
              onChange={(e) => setFilters({ ...filters, user_email: e.target.value })}
              placeholder="Search by email..."
              className="form-input"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Event Type</label>
            <select
              value={filters.event_type}
              onChange={(e) => setFilters({ ...filters, event_type: e.target.value })}
              className="form-input"
            >
              <option value="">All Events</option>
              {EVENT_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="form-input"
            >
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Role</label>
            <select
              value={filters.user_role}
              onChange={(e) => setFilters({ ...filters, user_role: e.target.value })}
              className="form-input"
            >
              <option value="">All Roles</option>
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">IP Address</label>
            <input
              value={filters.ip_address}
              onChange={(e) => setFilters({ ...filters, ip_address: e.target.value })}
              placeholder="Search by IP..."
              className="form-input"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">From Date</label>
            <input
              type="date"
              value={filters.from_date}
              onChange={(e) => setFilters({ ...filters, from_date: e.target.value })}
              className="form-input"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">To Date</label>
            <input
              type="date"
              value={filters.to_date}
              onChange={(e) => setFilters({ ...filters, to_date: e.target.value })}
              className="form-input"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={applyFilters}
              className="btn-primary btn-sm"
            >
              <Search className="w-3.5 h-3.5" /> Filter
            </button>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="btn-secondary btn-sm"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <PageLoader label="Fetching login sessions..." />
        ) : sessions.length === 0 ? (
          <div className="px-5 py-8 text-center text-text-muted">
            No login session records found{hasFilters ? ' matching your filters' : ''}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Role</th>
                  <th>Event</th>
                  <th>IP Address</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const uaShort = s.user_agent
                    ? s.user_agent.length > 50
                      ? s.user_agent.slice(0, 50) + '...'
                      : s.user_agent
                    : '-';
                  return (
                    <tr key={s.id} >
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                        {new Date(s.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-surface-hover flex items-center justify-center text-xs text-text-secondary font-medium">
                            {s.user_email[0]?.toUpperCase()}
                          </div>
                          <span className="text-text-primary">{s.user_email}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {s.user_role === 'admin' ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                            Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-surface-hover text-text-secondary">
                            User
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {s.event_type === 'LOGIN' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-sky-600 dark:text-sky-400">
                            <LogIn className="w-3.5 h-3.5" /> Login
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                            <LogOut className="w-3.5 h-3.5" /> Logout
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                        {s.ip_address ?? '-'}
                      </td>
                      <td className="px-4 py-3">
                        {s.status === 'SUCCESS' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Success
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                            <XCircle className="w-3.5 h-3.5" /> Failed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {s.failure_reason ? (
                          <span className="text-xs text-red-600 dark:text-red-400">{s.failure_reason}</span>
                        ) : (
                          <span className="text-xs text-text-faint inline-flex items-center gap-1" title={s.user_agent ?? undefined}>
                            <Monitor className="w-3 h-3" /> {uaShort}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-text-muted">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="btn-secondary btn-sm disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-text-muted">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="btn-secondary btn-sm disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
