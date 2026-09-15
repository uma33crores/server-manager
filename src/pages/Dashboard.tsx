import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { ProjectWithServer } from '@/lib/supabase';
import { StatusBadge } from '@/components/Badge';
import CopyButton from '@/components/CopyButton';
import {
  Server as ServerIcon,
  FolderGit2,
  Network,
  Terminal,
  Variable,
  CheckCircle2,
  Clock,
  CircleDot,
  ArrowRight,
} from 'lucide-react';
import PageLoader from '@/components/PageLoader';

type Stats = {
  totalServers: number;
  testingServers: number;
  stagingServers: number;
  productionServers: number;
  totalProjects: number;
  runningProjects: number;
  inSetupProjects: number;
  availablePorts: number;
  savedCommands: number;
  savedVariables: number;
};

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentProjects, setRecentProjects] = useState<ProjectWithServer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [
        { count: totalServers },
        { count: testingServers },
        { count: stagingServers },
        { count: productionServers },
        { count: totalProjects },
        { count: runningProjects },
        { count: inSetupProjects },
        { count: availablePorts },
        { count: savedCommands },
        { count: savedVariables },
      ] = await Promise.all([
        supabase.from('servers').select('*', { count: 'exact', head: true }),
        supabase.from('servers').select('*', { count: 'exact', head: true }).eq('environment', 'testing'),
        supabase.from('servers').select('*', { count: 'exact', head: true }).eq('environment', 'staging'),
        supabase.from('servers').select('*', { count: 'exact', head: true }).eq('environment', 'production'),
        supabase.from('projects').select('*', { count: 'exact', head: true }),
        supabase.from('projects').select('*', { count: 'exact', head: true }).eq('status', 'Running'),
        supabase.from('projects').select('*', { count: 'exact', head: true }).eq('status', 'In Setup'),
        supabase.from('port_allocations').select('*', { count: 'exact', head: true }).eq('status', 'available'),
        supabase.from('commands').select('*', { count: 'exact', head: true }),
        supabase.from('config_variables').select('*', { count: 'exact', head: true }),
      ]);

      setStats({
        totalServers: totalServers ?? 0,
        testingServers: testingServers ?? 0,
        stagingServers: stagingServers ?? 0,
        productionServers: productionServers ?? 0,
        totalProjects: totalProjects ?? 0,
        runningProjects: runningProjects ?? 0,
        inSetupProjects: inSetupProjects ?? 0,
        availablePorts: availablePorts ?? 0,
        savedCommands: savedCommands ?? 0,
        savedVariables: savedVariables ?? 0,
      });

      const { data } = await supabase
        .from('projects')
        .select('*, server:servers(id, name, environment)')
        .order('created_at', { ascending: false })
        .limit(10);

      setRecentProjects((data as unknown as ProjectWithServer[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <PageLoader label="Loading dashboard..." />;

  const primaryCards = [
    { label: 'Total Servers', value: stats?.totalServers ?? 0, icon: ServerIcon, bg: 'bg-sky-500/10', color: 'text-sky-600 dark:text-sky-400', link: '/servers' },
    { label: 'Total Projects', value: stats?.totalProjects ?? 0, icon: FolderGit2, bg: 'bg-emerald-500/10', color: 'text-emerald-600 dark:text-emerald-400', link: '/projects' },
    { label: 'Available Ports', value: stats?.availablePorts ?? 0, icon: Network, bg: 'bg-amber-500/10', color: 'text-amber-600 dark:text-amber-400', link: '/ports' },
  ];

  const secondaryCards = [
    { label: 'Running', value: stats?.runningProjects ?? 0, icon: CheckCircle2, bg: 'bg-emerald-500/10', color: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'In Setup', value: stats?.inSetupProjects ?? 0, icon: Clock, bg: 'bg-amber-500/10', color: 'text-amber-600 dark:text-amber-400' },
    { label: 'Testing Servers', value: stats?.testingServers ?? 0, icon: ServerIcon, bg: 'bg-sky-500/10', color: 'text-sky-600 dark:text-sky-400' },
    { label: 'Staging Servers', value: stats?.stagingServers ?? 0, icon: ServerIcon, bg: 'bg-amber-500/10', color: 'text-amber-600 dark:text-amber-400' },
    { label: 'Production Servers', value: stats?.productionServers ?? 0, icon: ServerIcon, bg: 'bg-emerald-500/10', color: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Commands', value: stats?.savedCommands ?? 0, icon: Terminal, bg: 'bg-surface-hover', color: 'text-text-secondary' },
    { label: 'Variables', value: stats?.savedVariables ?? 0, icon: Variable, bg: 'bg-surface-hover', color: 'text-text-secondary' },
  ];

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Infrastructure overview at a glance</p>
        </div>
      </div>

      {/* Primary stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        {primaryCards.map((c) => (
          <Link key={c.label} to={c.link} className="card-hover p-5 group">
            <div className="flex items-center gap-4">
              <div className={`stat-icon ${c.bg}`}>
                <c.icon className={`w-5 h-5 ${c.color}`} />
              </div>
              <div className="flex-1">
                <div className="stat-value">{c.value}</div>
                <div className="stat-label">{c.label}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-text-faint group-hover:text-text-secondary transition-colors" />
            </div>
          </Link>
        ))}
      </div>

      {/* Secondary stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {secondaryCards.map((c) => (
          <div key={c.label} className="card p-4">
            <div className={`stat-icon ${c.bg} w-9 h-9 mb-3`}>
              <c.icon className={`w-4 h-4 ${c.color}`} />
            </div>
            <div className="text-xl font-bold text-text-primary leading-none">{c.value}</div>
            <div className="text-xs text-text-muted mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Recent projects table */}
      <div className="card overflow-hidden">
        <div className="card-header flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Recent Projects</h2>
            <p className="text-xs text-text-faint mt-0.5">Latest 10 projects across all servers</p>
          </div>
          <Link to="/projects" className="btn-ghost btn-sm">
            View All
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {recentProjects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <FolderGit2 className="w-7 h-7" />
            </div>
            <p className="text-text-muted text-sm mb-1">No projects yet</p>
            <p className="text-text-faint text-xs">Create your first project to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Server</th>
                  <th>Environment</th>
                  <th>Status</th>
                  <th>App Domain</th>
                  <th>Supabase Domain</th>
                  <th>API</th>
                  <th>DB</th>
                  <th>Pooler</th>
                </tr>
              </thead>
              <tbody>
                {recentProjects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/projects/${p.id}`}
                          className="text-sky-600 dark:text-sky-400 hover:text-sky-500 font-medium"
                        >
                          {p.name}
                        </Link>
                        <span className="text-text-faint font-mono text-xs">{p.slug}</span>
                      </div>
                    </td>
                    <td>{p.server?.name ?? '-'}</td>
                    <td><StatusBadge status={p.server?.environment ?? ''} /></td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>
                      {p.app_domain ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-text-secondary">{p.app_domain}</span>
                          <CopyButton value={p.app_domain} />
                        </div>
                      ) : (
                        <span className="text-text-faint">-</span>
                      )}
                    </td>
                    <td>
                      {p.supabase_domain ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-text-secondary">{p.supabase_domain}</span>
                          <CopyButton value={p.supabase_domain} />
                        </div>
                      ) : (
                        <span className="text-text-faint">-</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <CircleDot className="w-3 h-3 text-sky-500" />
                        <span className="font-mono text-text-secondary">{p.api_port}</span>
                      </div>
                    </td>
                    <td><span className="font-mono text-text-secondary">{p.db_port}</span></td>
                    <td><span className="font-mono text-text-secondary">{p.pooler_port}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
