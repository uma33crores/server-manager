import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { CommandWithRelations, Server, Project } from '@/lib/supabase';
import { StatusBadge } from '@/components/Badge';
import CopyButton from '@/components/CopyButton';
import Modal from '@/components/Modal';
import { getSystemVariables, resolveCommand, normalizeKey } from '@/lib/utils';
import { Plus, Trash2, Search, AlertCircle, Copy, Terminal, Eye } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/PageLoader';
import ConfirmDialog from '@/components/ConfirmDialog';

export default function Commands() {
  const { isReadOnly } = useAuth();
  const [commands, setCommands] = useState<CommandWithRelations[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newCmd, setNewCmd] = useState({
    name: '',
    category: '',
    scope: 'global' as 'global' | 'server' | 'project',
    server_id: '',
    project_ids: [] as string[],
    command: '',
    description: '',
    is_sensitive: false,
  });
  const [cmdVars, setCmdVars] = useState<{ key: string; value: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewCmd, setPreviewCmd] = useState<CommandWithRelations | null>(null);
  const [previewProject, setPreviewProject] = useState<string>('');
  const [confirmDelete, setConfirmDelete] = useState<CommandWithRelations | null>(null);

  useEffect(() => {
    load();
    (async () => {
      const [{ data: s }, { data: p }] = await Promise.all([
        supabase.from('servers').select('*').order('name'),
        supabase.from('projects').select('*, server:servers(id, name)').order('name'),
      ]);
      setServers((s as Server[]) ?? []);
      setProjects((p as Project[]) ?? []);
    })();
  }, []);

  async function load() {
    const { data, error: queryError } = await supabase
      .from('commands')
      .select('*, server:servers(id, name), project:projects!commands_project_id_fkey(id, name, slug), command_variables(*), command_project_assignments!command_project_assignments_command_id_fkey(project:projects!command_project_assignments_project_id_fkey(id, name, slug))')
      .order('created_at', { ascending: false });
    setLoadError(queryError ? `Commands could not be loaded: ${queryError.message}` : null);
    setCommands(queryError ? [] : ((data as unknown as CommandWithRelations[]) ?? []));
    setLoading(false);
  }

  async function handleAdd() {
    setError(null);
    if (!newCmd.name || !newCmd.command) { setError('Name and command are required'); return; }
    if (newCmd.scope === 'server' && !newCmd.server_id) { setError('Server is required'); return; }
    if (newCmd.scope === 'project' && newCmd.project_ids.length === 0) { setError('Select at least one project'); return; }

    const payload: Record<string, unknown> = {
      name: newCmd.name,
      category: newCmd.category || null,
      scope: newCmd.scope,
      server_id: newCmd.scope === 'server' ? newCmd.server_id : null,
      project_id: newCmd.scope === 'project' ? newCmd.project_ids[0] : null,
      command: newCmd.command,
      description: newCmd.description || null,
      is_sensitive: newCmd.is_sensitive,
    };

    const { data, error: commandError } = await supabase.from('commands').insert(payload).select().maybeSingle();
    if (commandError || !data) { setError(`Command could not be created: ${commandError?.message ?? 'Unknown error'}`); return; }

    if (newCmd.scope === 'project') {
      const assignmentProjectIds = newCmd.project_ids.slice(1);
      if (assignmentProjectIds.length > 0) {
        const { error: assignmentError } = await supabase.from('command_project_assignments').insert(
          assignmentProjectIds.map((projectId) => ({ command_id: data.id, project_id: projectId }))
        );
        if (assignmentError) {
          await supabase.from('commands').delete().eq('id', data.id);
          setError(`Command assignments could not be saved: ${assignmentError.message}`);
          return;
        }
      }
    }

    const variableRows = cmdVars.filter(v => v.key && v.value).map(v => ({
      command_id: data.id,
      key: normalizeKey(v.key),
      value: v.value,
      is_sensitive: false,
    }));
    if (variableRows.length > 0) {
      const { error: variableError } = await supabase.from('command_variables').insert(variableRows);
      if (variableError) { setError(`Command variables could not be saved: ${variableError.message}`); return; }
    }

    setNewCmd({ name: '', category: '', scope: 'global', server_id: '', project_ids: [], command: '', description: '', is_sensitive: false });
    setCmdVars([]);
    setShowAdd(false);
    await load();
  }

  async function handleDelete(id: string) {
    await supabase.from('commands').delete().eq('id', id);
    await load();
    setConfirmDelete(null);
  }

  async function handleDuplicate(cmd: CommandWithRelations) {
    await supabase.from('commands').insert({
      name: cmd.name + ' (copy)',
      category: cmd.category,
      scope: 'global',
      command: cmd.command,
      description: cmd.description,
      is_sensitive: cmd.is_sensitive,
    });
    await load();
  }

  function resolvePreview(cmd: CommandWithRelations, projectId: string) {
    const proj = projects.find(p => p.id === projectId);
    if (!proj) return { resolved: cmd.command, missing: [] as string[] };
    const sysVars = getSystemVariables(proj, { name: proj.server?.name ?? '', public_ip: '', environment: '' });
    return resolveCommand(cmd.command, sysVars);
  }

  const filtered = commands.filter((c) => {
    if (search) {
      const q = search.toLowerCase();
      if (!c.name.toLowerCase().includes(q) && !(c.category ?? '').toLowerCase().includes(q)) return false;
    }
    if (scopeFilter && c.scope !== scopeFilter) return false;
    return true;
  });

  if (loading) return <PageLoader label="Loading commands..." />;

  const sensitiveCount = commands.filter((c) => c.is_sensitive).length;

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Commands</h1>
          <p className="page-subtitle">{commands.length} command{commands.length !== 1 ? 's' : ''} in library</p>
        </div>
        {!isReadOnly && (
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Add Command
          </button>
        )}
      </div>

      {commands.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="card p-4 flex items-center gap-3">
            <div className="stat-icon bg-sky-500/10 w-9 h-9">
              <Terminal className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-text-primary leading-none">{commands.length}</div>
              <div className="text-xs text-text-muted mt-0.5">Total Commands</div>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <div className="stat-icon bg-surface-hover w-9 h-9">
              <Terminal className="w-4 h-4 text-text-secondary" />
            </div>
            <div>
              <div className="text-xl font-bold text-text-primary leading-none">{commands.filter(c => c.scope === 'global').length}</div>
              <div className="text-xs text-text-muted mt-0.5">Global</div>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <div className="stat-icon bg-amber-500/10 w-9 h-9">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-text-primary leading-none">{sensitiveCount}</div>
              <div className="text-xs text-text-muted mt-0.5">Sensitive</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or category..." className="search-input" />
        </div>
        <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} className="filter-select">
          <option value="">All Scopes</option>
          <option value="global">Global</option>
          <option value="server">Server</option>
          <option value="project">Project</option>
        </select>
      </div>

      {loadError ? (
        <div className="alert-error">{loadError}</div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Terminal className="w-7 h-7" />
            </div>
            <p className="text-text-muted text-sm">No commands found</p>
            <p className="text-text-faint text-xs mt-0.5">Try adjusting your search or filters</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((cmd) => (
            <div key={cmd.id} className="card-hover p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-text-primary">{cmd.name}</span>
                    {cmd.category && <StatusBadge status={cmd.category} />}
                    <span className="scope-badge">{cmd.scope}</span>
                    {cmd.is_sensitive && <span className="sensitive-badge">Sensitive</span>}
                  </div>
                  {cmd.description && <p className="text-xs text-text-muted mt-1.5">{cmd.description}</p>}
                  {cmd.scope === 'server' && cmd.server && (
                    <p className="text-xs text-text-faint mt-1">{cmd.server.name}</p>
                  )}
                  {cmd.scope === 'project' && (
                    <p className="text-xs text-text-faint mt-1">
                      {(cmd.command_project_assignments ?? []).map((assignment) => assignment.project?.name).filter(Boolean).join(', ') || cmd.project?.name || 'Assigned projects'}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                  <button
                    onClick={() => { setPreviewCmd(cmd); setPreviewProject(projects.length > 0 ? projects[0].id : ''); }}
                    className="btn-ghost btn-sm"
                  >
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </button>
                  {!isReadOnly && (
                    <>
                      <button onClick={() => handleDuplicate(cmd)} className="text-text-muted hover:text-text-primary p-1.5 rounded-lg hover:bg-surface-hover transition-colors" title="Duplicate">
                        <Copy className="w-4 h-4" />
                      </button>
                      <button onClick={() => setConfirmDelete(cmd)} className="text-text-muted hover:text-red-500 p-1.5 rounded-lg hover:bg-surface-hover transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <pre className="code-block">{cmd.command}</pre>

              {cmd.command_variables && cmd.command_variables.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {cmd.command_variables.map((cv) => (
                    <span key={cv.id} className="text-xs font-mono px-2 py-0.5 rounded-md bg-surface-hover text-text-secondary">
                      {cv.key}={cv.value}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/60">
                <CopyButton value={cmd.command} label="Copy Template" />
                {cmd.project && (
                  <Link to={`/projects/${cmd.project.id}`} className="text-xs text-sky-600 dark:text-sky-400 hover:text-sky-500">
                    Open Project
                  </Link>
                )}
              </div>
            </div>
          ))}
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
        {error && (
          <div className="alert-error mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}
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
            <label className="form-label">Scope</label>
            <select
              value={newCmd.scope}
              onChange={(e) => setNewCmd({ ...newCmd, scope: e.target.value as 'global' | 'server' | 'project', project_ids: [] })}
              className="form-input"
            >
              <option value="global">Global</option>
              <option value="server">Server</option>
              <option value="project">Project</option>
            </select>
          </div>
          {newCmd.scope === 'server' && (
            <div>
              <label className="form-label">Server</label>
              <select value={newCmd.server_id} onChange={(e) => setNewCmd({ ...newCmd, server_id: e.target.value })} className="form-input">
                <option value="">Select server...</option>
                {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {newCmd.scope === 'project' && (
            <div>
              <label className="form-label">Assign to projects</label>
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-surface-2 p-2 space-y-1">
                {projects.map((p) => {
                  const checked = newCmd.project_ids.includes(p.id);
                  return (
                    <label key={p.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-text-secondary hover:bg-surface-hover cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setNewCmd({ ...newCmd, project_ids: checked ? newCmd.project_ids.filter((id) => id !== p.id) : [...newCmd.project_ids, p.id] })}
                        className="rounded border-border text-sky-600 focus:ring-sky-500 accent-sky-500"
                      />
                      <span>{p.name}</span>
                    </label>
                  );
                })}
                {projects.length === 0 && <p className="px-2 py-2 text-sm text-text-faint">No projects available.</p>}
              </div>
              <p className="form-hint">Select every project that should display this command.</p>
            </div>
          )}
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
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input type="checkbox" checked={newCmd.is_sensitive} onChange={(e) => setNewCmd({ ...newCmd, is_sensitive: e.target.checked })} className="rounded accent-sky-500" />
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
                <button onClick={() => setCmdVars(cmdVars.filter((_, j) => j !== i))} className="text-text-muted hover:text-red-500 px-2">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button onClick={() => setCmdVars([...cmdVars, { key: '', value: '' }])} className="text-xs text-sky-600 dark:text-sky-400 hover:text-sky-500">+ Add Variable</button>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setShowAdd(false)} className="btn-ghost">Cancel</button>
          <button onClick={handleAdd} disabled={!newCmd.name || !newCmd.command} className="btn-primary disabled:opacity-50">Add</button>
        </div>
      </Modal>

      <Modal open={!!previewCmd} onClose={() => setPreviewCmd(null)} title="Command Preview" size="lg">
        {previewCmd && (
          <div className="space-y-4">
            <div>
              <label className="form-label">Resolve for project:</label>
              <select value={previewProject} onChange={(e) => setPreviewProject(e.target.value)} className="form-input">
                <option value="">Select project...</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <p className="text-xs text-text-faint mb-1.5">Template:</p>
              <pre className="code-block">{previewCmd.command}</pre>
            </div>
            <div>
              <p className="text-xs text-text-faint mb-1.5">Resolved:</p>
              <pre className="code-block-resolved">
                {previewProject ? resolvePreview(previewCmd, previewProject).resolved : previewCmd.command}
              </pre>
            </div>
            {previewProject && resolvePreview(previewCmd, previewProject).missing.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="w-3.5 h-3.5" />
                Missing: {resolvePreview(previewCmd, previewProject).missing.map(m => `{{${m}}}`).join(', ')}
              </div>
            )}
            <div className="flex justify-end">
              <CopyButton value={previewProject ? resolvePreview(previewCmd, previewProject).resolved : previewCmd.command} label="Copy Resolved" />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
