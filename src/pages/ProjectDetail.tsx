import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Project, Server, ProjectSetupStep, ProjectSetupStepWithCommands, ConfigVariable, Credential, Note, CommandWithRelations } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { StatusBadge } from '@/components/Badge';
import CopyButton from '@/components/CopyButton';
import SensitiveValue from '@/components/SensitiveValue';
import Modal from '@/components/Modal';
import { getSystemVariables, resolveCommand, normalizeKey, isReservedKey } from '@/lib/utils';
import { PROJECT_STATUSES } from '@/lib/constants';
import {
  ArrowLeft,
  ExternalLink,
  Plus,
  Check,
  Copy,
  Trash2,
  Pencil,
  Save,
  AlertCircle,
  FileText,
  Terminal,
  KeyRound,
  StickyNote,
  LayoutGrid,
  ListChecks,
  Variable,
  ShieldCheck,
  Github,
  Rocket,
  Settings,
} from 'lucide-react';
import PageLoader from '@/components/PageLoader';
import ConfirmDialog from '@/components/ConfirmDialog';
import ProjectDocumentsSection from '@/components/ProjectDocumentsSection';
import DeploymentPanel from '@/components/DeploymentPanel';

type Tab = 'overview' | 'setup' | 'deployments' | 'environment' | 'credentials' | 'commands' | 'notes' | 'documents' | 'settings';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [server, setServer] = useState<Server | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);

  async function refreshProject() {
    if (!id) return;
    const { data: p } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
    setProject(p as Project | null);
    if (p) {
      const { data: s } = await supabase.from('servers').select('*').eq('id', (p as Project).server_id).maybeSingle();
      setServer(s as Server | null);
    }
  }

  useEffect(() => {
    if (!id) return;
    (async () => {
      await refreshProject();
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <PageLoader label="Loading project..." />;
  if (!project) return <div className="text-text-muted">Project not found</div>;

  const tabs: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutGrid },
    { id: 'setup', label: 'Setup', icon: ListChecks },
    { id: 'deployments', label: 'Deployments', icon: Rocket },
    { id: 'environment', label: 'Environment', icon: Variable },
    { id: 'credentials', label: 'Credentials', icon: KeyRound },
    { id: 'commands', label: 'Commands', icon: Terminal },
    { id: 'notes', label: 'Notes', icon: StickyNote },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div>
      <Link to="/projects" className="flex items-center gap-2 text-text-muted hover:text-text-primary text-sm mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to Projects
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{project.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="font-mono text-sm text-text-faint">{project.slug}</span>
            <StatusBadge status={project.status} />
            <StatusBadge status={server?.environment ?? ''} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {project.app_domain && (
            <a
              href={`https://${project.app_domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              <ExternalLink className="w-4 h-4" />
              Open App
            </a>
          )}
          {project.supabase_domain && (
            <a
              href={`https://${project.supabase_domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              <ExternalLink className="w-4 h-4" />
              Open Supabase
            </a>
          )}
          {project.repository_url ? (
            <a
              href={project.repository_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              <Github className="w-4 h-4" />
              Open GitHub
            </a>
          ) : (
            <button
              disabled
              className="btn-secondary opacity-50 cursor-not-allowed"
            >
              <Github className="w-4 h-4" />
              Open GitHub
            </button>
          )}
        </div>
      </div>

      <div className="tab-bar">
        {tabs.map((t) => (
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

      {tab === 'overview' && <OverviewTab project={project} server={server} onUpdated={refreshProject} />}
      {tab === 'setup' && <SetupTab project={project} server={server} />}
      {tab === 'deployments' && <DeploymentPanel project={project} server={server} />}
      {tab === 'environment' && <EnvironmentTab project={project} />}
      {tab === 'credentials' && <CredentialsTab project={project} />}
      {tab === 'commands' && <CommandsTab project={project} server={server} />}
      {tab === 'notes' && <NotesTab project={project} />}
      {tab === 'documents' && <ProjectDocumentsSection projectId={project.id} />}
      {tab === 'settings' && <SettingsTab project={project} server={server} />}
    </div>
  );
}

function OverviewTab({ project, server, onUpdated }: { project: Project; server: Server | null; onUpdated: () => void }) {
  const { isAdmin, isReadOnly } = useAuth();
  const [showEdit, setShowEdit] = useState(false);
  const [servers, setServers] = useState<Server[]>([]);
  const [editForm, setEditForm] = useState({
    name: project.name,
    slug: project.slug,
    server_id: project.server_id,
    app_domain: project.app_domain ?? '',
    supabase_domain: project.supabase_domain ?? '',
    app_directory: project.app_directory,
    supabase_directory: project.supabase_directory,
    compose_name: project.compose_name,
    project_slot: String(project.project_slot),
    api_port: String(project.api_port),
    db_port: String(project.db_port),
    pooler_port: String(project.pooler_port),
    repository_url: project.repository_url ?? '',
    git_branch: project.git_branch ?? '',
    status: project.status,
    notes: project.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('servers').select('*').order('name');
      setServers((data as Server[]) ?? []);
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);

    const updates: Record<string, string> = {};
    if (editForm.name !== project.name) updates.name = editForm.name;
    if (editForm.slug !== project.slug) updates.slug = editForm.slug;
    if (editForm.server_id !== project.server_id) updates.server_id = editForm.server_id;
    if (editForm.app_domain !== (project.app_domain ?? '')) updates.app_domain = editForm.app_domain;
    if (editForm.supabase_domain !== (project.supabase_domain ?? '')) updates.supabase_domain = editForm.supabase_domain;
    if (editForm.app_directory !== project.app_directory) updates.app_directory = editForm.app_directory;
    if (editForm.supabase_directory !== project.supabase_directory) updates.supabase_directory = editForm.supabase_directory;
    if (editForm.compose_name !== project.compose_name) updates.compose_name = editForm.compose_name;
    if (editForm.project_slot !== String(project.project_slot)) updates.project_slot = editForm.project_slot;
    if (editForm.api_port !== String(project.api_port)) updates.api_port = editForm.api_port;
    if (editForm.db_port !== String(project.db_port)) updates.db_port = editForm.db_port;
    if (editForm.pooler_port !== String(project.pooler_port)) updates.pooler_port = editForm.pooler_port;
    if (editForm.repository_url !== (project.repository_url ?? '')) updates.repository_url = editForm.repository_url;
    if (editForm.git_branch !== (project.git_branch ?? '')) updates.git_branch = editForm.git_branch;
    if (editForm.status !== project.status) updates.status = editForm.status;
    if (editForm.notes !== (project.notes ?? '')) updates.notes = editForm.notes;

    if (Object.keys(updates).length === 0) {
      setShowEdit(false);
      setSaving(false);
      return;
    }

    const { error: rpcError } = await supabase.rpc('admin_update_project', {
      p_project_id: project.id,
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

    setSuccess('Project updated successfully.');
    setSaving(false);
    setShowEdit(false);
    onUpdated();
    setTimeout(() => setSuccess(null), 3000);
  }

  const rows = [
    { label: 'Project Name', value: project.name },
    { label: 'Project Slug', value: project.slug, mono: true, copy: true, readonly: true },
    { label: 'Server', value: server?.name ?? '-' },
    { label: 'Environment', value: server?.environment ?? '-' },
    { label: 'Status', value: project.status },
    { label: 'App URL', value: project.app_domain ? `https://${project.app_domain}` : '-', mono: true, copy: !!project.app_domain },
    { label: 'Supabase URL', value: project.supabase_domain ? `https://${project.supabase_domain}` : '-', mono: true, copy: !!project.supabase_domain },
    { label: 'App Directory', value: project.app_directory, mono: true, copy: true, readonly: true },
    { label: 'Supabase Directory', value: project.supabase_directory, mono: true, copy: true, readonly: true },
    { label: 'Compose Name', value: project.compose_name, mono: true, copy: true, readonly: true },
    { label: 'Project Slot', value: String(project.project_slot), mono: true, readonly: true },
    { label: 'API Port', value: String(project.api_port), mono: true, copy: true, readonly: true },
    { label: 'DB Port', value: String(project.db_port), mono: true, copy: true, readonly: true },
    { label: 'Pooler Port', value: String(project.pooler_port), mono: true, copy: true, readonly: true },
    { label: 'GitHub Repository', value: project.repository_url ?? '-', mono: true, copy: !!project.repository_url },
    { label: 'Git Branch', value: project.git_branch ?? '-', mono: true },
  ];

  return (
    <div>
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
      <div className="flex justify-end mb-4">
        {isAdmin && !isReadOnly && (
          <button
            onClick={() => setShowEdit(true)}
            className="btn-secondary btn-sm"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        )}
      </div>

      <div className="card p-5">
        <dl className="space-y-1">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-4 py-2.5 border-b border-border">
              <dt className="text-sm text-text-muted flex-shrink-0">{r.label}</dt>
              <div className="flex items-center gap-2 min-w-0">
                {r.readonly && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-surface-hover text-text-faint">auto</span>
                )}
                <dd className={`text-sm text-text-primary ${r.mono ? 'font-mono' : ''}`}>{r.value}</dd>
                {r.copy && <CopyButton value={r.value} />}
              </div>
            </div>
          ))}
        </dl>
      </div>

      {project.notes && (
        <div className="card p-5 mt-4">
          <h3 className="text-sm font-medium text-text-secondary mb-2">Notes</h3>
          <p className="text-sm text-text-muted whitespace-pre-wrap">{project.notes}</p>
        </div>
      )}

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Project" size="lg">
        {error && (
          <div className="alert-error mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Project Name</label>
              <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="form-input" />
            </div>
            <div>
              <label className="form-label">Slug</label>
              <input value={editForm.slug} onChange={(e) => setEditForm({ ...editForm, slug: e.target.value })} className="form-input font-mono text-sm" />
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Warning: Changing the slug may break existing references.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Server</label>
              <select value={editForm.server_id} onChange={(e) => setEditForm({ ...editForm, server_id: e.target.value })} className="form-input">
                {servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.environment})</option>)}
              </select>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Warning: Changing the server will not move files or update configs.</p>
            </div>
            <div>
              <label className="form-label">Status</label>
              <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="form-input">
                {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">App Domain</label>
              <input value={editForm.app_domain} onChange={(e) => setEditForm({ ...editForm, app_domain: e.target.value })} className="form-input font-mono text-sm" />
            </div>
            <div>
              <label className="form-label">Supabase Domain</label>
              <input value={editForm.supabase_domain} onChange={(e) => setEditForm({ ...editForm, supabase_domain: e.target.value })} className="form-input font-mono text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">App Directory</label>
              <input value={editForm.app_directory} onChange={(e) => setEditForm({ ...editForm, app_directory: e.target.value })} className="form-input font-mono text-sm" />
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Warning: Must match the actual path on the server.</p>
            </div>
            <div>
              <label className="form-label">Supabase Directory</label>
              <input value={editForm.supabase_directory} onChange={(e) => setEditForm({ ...editForm, supabase_directory: e.target.value })} className="form-input font-mono text-sm" />
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Warning: Must match the actual path on the server.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Compose Name</label>
              <input value={editForm.compose_name} onChange={(e) => setEditForm({ ...editForm, compose_name: e.target.value })} className="form-input font-mono text-sm" />
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Warning: Must match the Docker Compose project name.</p>
            </div>
            <div>
              <label className="form-label">Project Slot</label>
              <input type="number" value={editForm.project_slot} onChange={(e) => setEditForm({ ...editForm, project_slot: e.target.value })} className="form-input font-mono text-sm" />
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Warning: Must match the allocated slot.</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="form-label">API Port</label>
              <input type="number" value={editForm.api_port} onChange={(e) => setEditForm({ ...editForm, api_port: e.target.value })} className="form-input font-mono text-sm" />
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Warning: Must match the allocated port.</p>
            </div>
            <div>
              <label className="form-label">DB Port</label>
              <input type="number" value={editForm.db_port} onChange={(e) => setEditForm({ ...editForm, db_port: e.target.value })} className="form-input font-mono text-sm" />
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Warning: Must match the allocated port.</p>
            </div>
            <div>
              <label className="form-label">Pooler Port</label>
              <input type="number" value={editForm.pooler_port} onChange={(e) => setEditForm({ ...editForm, pooler_port: e.target.value })} className="form-input font-mono text-sm" />
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Warning: Must match the allocated port.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Repository URL</label>
              <input value={editForm.repository_url} onChange={(e) => setEditForm({ ...editForm, repository_url: e.target.value })} className="form-input font-mono text-sm" />
            </div>
            <div>
              <label className="form-label">Git Branch</label>
              <input value={editForm.git_branch} onChange={(e) => setEditForm({ ...editForm, git_branch: e.target.value })} className="form-input font-mono text-sm" />
            </div>
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={3} className="form-input" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowEdit(false)} className="btn-ghost">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SetupTab({ project, server }: { project: Project; server: Server | null }) {
  const { isReadOnly } = useAuth();
  const [steps, setSteps] = useState<ProjectSetupStepWithCommands[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingStep, setEditingStep] = useState<ProjectSetupStepWithCommands | null>(null);
  const [editForm, setEditForm] = useState({ notes: '', command_output: '' });
  const [showAddCmd, setShowAddCmd] = useState<ProjectSetupStepWithCommands | null>(null);
  const [newCmd, setNewCmd] = useState({ title: '', command: '', is_sensitive: false });
  const [copiedAll, setCopiedAll] = useState(false);

  const sysVars = getSystemVariables(project, server);

  useEffect(() => {
    (async () => {
      await supabase.rpc('ensure_project_setup_steps', { p_project_id: project.id });
      await supabase.rpc('seed_setup_step_commands', { p_project_id: project.id });
      await loadSteps();
    })();
  }, [project.id]);

  async function loadSteps() {
    const { data } = await supabase
      .from('project_setup_steps')
      .select('*, setup_step_commands(*)')
      .eq('project_id', project.id)
      .order('step_number', { ascending: true });
    setSteps((data as unknown as ProjectSetupStepWithCommands[]) ?? []);
    setLoading(false);
  }

  async function updateStep(step: ProjectSetupStepWithCommands, updates: Partial<ProjectSetupStep>) {
    const payload: Record<string, unknown> = { ...updates };
    if (updates.status === 'completed') {
      payload.completed_at = new Date().toISOString();
    } else if (updates.status) {
      payload.completed_at = null;
    }
    await supabase.from('project_setup_steps').update(payload).eq('id', step.id);
    await loadSteps();
  }

  async function saveStepEdit() {
    if (!editingStep) return;
    await supabase.from('project_setup_steps').update({
      notes: editForm.notes || null,
      command_output: editForm.command_output || null,
    }).eq('id', editingStep.id);
    setEditingStep(null);
    await loadSteps();
  }

  async function addCustomCommand(step: ProjectSetupStepWithCommands) {
    if (!newCmd.title || !newCmd.command) return;
    const maxOrder = Math.max(0, ...(step.setup_step_commands?.map(c => c.sort_order) ?? [0]));
    await supabase.from('setup_step_commands').insert({
      setup_step_id: step.id,
      title: newCmd.title,
      command_template: newCmd.command,
      sort_order: maxOrder + 1,
      is_sensitive: newCmd.is_sensitive,
      is_custom: true,
    });
    setNewCmd({ title: '', command: '', is_sensitive: false });
    setShowAddCmd(null);
    await loadSteps();
  }

  const [confirmDeleteCmd, setConfirmDeleteCmd] = useState<{ id: string; title: string } | null>(null);

  async function deleteCommand(cmdId: string) {
    await supabase.from('setup_step_commands').delete().eq('id', cmdId);
    await loadSteps();
    setConfirmDeleteCmd(null);
  }

  function resolveCmd(template: string): string {
    return resolveCommand(template, sysVars).resolved;
  }

  function copyAllCommands(step: ProjectSetupStepWithCommands) {
    const all = (step.setup_step_commands ?? [])
      .filter(c => !c.is_sensitive)
      .map(c => resolveCmd(c.command_template))
      .join('\n\n');
    navigator.clipboard.writeText(all);
  }

  function copyFullRunbook() {
    const all = steps
      .flatMap(s => (s.setup_step_commands ?? []).filter(c => !c.is_sensitive).map(c => `# Step ${s.step_number}: ${s.title} — ${c.title}\n${resolveCmd(c.command_template)}`))
      .join('\n\n');
    navigator.clipboard.writeText(all);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  }

  if (loading) return <PageLoader label="Loading setup steps..." />;

  const completed = steps.filter((s) => s.status === 'completed').length;
  const total = steps.length || 18;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div>
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-text-primary">Setup Progress</h2>
          <div className="flex items-center gap-4">
            <button
              onClick={copyFullRunbook}
              className="btn-secondary btn-sm"
            >
              {copiedAll ? <><Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy Full Runbook</>}
            </button>
            <span className="text-sm text-text-muted">{completed} / {total} Completed ({pct}%)</span>
          </div>
        </div>
        <div className="w-full bg-surface-hover rounded-full h-2.5 overflow-hidden">
          <div
            className="bg-emerald-500 h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="card p-4 mb-4">
        <h3 className="text-sm font-medium text-text-secondary mb-2">Infrastructure Rules</h3>
        <ul className="text-xs text-text-muted space-y-1">
          <li>Each project has its own React app directory, Supabase directory, Docker Compose namespace, database, Auth, Storage, .env, secrets, keys, Nginx config, domains, and ports.</li>
          <li>Never reuse another project's .env, database, secrets, keys, containers, directories, Compose Name, or ports.</li>
          <li>DB and Pooler should normally bind to 127.0.0.1.</li>
          <li>Supabase Nginx should proxy to 127.0.0.1:{project.api_port}.</li>
        </ul>
      </div>

      <div className="space-y-3">
        {steps.map((step) => {
          const cmds = (step.setup_step_commands ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
          return (
            <div key={step.id} className="card p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="flex items-center justify-center w-7 h-7 rounded-full bg-surface-hover text-xs font-bold text-text-secondary">
                    {step.step_number}
                  </span>
                  <h3 className="text-sm font-medium text-text-primary">{step.title}</h3>
                </div>
                <StatusBadge status={step.status} />
              </div>

              {cmds.length > 0 && (
                <div className="space-y-3 mb-3">
                  {cmds.map((cmd) => {
                    const resolved = resolveCmd(cmd.command_template);
                    return (
                      <div key={cmd.id}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-text-muted">{cmd.title}</span>
                            {cmd.is_sensitive && <span className="sensitive-badge">Sensitive</span>}
                            {cmd.is_custom && <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30">Custom</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <CopyButton value={resolved} />
                            {cmd.is_custom && !isReadOnly && (
                              <button onClick={() => setConfirmDeleteCmd({ id: cmd.id, title: cmd.title })} className="text-text-muted hover:text-red-600 dark:text-red-400 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <pre className="code-block-resolved">{resolved}</pre>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                {cmds.length > 0 && (
                  <button
                    onClick={() => copyAllCommands(step)}
                    className="btn-ghost btn-sm"
                  >
                    Copy All Commands
                  </button>
                )}
                <button
                  onClick={() => setShowAddCmd(step)}
                  className="btn-ghost btn-sm text-sky-600 dark:text-sky-400"
                  style={isReadOnly ? { display: 'none' } : undefined}
                >
                  + Add Command
                </button>
              </div>

              {step.notes && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs text-text-faint mb-1">Notes:</p>
                  <p className="text-xs text-text-muted whitespace-pre-wrap">{step.notes}</p>
                </div>
              )}
              {step.command_output && (
                <div className="mt-2">
                  <p className="text-xs text-text-faint mb-1">Command Output:</p>
                  <pre className="code-block">{step.command_output}</pre>
                </div>
              )}

              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                {!isReadOnly && (
                  <button
                    onClick={() => updateStep(step, { status: 'in_progress' })}
                    className="btn-ghost btn-sm text-amber-600 dark:text-amber-400 border border-amber-500/30"
                  >
                    Mark In Progress
                  </button>
                )}
                {!isReadOnly && (
                  <button
                    onClick={() => updateStep(step, { status: 'completed' })}
                    className="btn-ghost btn-sm text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                  >
                    Mark Completed
                  </button>
                )}
                {!isReadOnly && (
                  <button
                    onClick={() => updateStep(step, { status: 'blocked' })}
                    className="btn-ghost btn-sm text-red-600 dark:text-red-400 border border-red-500/30"
                  >
                    Mark Blocked
                  </button>
                )}
                {!isReadOnly && (
                  <button
                    onClick={() => {
                      setEditingStep(step);
                      setEditForm({ notes: step.notes ?? '', command_output: step.command_output ?? '' });
                    }}
                    className="btn-ghost btn-sm"
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!confirmDeleteCmd}
        title="Delete Command"
        message="Are you sure you want to delete this item?"
        itemName={confirmDeleteCmd?.title}
        onConfirm={() => confirmDeleteCmd && deleteCommand(confirmDeleteCmd.id)}
        onCancel={() => setConfirmDeleteCmd(null)}
      />

      <Modal open={!!editingStep} onClose={() => setEditingStep(null)} title={`Edit Step ${editingStep?.step_number ?? ''}`} size="lg">
        <div className="space-y-4">
          <div>
            <label className="form-label">Notes</label>
            <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={3} className="form-input" />
          </div>
          <div>
            <label className="form-label">Command Output</label>
            <textarea value={editForm.command_output} onChange={(e) => setEditForm({ ...editForm, command_output: e.target.value })} rows={4} className="form-input font-mono text-sm" />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setEditingStep(null)} className="btn-ghost">Cancel</button>
            <button onClick={saveStepEdit} className="btn-primary">
              <Save className="w-4 h-4" /> Save
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!showAddCmd} onClose={() => setShowAddCmd(null)} title={`Add Command to Step ${showAddCmd?.step_number ?? ''}`} size="md">
        <div className="space-y-4">
          <div>
            <label className="form-label">Command Name</label>
            <input value={newCmd.title} onChange={(e) => setNewCmd({ ...newCmd, title: e.target.value })} placeholder="e.g. Run Migrations" className="form-input" />
          </div>
          <div>
            <label className="form-label">Command</label>
            <textarea value={newCmd.command} onChange={(e) => setNewCmd({ ...newCmd, command: e.target.value })} rows={5} placeholder="cd {{APP_DIRECTORY}}&#10;npm run migrate" className="form-input font-mono text-sm" />
            <p className="form-hint">Use placeholders like {'{{APP_DIRECTORY}}'}, {'{{API_PORT}}'}, etc.</p>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={newCmd.is_sensitive} onChange={(e) => setNewCmd({ ...newCmd, is_sensitive: e.target.checked })} className="rounded" />
              Sensitive
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setShowAddCmd(null)} className="btn-ghost">Cancel</button>
          <button onClick={() => showAddCmd && addCustomCommand(showAddCmd)} disabled={!newCmd.title || !newCmd.command} className="btn-primary disabled:opacity-50">Add</button>
        </div>
      </Modal>
    </div>
  );
}

function EnvironmentTab({ project }: { project: Project }) {
  const { isReadOnly } = useAuth();
  const [vars, setVars] = useState<ConfigVariable[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [showEnvPreview, setShowEnvPreview] = useState(false);
  const [newVar, setNewVar] = useState({ key: '', value: '', is_sensitive: false, description: '', notes: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [project.id]);

  async function load() {
    const { data } = await supabase
      .from('config_variables')
      .select('*')
      .eq('scope', 'project')
      .eq('project_id', project.id)
      .order('key', { ascending: true });
    setVars((data as ConfigVariable[]) ?? []);
    setLoading(false);
  }

  async function handleAdd() {
    setError(null);
    const key = normalizeKey(newVar.key);
    if (!key) { setError('Key is required'); return; }
    if (isReservedKey(key)) { setError(`This key is managed automatically by Server Manager.`); return; }
    const { error: e } = await supabase.from('config_variables').insert({
      scope: 'project',
      project_id: project.id,
      server_id: null,
      key,
      value: newVar.value,
      is_sensitive: newVar.is_sensitive,
      description: newVar.description || null,
      notes: newVar.notes || null,
    });
    if (e) { setError(e.message); return; }
    setNewVar({ key: '', value: '', is_sensitive: false, description: '', notes: '' });
    setShowAdd(false);
    await load();
  }

  const [confirmDelete, setConfirmDelete] = useState<ConfigVariable | null>(null);

  async function handleDelete(varId: string) {
    await supabase.from('config_variables').delete().eq('id', varId);
    await load();
    setConfirmDelete(null);
  }

  const filtered = vars.filter((v) => v.key.toLowerCase().includes(search.toLowerCase()));
  const envText = vars.filter(v => !v.is_sensitive || v.value).map((v) => `${v.key}=${v.value}`).join('\n');

  if (loading) return <PageLoader label="Loading variables..." />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-primary">Environment Variables</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowEnvPreview(true)}
            className="btn-secondary btn-sm"
          >
            <FileText className="w-3.5 h-3.5" />
            .env Preview
          </button>
          {!isReadOnly && (
            <button
              onClick={() => setShowAdd(true)}
              className="btn-primary btn-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Variable
            </button>
          )}
        </div>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search variables..."
        className="search-input mb-3"
      />

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p className="text-text-muted text-sm">No variables yet. Click "Add Variable" to create one.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th>Sensitive</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.id}>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <code className="font-mono text-sky-600 dark:text-sky-300">{v.key}</code>
                      <CopyButton value={v.key} />
                    </div>
                    {v.description && <p className="text-xs text-text-faint mt-0.5">{v.description}</p>}
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <SensitiveValue value={v.value} isSensitive={v.is_sensitive} />
                      <CopyButton value={v.value} />
                    </div>
                  </td>
                  <td>
                    {v.is_sensitive ? <span className="sensitive-badge">Yes</span> : <span className="text-text-faint text-xs">No</span>}
                  </td>
                  <td>
                    {!isReadOnly && (
                      <button
                        onClick={() => setConfirmDelete(v)}
                        className="text-text-muted hover:text-red-600 dark:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Variable"
        message="Are you sure you want to delete this item?"
        itemName={confirmDelete?.key}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Variable" size="md">
        {error && (
          <div className="alert-error mb-3">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="form-label">Key</label>
            <input
              value={newVar.key}
              onChange={(e) => setNewVar({ ...newVar, key: e.target.value })}
              placeholder="e.g. SMTP_HOST"
              className="form-input font-mono text-sm"
            />
            <p className="form-hint">Will be normalized to UPPER_SNAKE_CASE</p>
          </div>
          <div>
            <label className="form-label">Value</label>
            <input
              value={newVar.value}
              onChange={(e) => setNewVar({ ...newVar, value: e.target.value })}
              className="form-input font-mono text-sm"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={newVar.is_sensitive}
                onChange={(e) => setNewVar({ ...newVar, is_sensitive: e.target.checked })}
                className="rounded"
              />
              Sensitive
            </label>
          </div>
          <div>
            <label className="form-label">Description</label>
            <input value={newVar.description} onChange={(e) => setNewVar({ ...newVar, description: e.target.value })} className="form-input" />
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea value={newVar.notes} onChange={(e) => setNewVar({ ...newVar, notes: e.target.value })} rows={2} className="form-input" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setShowAdd(false)} className="btn-ghost">Cancel</button>
          <button onClick={handleAdd} className="btn-primary">Add</button>
        </div>
      </Modal>

      <Modal open={showEnvPreview} onClose={() => setShowEnvPreview(false)} title=".env Preview" size="lg">
        <div className="code-block mb-4 max-h-[400px] overflow-y-auto">
          <pre className="text-sm font-mono text-text-secondary whitespace-pre-wrap">{envText || '# No variables'}</pre>
        </div>
        <div className="flex justify-end">
          <CopyButton value={envText} label="Copy .env" />
        </div>
      </Modal>
    </div>
  );
}

function CredentialsTab({ project }: { project: Project }) {
  const { isReadOnly } = useAuth();
  const [creds, setCreds] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newCred, setNewCred] = useState({ type: 'Other', name: '', value: '', is_sensitive: true, notes: '' });

  useEffect(() => {
    load();
  }, [project.id]);

  async function load() {
    const { data } = await supabase
      .from('credentials')
      .select('*')
      .eq('scope', 'project')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false });
    setCreds((data as Credential[]) ?? []);
    setLoading(false);
  }

  async function handleAdd() {
    await supabase.from('credentials').insert({
      scope: 'project',
      project_id: project.id,
      server_id: null,
      type: newCred.type,
      name: newCred.name,
      value: newCred.value,
      is_sensitive: newCred.is_sensitive,
      notes: newCred.notes || null,
    });
    setNewCred({ type: 'Other', name: '', value: '', is_sensitive: true, notes: '' });
    setShowAdd(false);
    await load();
  }

  const [confirmDelete, setConfirmDelete] = useState<Credential | null>(null);

  async function handleDelete(credId: string) {
    await supabase.from('credentials').delete().eq('id', credId);
    await load();
    setConfirmDelete(null);
  }

  if (loading) return <PageLoader label="Loading credentials..." />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-primary">Credentials</h2>
        {!isReadOnly && (
          <button
            onClick={() => setShowAdd(true)}
            className="btn-primary btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> Add Credential
          </button>
        )}
      </div>

      {creds.length === 0 ? (
        <div className="empty-state">
          <p className="text-text-muted text-sm">No credentials stored for this project.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {creds.map((c) => (
            <div key={c.id} className="card-hover p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{c.name}</span>
                    <StatusBadge status={c.type} />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <SensitiveValue value={c.value} isSensitive={c.is_sensitive} />
                    <CopyButton value={c.value} />
                  </div>
                  {c.notes && <p className="text-xs text-text-muted mt-2">{c.notes}</p>}
                </div>
                {!isReadOnly && (
                  <button onClick={() => setConfirmDelete(c)} className="text-text-muted hover:text-red-600 dark:text-red-400 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Credential"
        message="Are you sure you want to delete this item?"
        itemName={confirmDelete?.name}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Credential" size="md">
        <div className="space-y-4">
          <div>
            <label className="form-label">Type</label>
            <select value={newCred.type} onChange={(e) => setNewCred({ ...newCred, type: e.target.value })} className="form-input">
              {['Supabase Dashboard Username', 'Supabase Dashboard Password', 'Supabase Anon Key', 'Supabase Service Role Key', 'Postgres Password', 'JWT Secret', 'SSH Username', 'SSH Password', 'API Key', 'Other'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Name</label>
            <input value={newCred.name} onChange={(e) => setNewCred({ ...newCred, name: e.target.value })} placeholder="e.g. Production Postgres Password" className="form-input" />
          </div>
          <div>
            <label className="form-label">Value</label>
            <input value={newCred.value} onChange={(e) => setNewCred({ ...newCred, value: e.target.value })} className="form-input font-mono text-sm" />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={newCred.is_sensitive} onChange={(e) => setNewCred({ ...newCred, is_sensitive: e.target.checked })} className="rounded" />
              Sensitive (hidden by default)
            </label>
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea value={newCred.notes} onChange={(e) => setNewCred({ ...newCred, notes: e.target.value })} rows={2} className="form-input" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setShowAdd(false)} className="btn-ghost">Cancel</button>
          <button onClick={handleAdd} disabled={!newCred.name || !newCred.value} className="btn-primary disabled:opacity-50">Add</button>
        </div>
      </Modal>
    </div>
  );
}

function CommandsTab({ project, server }: { project: Project; server: Server | null }) {
  const { isReadOnly } = useAuth();
  const [commands, setCommands] = useState<CommandWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newCmd, setNewCmd] = useState({ name: '', category: '', command: '', description: '', is_sensitive: false });
  const [cmdVars, setCmdVars] = useState<{ key: string; value: string }[]>([]);
  const [projectVars, setProjectVars] = useState<ConfigVariable[]>([]);
  const [serverVars, setServerVars] = useState<ConfigVariable[]>([]);
  const [globalVars, setGlobalVars] = useState<ConfigVariable[]>([]);
  const [commandError, setCommandError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [project.id]);

  async function load() {
    const [cmdRes, projVarRes, srvVarRes, globVarRes] = await Promise.all([
      supabase.from('commands').select('*, server:servers(id, name), project:projects!commands_project_id_fkey(id, name, slug), command_variables(*), command_project_assignments!command_project_assignments_command_id_fkey(project_id)').order('created_at', { ascending: false }),
      supabase.from('config_variables').select('*').eq('scope', 'project').eq('project_id', project.id),
      supabase.from('config_variables').select('*').eq('scope', 'server').eq('server_id', project.server_id),
      supabase.from('config_variables').select('*').eq('scope', 'global'),
    ]);
    setCommandError(cmdRes.error ? `Commands could not be loaded: ${cmdRes.error.message}` : null);
    const allCommands = (cmdRes.data as unknown as CommandWithRelations[]) ?? [];
    const visibleCommands = new Map<string, CommandWithRelations>();
    for (const command of allCommands) {
      const isDirectlyAssigned = command.scope === 'project' && command.project_id === project.id;
      const isRelationallyAssigned = (command.command_project_assignments ?? []).some((assignment) => assignment.project_id === project.id);
      if (isDirectlyAssigned || isRelationallyAssigned) {
        visibleCommands.set(command.id, command);
      }
    }
    setCommands([...visibleCommands.values()]);
    setProjectVars((projVarRes.data as ConfigVariable[]) ?? []);
    setServerVars((srvVarRes.data as ConfigVariable[]) ?? []);
    setGlobalVars((globVarRes.data as ConfigVariable[]) ?? []);
    setLoading(false);
  }

  function resolveForProject(cmd: CommandWithRelations): { resolved: string; missing: string[] } {
    const sysVars = getSystemVariables(project, server);
    const allVars: Record<string, string> = { ...sysVars };

    // Command-specific vars (highest priority for custom)
    for (const cv of cmd.command_variables ?? []) {
      if (!isReservedKey(cv.key)) {
        allVars[cv.key] = cv.value;
      }
    }
    // Project > Server > Global
    for (const v of projectVars) allVars[v.key] = v.value;
    for (const v of serverVars) if (!(v.key in allVars)) allVars[v.key] = v.value;
    for (const v of globalVars) if (!(v.key in allVars)) allVars[v.key] = v.value;

    return resolveCommand(cmd.command, allVars);
  }

  async function handleAdd() {
    const { data, error } = await supabase.from('commands').insert({
      name: newCmd.name,
      category: newCmd.category || null,
      scope: 'project',
      project_id: project.id,
      server_id: null,
      command: newCmd.command,
      description: newCmd.description || null,
      is_sensitive: newCmd.is_sensitive,
    }).select().maybeSingle();
    if (error || !data) {
      setCommandError(`Command could not be created: ${error?.message ?? 'Unknown error'}`);
      return;
    }

    const variableRows = cmdVars.filter(v => v.key && v.value).map(v => ({
      command_id: data.id,
      key: normalizeKey(v.key),
      value: v.value,
      is_sensitive: false,
    }));
    if (variableRows.length > 0) {
      const { error: variableError } = await supabase.from('command_variables').insert(variableRows);
      if (variableError) {
        setCommandError(`Command variables could not be saved: ${variableError.message}`);
        return;
      }
    }
    setCommandError(null);
    setNewCmd({ name: '', category: '', command: '', description: '', is_sensitive: false });
    setCmdVars([]);
    setShowAdd(false);
    await load();
  }

  const [confirmDelete, setConfirmDelete] = useState<CommandWithRelations | null>(null);

  async function handleDelete(cmdId: string) {
    await supabase.from('commands').delete().eq('id', cmdId);
    await load();
    setConfirmDelete(null);
  }

  if (loading) return <PageLoader label="Loading commands..." />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-primary">Commands</h2>
        {!isReadOnly && (
          <button
            onClick={() => setShowAdd(true)}
            className="btn-primary btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> Add Command
          </button>
        )}
      </div>

      {commandError ? (
        <div className="alert-error justify-center">
          {commandError}
        </div>
      ) : commands.length === 0 ? (
        <div className="empty-state">
          <p className="text-text-muted text-sm">No commands yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {commands.map((cmd) => {
            const { resolved, missing } = resolveForProject(cmd);
            return (
              <div key={cmd.id} className="card-hover p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{cmd.name}</span>
                      {cmd.category && <StatusBadge status={cmd.category} />}
                      {cmd.is_sensitive && <span className="sensitive-badge">Sensitive</span>}
                    </div>
                    {cmd.description && <p className="text-xs text-text-muted mt-1">{cmd.description}</p>}
                  </div>
                  {!isReadOnly && (
                    <button onClick={() => setConfirmDelete(cmd)} className="text-text-muted hover:text-red-600 dark:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid gap-2 mt-3">
                  <div>
                    <p className="text-xs text-text-faint mb-1">Template:</p>
                    <pre className="code-block">{cmd.command}</pre>
                  </div>
                  <div>
                    <p className="text-xs text-text-faint mb-1">Resolved:</p>
                    <pre className="code-block-resolved">{resolved}</pre>
                  </div>
                </div>

                {missing.length > 0 && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-amber-600 dark:text-amber-400">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Missing: {missing.map(m => `{{${m}}}`).join(', ')}
                  </div>
                )}

                <div className="flex items-center gap-3 mt-3">
                  <CopyButton value={resolved} label="Copy Resolved" />
                  <CopyButton value={cmd.command} label="Copy Template" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Command"
        message="Are you sure you want to delete this item?"
        itemName={confirmDelete?.name}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Command" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Command Name</label>
              <input value={newCmd.name} onChange={(e) => setNewCmd({ ...newCmd, name: e.target.value })} className="form-input" />
            </div>
            <div>
              <label className="form-label">Category</label>
              <input value={newCmd.category} onChange={(e) => setNewCmd({ ...newCmd, category: e.target.value })} placeholder="e.g. Docker" className="form-input" />
            </div>
          </div>
          <div>
            <label className="form-label">Command</label>
            <textarea value={newCmd.command} onChange={(e) => setNewCmd({ ...newCmd, command: e.target.value })} rows={5} placeholder="cd {{SUPABASE_DIRECTORY}}&#10;docker compose ps" className="form-input font-mono text-sm" />
            <p className="form-hint">Use placeholders like {'{{APP_DIRECTORY}}'}, {'{{API_PORT}}'}, or any custom variable key.</p>
          </div>
          <div>
            <label className="form-label">Description</label>
            <input value={newCmd.description} onChange={(e) => setNewCmd({ ...newCmd, description: e.target.value })} className="form-input" />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={newCmd.is_sensitive} onChange={(e) => setNewCmd({ ...newCmd, is_sensitive: e.target.checked })} className="rounded" />
              Sensitive
            </label>
          </div>
          <div>
            <label className="form-label">Command-specific Variables (optional)</label>
            {cmdVars.map((v, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  value={v.key}
                  onChange={(e) => setCmdVars(cmdVars.map((cv, j) => j === i ? { ...cv, key: e.target.value } : cv))}
                  placeholder="KEY"
                  className="form-input flex-1 font-mono text-sm"
                />
                <input
                  value={v.value}
                  onChange={(e) => setCmdVars(cmdVars.map((cv, j) => j === i ? { ...cv, value: e.target.value } : cv))}
                  placeholder="value"
                  className="form-input flex-1 font-mono text-sm"
                />
                <button onClick={() => setCmdVars(cmdVars.filter((_, j) => j !== i))} className="text-text-muted hover:text-red-600 dark:text-red-400 px-2">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setCmdVars([...cmdVars, { key: '', value: '' }])}
              className="text-xs text-sky-600 dark:text-sky-400 hover:text-sky-600 dark:text-sky-300"
            >
              + Add Variable
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setShowAdd(false)} className="btn-ghost">Cancel</button>
          <button onClick={handleAdd} disabled={!newCmd.name || !newCmd.command} className="btn-primary disabled:opacity-50">Add</button>
        </div>
      </Modal>
    </div>
  );
}

function NotesTab({ project }: { project: Project }) {
  const { isReadOnly } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');

  useEffect(() => {
    load();
  }, [project.id]);

  async function load() {
    const { data } = await supabase
      .from('notes')
      .select('*')
      .eq('scope', 'project')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false });
    setNotes((data as Note[]) ?? []);
    setLoading(false);
  }

  async function handleAdd() {
    if (!content.trim()) return;
    await supabase.from('notes').insert({
      scope: 'project',
      project_id: project.id,
      server_id: null,
      content: content.trim(),
    });
    setContent('');
    await load();
  }

  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);

  async function handleDelete(noteId: string) {
    await supabase.from('notes').delete().eq('id', noteId);
    await load();
    setConfirmDelete(null);
  }

  if (loading) return <PageLoader label="Loading notes..." />;

  return (
    <div>
      <h2 className="text-lg font-semibold text-text-primary mb-4">Notes</h2>

      <div className="card p-4 mb-4">
        {!isReadOnly && (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            placeholder="Add a note..."
            className="form-input mb-3"
          />
        )}
        {!isReadOnly && (
          <div className="flex justify-end">
            <button
              onClick={handleAdd}
              disabled={!content.trim()}
              className="btn-primary btn-sm disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" /> Add Note
            </button>
          </div>
        )}
      </div>

      {notes.length === 0 ? (
        <p className="text-text-muted text-sm text-center py-4">No notes yet.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="card p-4">
              <div className="flex items-start justify-between">
                <p className="text-sm text-text-secondary whitespace-pre-wrap flex-1">{n.content}</p>
                {!isReadOnly && (
                  <button onClick={() => setConfirmDelete(n)} className="text-text-muted hover:text-red-600 dark:text-red-400 transition-colors ml-3">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <p className="text-xs text-text-faint mt-2">{new Date(n.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Note"
        message="Are you sure you want to delete this item?"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function SettingsTab({ project, server }: { project: Project; server: Server | null }) {
  const [copied, setCopied] = useState(false);

  const lines: string[] = [
    'I use a DigitalOcean server to self-host multiple projects.',
    '',
    'Multiple projects run inside this server. Each project has its own application code and self-hosted Supabase code.',
    '',
    'CURRENT PROJECT',
    '',
    `Project Name: ${project.name}`,
    `Slug: ${project.slug}`,
    `Status: ${project.status}`,
    `Environment: ${server?.environment ?? ''}`,
    `Server: ${server?.name ?? ''}`,
    '',
    `App Directory: ${project.app_directory}`,
    `Supabase Directory: ${project.supabase_directory}`,
    `Compose Name: ${project.compose_name}`,
    `Project Slot: ${project.project_slot}`,
    '',
    `API Port: ${project.api_port}`,
    `DB Port: ${project.db_port}`,
    `Pooler Port: ${project.pooler_port}`,
    '',
    project.app_domain ? `App URL: https://${project.app_domain}` : '',
    project.supabase_domain ? `Supabase URL: https://${project.supabase_domain}` : '',
    project.repository_url ? `GitHub Repository: ${project.repository_url}` : '',
    project.git_branch ? `Git Branch: ${project.git_branch}` : '',
    '',
    'Use this infrastructure and project information as context when helping me troubleshoot, configure, deploy, or maintain this project.',
  ].filter((l) => l !== '');

  const promptText = lines.join('\n');

  function copyPrompt() {
    navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-text-primary mb-4">Settings</h2>

      <div className="card p-5 mb-4">
        <h3 className="text-sm font-medium text-text-secondary mb-1">AI Project Context</h3>
        <p className="text-xs text-text-muted mb-4">
          A ready-to-paste prompt with this project's infrastructure details. Only non-sensitive information is included.
        </p>

        <div className="flex justify-end mb-3">
          <button
            onClick={copyPrompt}
            className="btn-primary btn-sm"
          >
            {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy Prompt</>}
          </button>
        </div>

        <pre className="code-block leading-relaxed">
{promptText}
        </pre>
      </div>
    </div>
  );
}
