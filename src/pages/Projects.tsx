import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { ProjectWithServer } from '@/lib/supabase';
import { StatusBadge } from '@/components/Badge';
import { Plus, Search, FolderGit2, CheckCircle2, Clock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/PageLoader';

export default function Projects() {
  const { isReadOnly } = useAuth();
  const [projects, setProjects] = useState<ProjectWithServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [envFilter, setEnvFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase
      .from('projects')
      .select('*, server:servers(id, name, environment)')
      .order('created_at', { ascending: false });
    setProjects((data as unknown as ProjectWithServer[]) ?? []);
    setLoading(false);
  }

  const filtered = projects.filter((p) => {
    if (search) {
      const q = search.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.slug.includes(q) && !(p.app_domain ?? '').includes(q)) return false;
    }
    if (envFilter && p.server?.environment !== envFilter) return false;
    if (statusFilter && p.status !== statusFilter) return false;
    return true;
  });

  if (loading) return <PageLoader label="Loading projects..." />;

  const running = projects.filter((p) => p.status === 'Running').length;
  const inSetup = projects.filter((p) => p.status === 'In Setup').length;

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">{projects.length} project{projects.length !== 1 ? 's' : ''} total</p>
        </div>
        {!isReadOnly && (
          <Link to="/projects/new" className="btn-primary">
            <Plus className="w-4 h-4" />
            Add Project
          </Link>
        )}
      </div>

      {projects.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="card p-4 flex items-center gap-3">
            <div className="stat-icon bg-sky-500/10 w-9 h-9">
              <FolderGit2 className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-text-primary leading-none">{projects.length}</div>
              <div className="text-xs text-text-muted mt-0.5">Total</div>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <div className="stat-icon bg-emerald-500/10 w-9 h-9">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-text-primary leading-none">{running}</div>
              <div className="text-xs text-text-muted mt-0.5">Running</div>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <div className="stat-icon bg-amber-500/10 w-9 h-9">
              <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-text-primary leading-none">{inSetup}</div>
              <div className="text-xs text-text-muted mt-0.5">In Setup</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, slug, or domain..."
            className="search-input"
          />
        </div>
        <select value={envFilter} onChange={(e) => setEnvFilter(e.target.value)} className="filter-select">
          <option value="">All Environments</option>
          <option value="testing">Testing</option>
          <option value="staging">Staging</option>
          <option value="production">Production</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="filter-select">
          <option value="">All Statuses</option>
          <option value="In Setup">In Setup</option>
          <option value="Running">Running</option>
          <option value="Stopped">Stopped</option>
          <option value="Archived">Archived</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <FolderGit2 className="w-7 h-7" />
            </div>
            <p className="text-text-muted text-sm">No projects found</p>
            <p className="text-text-faint text-xs mt-0.5">Try adjusting your search or filters</p>
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Server</th>
                  <th>Environment</th>
                  <th>Status</th>
                  <th>Slot</th>
                  <th>API</th>
                  <th>DB</th>
                  <th>Pooler</th>
                  <th>App Domain</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Link to={`/projects/${p.id}`} className="text-sky-600 dark:text-sky-400 hover:text-sky-500 font-medium">
                          {p.name}
                        </Link>
                        <span className="text-text-faint font-mono text-xs">{p.slug}</span>
                      </div>
                    </td>
                    <td>{p.server?.name ?? '-'}</td>
                    <td><StatusBadge status={p.server?.environment ?? ''} /></td>
                    <td><StatusBadge status={p.status} /></td>
                    <td><span className="font-mono text-text-secondary">{p.project_slot}</span></td>
                    <td><span className="font-mono text-text-secondary">{p.api_port}</span></td>
                    <td><span className="font-mono text-text-secondary">{p.db_port}</span></td>
                    <td><span className="font-mono text-text-secondary">{p.pooler_port}</span></td>
                    <td><span className="font-mono text-xs text-text-secondary">{p.app_domain ?? '-'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
