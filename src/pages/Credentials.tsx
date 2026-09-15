import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { CredentialWithRelations, Server, Project } from '@/lib/supabase';
import { StatusBadge } from '@/components/Badge';
import SensitiveValue from '@/components/SensitiveValue';
import CopyButton from '@/components/CopyButton';
import Modal from '@/components/Modal';
import { Plus, Trash2, Search, KeyRound, Lock } from 'lucide-react';
import { CREDENTIAL_TYPES } from '@/lib/constants';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/PageLoader';
import ConfirmDialog from '@/components/ConfirmDialog';

export default function Credentials() {
  const { isReadOnly } = useAuth();
  const [creds, setCreds] = useState<CredentialWithRelations[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newCred, setNewCred] = useState({
    scope: 'server' as 'server' | 'project',
    server_id: '',
    project_id: '',
    type: 'Other',
    name: '',
    value: '',
    is_sensitive: true,
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CredentialWithRelations | null>(null);

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
      .from('credentials')
      .select('*, server:servers(id, name), project:projects(id, name, slug)')
      .order('created_at', { ascending: false });
    setCreds((data as unknown as CredentialWithRelations[]) ?? []);
    setLoading(false);
  }

  async function handleAdd() {
    setError(null);
    if (!newCred.name || !newCred.value) { setError('Name and value are required'); return; }

    const payload: Record<string, unknown> = {
      scope: newCred.scope,
      type: newCred.type,
      name: newCred.name,
      value: newCred.value,
      is_sensitive: newCred.is_sensitive,
      notes: newCred.notes || null,
    };

    if (newCred.scope === 'server') {
      if (!newCred.server_id) { setError('Server is required'); return; }
      payload.server_id = newCred.server_id;
      payload.project_id = null;
    } else {
      if (!newCred.project_id) { setError('Project is required'); return; }
      payload.project_id = newCred.project_id;
      payload.server_id = null;
    }

    const { error: e } = await supabase.from('credentials').insert(payload);
    if (e) { setError(e.message); return; }
    setNewCred({ scope: 'server', server_id: '', project_id: '', type: 'Other', name: '', value: '', is_sensitive: true, notes: '' });
    setShowAdd(false);
    await load();
  }

  async function handleDelete(id: string) {
    await supabase.from('credentials').delete().eq('id', id);
    await load();
    setConfirmDelete(null);
  }

  const filtered = creds.filter((c) => {
    if (search) {
      const q = search.toLowerCase();
      if (!c.name.toLowerCase().includes(q) && !c.type.toLowerCase().includes(q)) return false;
    }
    if (typeFilter && c.type !== typeFilter) return false;
    return true;
  });

  if (loading) return <PageLoader label="Loading credentials..." />;

  const sensitiveCount = creds.filter((c) => c.is_sensitive).length;

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Credentials</h1>
          <p className="page-subtitle">{creds.length} credential{creds.length !== 1 ? 's' : ''} stored</p>
        </div>
        {!isReadOnly && (
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Add Credential
          </button>
        )}
      </div>

      {creds.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="card p-4 flex items-center gap-3">
            <div className="stat-icon bg-sky-500/10 w-9 h-9">
              <KeyRound className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-text-primary leading-none">{creds.length}</div>
              <div className="text-xs text-text-muted mt-0.5">Total Credentials</div>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <div className="stat-icon bg-amber-500/10 w-9 h-9">
              <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-text-primary leading-none">{sensitiveCount}</div>
              <div className="text-xs text-text-muted mt-0.5">Sensitive (Hidden)</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or type..." className="search-input" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="filter-select">
          <option value="">All Types</option>
          {CREDENTIAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <KeyRound className="w-7 h-7" />
            </div>
            <p className="text-text-muted text-sm">No credentials found</p>
            <p className="text-text-faint text-xs mt-0.5">Try adjusting your search or filters</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((c) => (
            <div key={c.id} className="card-hover p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-text-primary">{c.name}</span>
                    <StatusBadge status={c.type} />
                    <span className="scope-badge">{c.scope}</span>
                    {c.is_sensitive && <span className="sensitive-badge"><Lock className="w-3 h-3" /> Sensitive</span>}
                  </div>
                </div>
                {!isReadOnly && (
                  <button onClick={() => setConfirmDelete(c)} className="text-text-muted hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-surface-hover ml-2 flex-shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mb-3">
                <SensitiveValue value={c.value} isSensitive={c.is_sensitive} />
                <CopyButton value={c.value} />
              </div>
              <div className="flex items-center gap-2 text-xs text-text-faint">
                <span>{c.server?.name ?? c.project?.name ?? ''}</span>
                {c.project && (
                  <Link to={`/projects/${c.project.id}`} className="text-sky-600 dark:text-sky-400 hover:text-sky-500">Open Project</Link>
                )}
              </div>
              {c.notes && <p className="text-xs text-text-muted mt-2 pt-2 border-t border-border/60">{c.notes}</p>}
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
        {error && <div className="alert-error mb-4">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="form-label">Scope</label>
            <select value={newCred.scope} onChange={(e) => setNewCred({ ...newCred, scope: e.target.value as 'server' | 'project' })} className="form-input">
              <option value="server">Server</option>
              <option value="project">Project</option>
            </select>
          </div>
          {newCred.scope === 'server' && (
            <div>
              <label className="form-label">Server</label>
              <select value={newCred.server_id} onChange={(e) => setNewCred({ ...newCred, server_id: e.target.value })} className="form-input">
                <option value="">Select server...</option>
                {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {newCred.scope === 'project' && (
            <div>
              <label className="form-label">Project</label>
              <select value={newCred.project_id} onChange={(e) => setNewCred({ ...newCred, project_id: e.target.value })} className="form-input">
                <option value="">Select project...</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="form-label">Type</label>
            <select value={newCred.type} onChange={(e) => setNewCred({ ...newCred, type: e.target.value })} className="form-input">
              {CREDENTIAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
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
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input type="checkbox" checked={newCred.is_sensitive} onChange={(e) => setNewCred({ ...newCred, is_sensitive: e.target.checked })} className="rounded accent-sky-500" />
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
