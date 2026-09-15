import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Server, Project, PortAllocationWithProject } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { StatusBadge } from '@/components/Badge';
import CopyButton from '@/components/CopyButton';
import Modal from '@/components/Modal';
import { ArrowLeft, Plus, Pencil, AlertCircle, ShieldCheck, LayoutGrid, Server as ServerIcon, Network, FileText, KeyRound } from 'lucide-react';
import { ENVIRONMENTS } from '@/lib/constants';
import PageLoader from '@/components/PageLoader';
import Pagination from '@/components/Pagination';
import DocumentsSection from '@/components/DocumentsSection';
import ServerCredentialsSection from '@/components/ServerCredentialsSection';

type EditForm = {
  name: string;
  environment: string;
  provider: string;
  public_ip: string;
  hostname: string;
  ssh_username: string;
  ssh_port: string;
  operating_system: string;
  region: string;
  ram: string;
  disk: string;
  supabase_template_directory: string;
  supabase_instances_directory: string;
  frontend_apps_directory: string;
  nginx_sites_available: string;
  nginx_sites_enabled: string;
  notes: string;
};

type Tab = 'overview' | 'projects' | 'ports' | 'documents' | 'credentials';

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin, isReadOnly } = useAuth();
  const [server, setServer] = useState<Server | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [ports, setPorts] = useState<PortAllocationWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [portPage, setPortPage] = useState(1);
  const [portPageSize, setPortPageSize] = useState(10);

  useEffect(() => {
    if (!id) return;
    load();
  }, [id]);

  async function load() {
    if (!id) return;
    const { data: s } = await supabase.from('servers').select('*').eq('id', id).maybeSingle();
    setServer(s as Server | null);
    const { data: p } = await supabase
      .from('projects')
      .select('*')
      .eq('server_id', id)
      .order('project_slot', { ascending: true });
    setProjects((p as Project[]) ?? []);
    const { data: pa } = await supabase
      .from('port_allocations')
      .select('*, project:projects(id, name, slug)')
      .eq('server_id', id)
      .order('project_slot', { ascending: true });
    setPorts((pa as unknown as PortAllocationWithProject[]) ?? []);
    setLoading(false);
  }

  function openEdit() {
    if (!server) return;
    setError(null);
    setSuccess(null);
    setEditForm({
      name: server.name,
      environment: server.environment,
      provider: server.provider ?? '',
      public_ip: server.public_ip ?? '',
      hostname: server.hostname ?? '',
      ssh_username: server.ssh_username ?? '',
      ssh_port: String(server.ssh_port),
      operating_system: server.operating_system ?? '',
      region: server.region ?? '',
      ram: server.ram ?? '',
      disk: server.disk ?? '',
      supabase_template_directory: server.supabase_template_directory,
      supabase_instances_directory: server.supabase_instances_directory,
      frontend_apps_directory: server.frontend_apps_directory,
      nginx_sites_available: server.nginx_sites_available,
      nginx_sites_enabled: server.nginx_sites_enabled,
      notes: server.notes ?? '',
    });
    setShowEdit(true);
  }

  function validate(form: EditForm): string | null {
    if (!form.name.trim()) return 'Server name is required';
    if (!form.environment) return 'Environment is required';
    const port = parseInt(form.ssh_port, 10);
    if (isNaN(port) || port < 1 || port > 65535) return 'SSH port must be between 1 and 65535';
    if (form.public_ip && !/^[\d.]+$/.test(form.public_ip)) return 'Public IP contains invalid characters';
    return null;
  }

  async function handleSave() {
    if (!editForm || !id) return;
    const validationError = validate(editForm);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const updates: Record<string, string> = {};
      if (editForm.name !== server!.name) updates.name = editForm.name;
      if (editForm.provider !== (server!.provider ?? '')) updates.provider = editForm.provider || '';
      if (editForm.public_ip !== (server!.public_ip ?? '')) updates.public_ip = editForm.public_ip || '';
      if (editForm.hostname !== (server!.hostname ?? '')) updates.hostname = editForm.hostname || '';
      if (editForm.ssh_username !== (server!.ssh_username ?? '')) updates.ssh_username = editForm.ssh_username || '';
      if (editForm.ssh_port !== String(server!.ssh_port)) updates.ssh_port = editForm.ssh_port;
      if (editForm.operating_system !== (server!.operating_system ?? '')) updates.operating_system = editForm.operating_system || '';
      if (editForm.region !== (server!.region ?? '')) updates.region = editForm.region || '';
      if (editForm.ram !== (server!.ram ?? '')) updates.ram = editForm.ram || '';
      if (editForm.disk !== (server!.disk ?? '')) updates.disk = editForm.disk || '';
      if (editForm.supabase_template_directory !== server!.supabase_template_directory) updates.supabase_template_directory = editForm.supabase_template_directory;
      if (editForm.supabase_instances_directory !== server!.supabase_instances_directory) updates.supabase_instances_directory = editForm.supabase_instances_directory;
      if (editForm.frontend_apps_directory !== server!.frontend_apps_directory) updates.frontend_apps_directory = editForm.frontend_apps_directory;
      if (editForm.nginx_sites_available !== server!.nginx_sites_available) updates.nginx_sites_available = editForm.nginx_sites_available;
      if (editForm.nginx_sites_enabled !== server!.nginx_sites_enabled) updates.nginx_sites_enabled = editForm.nginx_sites_enabled;
      if (editForm.notes !== (server!.notes ?? '')) updates.notes = editForm.notes || '';

      if (Object.keys(updates).length === 0) {
        setShowEdit(false);
        setSaving(false);
        return;
      }

      const { data, error: rpcError } = await supabase.rpc('admin_update_server', {
        p_server_id: id,
        p_updates: updates,
      });

      if (rpcError) {
        if (rpcError.message.includes('OTP_VERIFICATION_REQUIRED')) {
          setError('Your re-verification session has expired. Please re-verify to save changes.');
        } else if (rpcError.message.includes('UNAUTHORIZED')) {
          setError('You are not authorized to perform this action.');
        } else {
          setError(rpcError.message);
        }
        setSaving(false);
        return;
      }

      if (data && !(data as { updated?: boolean }).updated) {
        setError('No changes were applied.');
        setSaving(false);
        return;
      }

      setSuccess('Server updated successfully.');
      setShowEdit(false);
      await load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageLoader label="Loading server..." />;
  if (!server) return <div className="text-text-muted">Server not found</div>;

  const paths = [
    { label: 'Supabase Template Directory', value: server.supabase_template_directory },
    { label: 'Supabase Instances Directory', value: server.supabase_instances_directory },
    { label: 'Frontend Applications Directory', value: server.frontend_apps_directory },
    { label: 'Nginx Available', value: server.nginx_sites_available },
    { label: 'Nginx Enabled', value: server.nginx_sites_enabled },
  ];

  return (
    <div>
      <Link to="/servers" className="flex items-center gap-2 text-text-muted hover:text-text-primary text-sm mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to Servers
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{server.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <StatusBadge status={server.environment} />
            {server.provider && <span className="text-sm text-text-muted">{server.provider}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && !isReadOnly && (
            <button
              onClick={openEdit}
              className="btn-secondary"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit Server
            </button>
          )}
          {!isReadOnly && (
            <Link
              to={`/projects/new?server=${server.id}`}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              Add Project
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="alert-error mb-4">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">x</button>
        </div>
      )}
      {success && (
        <div className="alert-success mb-4">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      <div className="tab-bar">
        {([
          { id: 'overview' as Tab, label: 'Overview', icon: LayoutGrid },
          { id: 'projects' as Tab, label: 'Projects', icon: ServerIcon },
          { id: 'ports' as Tab, label: 'Port Registry', icon: Network },
          { id: 'documents' as Tab, label: 'Documents', icon: FileText },
          { id: 'credentials' as Tab, label: 'Credentials', icon: KeyRound },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`tab-button ${
              tab === t.id
                ? 'tab-button-active'
                : 'tab-button-inactive'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-5">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Server Information</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Server ID" value={server.id} mono />
              <Row label="Public IP" value={server.public_ip} mono copy />
              <Row label="Hostname" value={server.hostname} mono />
              <Row label="SSH Username" value={server.ssh_username} mono />
              <Row label="SSH Port" value={String(server.ssh_port)} mono />
              <Row label="OS" value={server.operating_system} />
              <Row label="Region" value={server.region} />
              <Row label="RAM" value={server.ram} />
              <Row label="Disk" value={server.disk} />
            </dl>
            {server.notes && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-sm text-text-muted whitespace-pre-wrap">{server.notes}</p>
              </div>
            )}
          </div>

          <div className="card p-5">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Shared Paths</h2>
            <dl className="space-y-2 text-sm">
              {paths.map((p) => (
                <div key={p.label} className="flex items-center justify-between gap-2">
                  <dt className="text-text-muted flex-shrink-0">{p.label}</dt>
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="font-mono text-xs text-text-secondary truncate">{p.value}</code>
                    <CopyButton value={p.value} />
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {tab === 'projects' && (
        <div className="card p-5">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Projects ({projects.length})</h2>
          {projects.length === 0 ? (
            <p className="text-text-muted text-sm">No projects on this server yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Slot</th>
                    <th>API</th>
                    <th>DB</th>
                    <th>Pooler</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/projects/${p.id}`} className="text-sky-600 dark:text-sky-400 hover:text-sky-500 font-medium">
                          {p.name}
                        </Link>
                        <span className="text-text-faint ml-2 font-mono text-xs">{p.slug}</span>
                      </td>
                      <td><span className="font-mono text-text-secondary">{p.project_slot}</span></td>
                      <td><span className="font-mono text-text-secondary">{p.api_port}</span></td>
                      <td><span className="font-mono text-text-secondary">{p.db_port}</span></td>
                      <td><span className="font-mono text-text-secondary">{p.pooler_port}</span></td>
                      <td><StatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'ports' && (() => {
        const totalPages = Math.max(1, Math.ceil(ports.length / portPageSize));
        const currentPage = Math.min(portPage, totalPages);
        const startIdx = (currentPage - 1) * portPageSize;
        const pagedPorts = ports.slice(startIdx, startIdx + portPageSize);
        return (
          <div className="card overflow-hidden">
            <div className="p-5 pb-0">
              <h2 className="text-lg font-semibold text-text-primary mb-4">Port Registry</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th>API Port</th>
                    <th>DB Port</th>
                    <th>Pooler Port</th>
                    <th>Status</th>
                    <th>Project</th>
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
                          <Link to={`/projects/${pa.project.id}`} className="text-sky-600 dark:text-sky-400 hover:text-sky-500">
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
              pageSize={portPageSize}
              total={ports.length}
              onPageChange={setPortPage}
              onPageSizeChange={(s) => { setPortPageSize(s); setPortPage(1); }}
            />
          </div>
        );
      })()}

      {tab === 'documents' && (
        <DocumentsSection serverId={server.id} />
      )}

      {tab === 'credentials' && (
        <ServerCredentialsSection serverId={server.id} />
      )}

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Server" size="lg">
        {error && (
          <div className="alert-error mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
        {editForm && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Server Name" required>
              <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="form-input" />
            </Field>
            <Field label="Environment">
              <select value={editForm.environment} onChange={(e) => setEditForm({ ...editForm, environment: e.target.value })} className="form-input">
                {ENVIRONMENTS.map((env) => (
                  <option key={env} value={env}>{env.charAt(0).toUpperCase() + env.slice(1)}</option>
                ))}
              </select>
            </Field>
            <Field label="Provider">
              <input value={editForm.provider} onChange={(e) => setEditForm({ ...editForm, provider: e.target.value })} className="form-input" />
            </Field>
            <Field label="Public IP">
              <input value={editForm.public_ip} onChange={(e) => setEditForm({ ...editForm, public_ip: e.target.value })} className="form-input font-mono" />
            </Field>
            <Field label="Hostname">
              <input value={editForm.hostname} onChange={(e) => setEditForm({ ...editForm, hostname: e.target.value })} className="form-input font-mono" />
            </Field>
            <Field label="SSH Username">
              <input value={editForm.ssh_username} onChange={(e) => setEditForm({ ...editForm, ssh_username: e.target.value })} className="form-input font-mono" />
            </Field>
            <Field label="SSH Port">
              <input value={editForm.ssh_port} onChange={(e) => setEditForm({ ...editForm, ssh_port: e.target.value.replace(/\D/g, '') })} className="form-input font-mono" />
            </Field>
            <Field label="Operating System">
              <input value={editForm.operating_system} onChange={(e) => setEditForm({ ...editForm, operating_system: e.target.value })} className="form-input" />
            </Field>
            <Field label="Region">
              <input value={editForm.region} onChange={(e) => setEditForm({ ...editForm, region: e.target.value })} className="form-input" />
            </Field>
            <Field label="RAM">
              <input value={editForm.ram} onChange={(e) => setEditForm({ ...editForm, ram: e.target.value })} className="form-input" />
            </Field>
            <Field label="Disk">
              <input value={editForm.disk} onChange={(e) => setEditForm({ ...editForm, disk: e.target.value })} className="form-input" />
            </Field>
            <Field label="Supabase Template Dir">
              <input value={editForm.supabase_template_directory} onChange={(e) => setEditForm({ ...editForm, supabase_template_directory: e.target.value })} className="form-input font-mono text-sm" />
            </Field>
            <Field label="Supabase Instances Dir">
              <input value={editForm.supabase_instances_directory} onChange={(e) => setEditForm({ ...editForm, supabase_instances_directory: e.target.value })} className="form-input font-mono text-sm" />
            </Field>
            <Field label="Frontend Apps Dir">
              <input value={editForm.frontend_apps_directory} onChange={(e) => setEditForm({ ...editForm, frontend_apps_directory: e.target.value })} className="form-input font-mono text-sm" />
            </Field>
            <Field label="Nginx Sites Available">
              <input value={editForm.nginx_sites_available} onChange={(e) => setEditForm({ ...editForm, nginx_sites_available: e.target.value })} className="form-input font-mono text-sm" />
            </Field>
            <Field label="Nginx Sites Enabled">
              <input value={editForm.nginx_sites_enabled} onChange={(e) => setEditForm({ ...editForm, nginx_sites_enabled: e.target.value })} className="form-input font-mono text-sm" />
            </Field>
            <Field label="Notes" full>
              <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className="form-input" rows={3} />
            </Field>
          </div>
        )}
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setShowEdit(false)} className="btn-ghost">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, children, required, full }: { label: string; children: React.ReactNode; required?: boolean; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="form-label">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function Row({ label, value, mono, copy }: { label: string; value: string | null; mono?: boolean; copy?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-text-muted flex-shrink-0">{label}</dt>
      <div className="flex items-center gap-2 min-w-0">
        <dd className={mono ? 'font-mono text-text-secondary' : 'text-text-secondary'}>{value || '-'}</dd>
        {copy && value && <CopyButton value={value} />}
      </div>
    </div>
  );
}
