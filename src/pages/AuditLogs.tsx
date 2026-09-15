import { useEffect, useState, useCallback, Fragment } from 'react';
import { supabase } from '@/lib/supabase';
import type { AuditLog } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Search, ChevronLeft, ChevronRight, ShieldCheck, XCircle } from 'lucide-react';
import PageLoader from '@/components/PageLoader';

const PAGE_SIZE = 25;

const ACTION_OPTIONS = [
  'SERVER_CREATED', 'SERVER_UPDATED', 'SERVER_DELETED',
  'PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_DELETED',
  'USER_CREATED', 'USER_UPDATED', 'USER_DELETED',
  'OTP_REAUTH_REQUESTED', 'OTP_REAUTH_SUCCESS', 'OTP_REAUTH_FAILED',
];

const ENTITY_OPTIONS = ['SERVER', 'PROJECT', 'USER'];
const STATUS_OPTIONS = ['SUCCESS', 'FAILURE'];

export default function AuditLogs() {
  const { isAdmin } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const [filters, setFilters] = useState({
    admin_email: '',
    action: '',
    entity_type: '',
    entity_id: '',
    status: '',
    from_date: '',
    to_date: '',
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (filters.admin_email) {
      query = query.ilike('admin_email', `%${filters.admin_email}%`);
    }
    if (filters.action) query = query.eq('action', filters.action);
    if (filters.entity_type) query = query.eq('entity_type', filters.entity_type);
    if (filters.entity_id) query = query.ilike('entity_id', `%${filters.entity_id}%`);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.from_date) query = query.gte('created_at', filters.from_date);
    if (filters.to_date) query = query.lte('created_at', `${filters.to_date}T23:59:59`);

    query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const { data, count } = await query;
    setLogs((data as AuditLog[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [filters, page]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  function applyFilters() {
    setPage(0);
    loadLogs();
  }

  function clearFilters() {
    setFilters({ admin_email: '', action: '', entity_type: '', entity_id: '', status: '', from_date: '', to_date: '' });
    setPage(0);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilters = Object.values(filters).some((v) => v !== '');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Audit Logs</h1>
          <p className="text-sm text-text-muted mt-1">Track all administrative actions</p>
        </div>
      </div>

      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Admin Email</label>
            <input
              value={filters.admin_email}
              onChange={(e) => setFilters({ ...filters, admin_email: e.target.value })}
              placeholder="Search by email..."
              className="form-input"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Action</label>
            <select
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              className="form-input"
            >
              <option value="">All Actions</option>
              {ACTION_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Entity Type</label>
            <select
              value={filters.entity_type}
              onChange={(e) => setFilters({ ...filters, entity_type: e.target.value })}
              className="form-input"
            >
              <option value="">All Types</option>
              {ENTITY_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Entity ID</label>
            <input
              value={filters.entity_id}
              onChange={(e) => setFilters({ ...filters, entity_id: e.target.value })}
              placeholder="Search by ID..."
              className="form-input"
            />
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
          <PageLoader label="Fetching audit logs..." />
        ) : logs.length === 0 ? (
          <div className="px-5 py-8 text-center text-text-muted">
            No audit log entries found{hasFilters ? ' matching your filters' : ''}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Admin</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <Fragment key={log.id}>
                    <tr
                      className="cursor-pointer"
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    >
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{log.admin_email}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-text-primary">{log.action}</span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        <span className="text-xs">{log.entity_type}</span>
                        {log.entity_id && (
                          <span className="text-xs text-text-faint ml-1 font-mono truncate max-w-[120px] inline-block align-bottom">
                            {log.entity_id.slice(0, 8)}...
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {log.status === 'SUCCESS' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                            <ShieldCheck className="w-3.5 h-3.5" /> Success
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                            <XCircle className="w-3.5 h-3.5" /> Failed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-muted text-xs">
                        {log.changes ? `${Object.keys(log.changes).length} field(s)` : log.failure_reason ?? '-'}
                      </td>
                    </tr>
                    {expandedId === log.id && (
                      <tr className="border-b border-border bg-surface">
                        <td colSpan={6} className="px-4 py-4">
                          <div className="space-y-3">
                            {log.changes && (
                              <div>
                                <p className="text-xs font-medium text-text-muted mb-2">Changed Fields:</p>
                                <div className="space-y-1.5">
                                  {Object.entries(log.changes).map(([field, change]) => (
                                    <div key={field} className="flex items-start gap-3 text-xs">
                                      <span className="font-mono text-sky-600 dark:text-sky-400 w-40 flex-shrink-0">{field}</span>
                                      <span className="text-text-muted line-through">
                                        {String((change as { old: unknown }).old ?? '-')}
                                      </span>
                                      <span className="text-text-faint">→</span>
                                      <span className="text-text-secondary font-medium">
                                        {String((change as { new: unknown }).new ?? '-')}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {log.failure_reason && (
                              <div>
                                <p className="text-xs font-medium text-text-muted mb-1">Failure Reason:</p>
                                <p className="text-xs text-red-600 dark:text-red-400">{log.failure_reason}</p>
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-4 text-xs">
                              <div>
                                <span className="text-text-faint">Admin ID: </span>
                                <span className="font-mono text-text-muted">{log.admin_id}</span>
                              </div>
                              <div>
                                <span className="text-text-faint">Log ID: </span>
                                <span className="font-mono text-text-muted">{log.id}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
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
