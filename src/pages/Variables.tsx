import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { ConfigVariableWithRelations, Server, Project } from '@/lib/supabase';
import SensitiveValue from '@/components/SensitiveValue';
import CopyButton from '@/components/CopyButton';
import Modal from '@/components/Modal';
import { normalizeKey, isReservedKey } from '@/lib/utils';
import { Plus, Trash2, Search, AlertCircle, Variable, Lock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/PageLoader';
import ConfirmDialog from '@/components/ConfirmDialog';

export default function Variables() {
  const { isReadOnly } = useAuth();
  const [vars, setVars] = useState<ConfigVariableWithRelations[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [sensitiveFilter, setSensitiveFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newVar, setNewVar] = useState({
    scope: 'global' as 'global' | 'server' | 'project',
    server_id: '',
    project_id: '',
    key: '',
    value: '',
    is_sensitive: false,
    description: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConfigVariableWithRelations | null>(null);

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
    const { data } = await supabase
      .from('config_variables')
      .select('*, server:servers(id, name), project:projects(id, name, slug)')
      .order('created_at', { ascending: false });
    setVars((data as unknown as ConfigVariableWithRelations[]) ?? []);
    setLoading(false);
  }

  async function handleAdd() {
    setError(null);
    const key = normalizeKey(newVar.key);
    if (!key) { setError('Key is required'); return; }
    if (isReservedKey(key)) { setError('This key is managed automatically by Server Manager.'); return; }

    const payload: Record<string, unknown> = {
      scope: newVar.scope,
      key,
      value: newVar.value,
      is_sensitive: newVar.is_sensitive,
      description: newVar.description || null,
      notes: newVar.notes || null,
    };

    if (newVar.scope === 'server') {
      if (!newVar.server_id) { setError('Server is required for server scope'); return; }
      payload.server_id = newVar.server_id;
      payload.project_id = null;
    } else if (newVar.scope === 'project') {
      if (!newVar.project_id) { setError('Project is required for project scope'); return; }
      payload.project_id = newVar.project_id;
      payload.server_id = null;
    } else {
      payload.server_id = null;
      payload.project_id = null;
    }

    const { error: e } = await supabase.from('config_variables').insert(payload);
    if (e) { setError(e.message); return; }
    setNewVar({ scope: 'global', server_id: '', project_id: '', key: '', value: '', is_sensitive: false, description: '', notes: '' });
    setShowAdd(false);
    await load();
  }

  async function handleDelete(id: string) {
    await supabase.from('config_variables').delete().eq('id', id);
    await load();
    setConfirmDelete(null);
  }

  const filtered = vars.filter((v) => {
    if (search && !v.key.toLowerCase().includes(search.toLowerCase())) return false;
    if (scopeFilter && v.scope !== scopeFilter) return false;
    if (sensitiveFilter === 'yes' && !v.is_sensitive) return false;
    if (sensitiveFilter === 'no' && v.is_sensitive) return false;
    return true;
  });

  if (loading) return <PageLoader label="Loading variables..." />;

  const sensitiveCount = vars.filter((v) => v.is_sensitive).length;

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Variables</h1>
          <p className="page-subtitle">{vars.length} variable{vars.length !== 1 ? 's' : ''} stored</p>
        </div>
        {!isReadOnly && (
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Add Variable
          </button>
        )}
      </div>

      {vars.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="card p-4 flex items-center gap-3">
            <div className="stat-icon bg-sky-500/10 w-9 h-9">
              <Variable className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-text-primary leading-none">{vars.length}</div>
              <div className="text-xs text-text-muted mt-0.5">Total</div>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <div className="stat-icon bg-amber-500/10 w-9 h-9">
              <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-text-primary leading-none">{sensitiveCount}</div>
              <div className="text-xs text-text-muted mt-0.5">Sensitive</div>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <div className="stat-icon bg-surface-hover w-9 h-9">
              <Variable className="w-4 h-4 text-text-secondary" />
            </div>
            <div>
              <div className="text-xl font-bold text-text-primary leading-none">{vars.length - sensitiveCount}</div>
              <div className="text-xs text-text-muted mt-0.5">Non-Sensitive</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by key..." className="search-input" />
        </div>
        <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} className="filter-select">
          <option value="">All Scopes</option>
          <option value="global">Global</option>
          <option value="server">Server</option>
          <option value="project">Project</option>
        </select>
        <select value={sensitiveFilter} onChange={(e) => setSensitiveFilter(e.target.value)} className="filter-select">
          <option value="">All</option>
          <option value="yes">Sensitive</option>
          <option value="no">Not Sensitive</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th>Scope</th>
                <th>Server/Project</th>
                <th>Sensitive</th>
                <th>Updated</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-text-muted py-12">No variables found</td></tr>
              ) : (
                filtered.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <code className="font-mono text-sky-600 dark:text-sky-400 font-medium text-sm">{v.key}</code>
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
                    <td><span className="scope-badge">{v.scope}</span></td>
                    <td className="text-text-muted text-xs">{v.server?.name ?? v.project?.name ?? '-'}</td>
                    <td>
                      {v.is_sensitive ? <span className="sensitive-badge">Yes</span> : <span className="text-text-faint text-xs">No</span>}
                    </td>
                    <td className="text-text-faint text-xs">{new Date(v.updated_at).toLocaleDateString()}</td>
                    <td className="text-right">
                      {!isReadOnly && (
                        <button onClick={() => setConfirmDelete(v)} className="text-text-muted hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-surface-hover">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
          <div className="alert-error mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="form-label">Scope</label>
            <select
              value={newVar.scope}
              onChange={(e) => setNewVar({ ...newVar, scope: e.target.value as 'global' | 'server' | 'project' })}
              className="form-input"
            >
              <option value="global">Global</option>
              <option value="server">Server</option>
              <option value="project">Project</option>
            </select>
          </div>
          {newVar.scope === 'server' && (
            <div>
              <label className="form-label">Server</label>
              <select value={newVar.server_id} onChange={(e) => setNewVar({ ...newVar, server_id: e.target.value })} className="form-input">
                <option value="">Select server...</option>
                {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {newVar.scope === 'project' && (
            <div>
              <label className="form-label">Project</label>
              <select value={newVar.project_id} onChange={(e) => setNewVar({ ...newVar, project_id: e.target.value })} className="form-input">
                <option value="">Select project...</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="form-label">Key</label>
            <input value={newVar.key} onChange={(e) => setNewVar({ ...newVar, key: e.target.value })} placeholder="e.g. SMTP_HOST" className="form-input font-mono text-sm" />
            <p className="form-hint">Will be normalized to UPPER_SNAKE_CASE</p>
          </div>
          <div>
            <label className="form-label">Value</label>
            <input value={newVar.value} onChange={(e) => setNewVar({ ...newVar, value: e.target.value })} className="form-input font-mono text-sm" />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input type="checkbox" checked={newVar.is_sensitive} onChange={(e) => setNewVar({ ...newVar, is_sensitive: e.target.checked })} className="rounded accent-sky-500" />
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
    </div>
  );
}
