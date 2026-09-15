import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Server, PortAllocationWithProject } from '@/lib/supabase';
import { StatusBadge } from '@/components/Badge';
import { Network, Server as ServerIcon, CheckCircle2, Clock, XCircle } from 'lucide-react';
import PageLoader from '@/components/PageLoader';
import Pagination from '@/components/Pagination';

export default function PortRegistry() {
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServer, setSelectedServer] = useState<string>('');
  const [ports, setPorts] = useState<PortAllocationWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('servers').select('*').order('name');
      const s = (data as Server[]) ?? [];
      setServers(s);
      if (s.length > 0) setSelectedServer(s[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!selectedServer) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('port_allocations')
        .select('*, project:projects(id, name, slug)')
        .eq('server_id', selectedServer)
        .order('project_slot', { ascending: true });
      setPorts((data as unknown as PortAllocationWithProject[]) ?? []);
      setPage(1);
      setLoading(false);
    })();
  }, [selectedServer]);

  const available = ports.filter((p) => p.status === 'available').length;
  const assigned = ports.filter((p) => p.status === 'assigned').length;
  const reserved = ports.filter((p) => p.status === 'reserved').length;

  const totalPages = Math.max(1, Math.ceil(ports.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const pagedPorts = ports.slice(startIdx, startIdx + pageSize);

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Port Registry</h1>
          <p className="page-subtitle">Manage port allocations across servers</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="stat-icon bg-surface-hover w-10 h-10">
          <Network className="w-5 h-5 text-text-secondary" />
        </div>
        <select
          value={selectedServer}
          onChange={(e) => setSelectedServer(e.target.value)}
          className="filter-select min-w-[240px]"
        >
          {servers.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.environment})</option>
          ))}
        </select>
      </div>

      {loading ? (
        <PageLoader label="Fetching port data..." />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="card p-4 flex items-center gap-3">
              <div className="stat-icon bg-surface-hover w-9 h-9">
                <CheckCircle2 className="w-4 h-4 text-text-secondary" />
              </div>
              <div>
                <div className="text-xl font-bold text-text-primary leading-none">{available}</div>
                <div className="text-xs text-text-muted mt-0.5">Available</div>
              </div>
            </div>
            <div className="card p-4 flex items-center gap-3">
              <div className="stat-icon bg-emerald-500/10 w-9 h-9">
                <ServerIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <div className="text-xl font-bold text-text-primary leading-none">{assigned}</div>
                <div className="text-xs text-text-muted mt-0.5">Assigned</div>
              </div>
            </div>
            <div className="card p-4 flex items-center gap-3">
              <div className="stat-icon bg-amber-500/10 w-9 h-9">
                <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <div className="text-xl font-bold text-text-primary leading-none">{reserved}</div>
                <div className="text-xs text-text-muted mt-0.5">Reserved</div>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th>API Port</th>
                    <th>DB Port</th>
                    <th>Pooler Port</th>
                    <th>Status</th>
                    <th>Assigned Project</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedPorts.map((pa) => (
                    <tr key={pa.id}>
                      <td><span className="font-mono text-text-secondary">{pa.project_slot}</span></td>
                      <td><span className="font-mono text-text-secondary">{pa.api_port}</span></td>
                      <td><span className="font-mono text-text-secondary">{pa.db_port}</span></td>
                      <td><span className="font-mono text-text-secondary">{pa.pooler_port}</span></td>
                      <td><StatusBadge status={pa.status} /></td>
                      <td>
                        {pa.project ? (
                          <Link to={`/projects/${pa.project.id}`} className="text-sky-600 dark:text-sky-400 hover:text-sky-500 font-medium">
                            {pa.project.name}
                          </Link>
                        ) : (
                          <span className="text-text-faint">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={currentPage}
              pageSize={pageSize}
              total={ports.length}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            />
          </div>
        </>
      )}
    </div>
  );
}
