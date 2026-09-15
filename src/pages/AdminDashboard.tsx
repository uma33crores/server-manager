import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ManagedUser, Server, Project } from '@/lib/supabase';
import Modal from '@/components/Modal';
import { StatusBadge } from '@/components/Badge';
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  ShieldCheck,
  ShieldOff,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Server as ServerIcon,
  FolderGit2,
  Mail,
  Lock,
  AlertCircle,
  Eye,
} from 'lucide-react';
import PageLoader from '@/components/PageLoader';

type EditForm = {
  email: string;
  password: string;
  role: 'admin' | 'user';
  access_type: 'read_only' | 'write';
  is_active: boolean;
  server_ids: string[];
  project_ids: string[];
};

const emptyForm: EditForm = {
  email: '',
  password: '',
  role: 'user',
  access_type: 'write',
  is_active: true,
  server_ids: [],
  project_ids: [],
};

export default function AdminDashboard() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState<EditForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ManagedUser | null>(null);
  const [confirmReverify, setConfirmReverify] = useState<ManagedUser | null>(null);
  const [reverifyLoading, setReverifyLoading] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [{ data: sData }, { data: pData }] = await Promise.all([
      supabase.from('servers').select('*').order('name'),
      supabase.from('projects').select('*').order('name'),
    ]);
    setServers((sData as Server[]) ?? []);
    setProjects((pData as Project[]) ?? []);
    await loadUsers();
    setLoading(false);
  }

  async function loadUsers() {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return;

    const { data, error } = await supabase.functions.invoke('user-management', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (error) {
      setError(error.message);
      return;
    }

    setUsers((data as { users: ManagedUser[] })?.users ?? []);
  }

  function openCreate() {
    setEditingUser(null);
    setForm(emptyForm);
    setError(null);
    setShowModal(true);
  }

  function openEdit(u: ManagedUser) {
    setEditingUser(u);
    setForm({
      email: u.email,
      password: '',
      role: u.role,
      access_type: u.access_type ?? 'write',
      is_active: u.is_active,
      server_ids: u.server_ids,
      project_ids: u.project_ids,
    });
    setError(null);
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) {
      setError('Not authenticated');
      setSaving(false);
      return;
    }

    try {
      if (editingUser) {
        const payload: Record<string, unknown> = {
          role: form.role,
          access_type: form.access_type,
          is_active: form.is_active,
          server_ids: form.server_ids,
          project_ids: form.project_ids,
        };
        if (form.password) {
          payload.password = form.password;
        }

        const { error: fnError } = await supabase.functions.invoke('user-management', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
          body: { ...payload, userId: editingUser.id },
        });

        if (fnError) throw new Error(fnError.message);
      } else {
        if (!form.email || !form.password) {
          throw new Error('Email and password are required');
        }

        const { error: fnError } = await supabase.functions.invoke('user-management', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: {
            email: form.email,
            password: form.password,
            role: form.role,
            access_type: form.access_type,
            is_active: form.is_active,
            server_ids: form.server_ids,
            project_ids: form.project_ids,
          },
        });

        if (fnError) throw new Error(fnError.message);
      }

      setShowModal(false);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(u: ManagedUser) {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return;

    const { data, error } = await supabase.functions.invoke('user-management', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: { is_active: !u.is_active, userId: u.id },
    });

    if (error) {
      setError(error.message);
      return;
    }
    if (data && (data as { error?: string }).error) {
      setError((data as { error: string }).error);
      return;
    }
    await loadUsers();
  }

  async function handleReverify(u: ManagedUser) {
    setReverifyLoading(true);
    setConfirmReverify(null);
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) {
      setError('Not authenticated');
      setReverifyLoading(false);
      return;
    }

    const { error } = await supabase.functions.invoke('user-management', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: { reverification_required: true, userId: u.id },
    });

    if (error) {
      setError(error.message);
      setReverifyLoading(false);
      return;
    }
    await loadUsers();
    setReverifyLoading(false);
  }

  async function handleDelete(u: ManagedUser) {
    setConfirmDelete(null);
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return;

    const { error } = await supabase.functions.invoke('user-management', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      body: { userId: u.id },
    });

    if (error) {
      setError(error.message);
      return;
    }
    await loadUsers();
  }

  function toggleServer(id: string) {
    setForm((f) => {
      const isRemoving = f.server_ids.includes(id);
      const nextServerIds = isRemoving
        ? f.server_ids.filter((s) => s !== id)
        : [...f.server_ids, id];

      let nextProjectIds = f.project_ids;
      if (isRemoving) {
        const removedServerProjects = new Set(
          projects.filter((p) => p.server_id === id).map((p) => p.id)
        );
        nextProjectIds = f.project_ids.filter((pid) => !removedServerProjects.has(pid));
      }

      return { ...f, server_ids: nextServerIds, project_ids: nextProjectIds };
    });
  }

  function toggleProject(id: string) {
    setForm((f) => ({
      ...f,
      project_ids: f.project_ids.includes(id)
        ? f.project_ids.filter((p) => p !== id)
        : [...f.project_ids, id],
    }));
  }

  const filteredProjects = form.server_ids.length > 0
    ? projects.filter((p) => form.server_ids.includes(p.server_id))
    : [];

  if (loading) return <PageLoader label="Loading admin dashboard..." />;

  const adminCount = users.filter((u) => u.role === 'admin').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Admin Dashboard</h1>
          <p className="text-sm text-text-muted mt-1">Manage users, roles, and access permissions</p>
        </div>
        <button
          onClick={openCreate}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {error && (
        <div className="alert-error mb-4">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-600 dark:text-red-400 hover:text-red-300">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard icon={Users} label="Total Users" value={users.length} color="text-sky-600 dark:text-sky-400" />
        <StatCard icon={ShieldCheck} label="Admins" value={adminCount} color="text-emerald-600 dark:text-emerald-400" />
        <StatCard icon={ShieldOff} label="Regular Users" value={users.length - adminCount} color="text-amber-600 dark:text-amber-400" />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Servers</th>
                <th>Projects</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-text-muted py-8">
                    No users yet. Click "Add User" to create one.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-surface-hover flex items-center justify-center text-xs text-text-secondary font-medium">
                          {u.email[0]?.toUpperCase()}
                        </div>
                        <span className="text-text-primary">{u.email}</span>
                      </div>
                    </td>
                    <td>
                      {u.role === 'admin' ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                          <ShieldCheck className="w-3 h-3" />
                          Admin
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-surface-hover text-text-secondary">
                          User
                        </span>
                      )}
                      {u.role === 'user' && (u.access_type ?? 'write') === 'read_only' && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 ml-1">
                          <Eye className="w-3 h-3" />
                          Read Only
                        </span>
                      )}
                    </td>
                    <td>
                      {u.is_active ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                          <XCircle className="w-3.5 h-3.5" />
                          Disabled
                        </span>
                      )}
                    </td>
                    <td>
                      {u.role === 'admin' ? (
                        <span className="text-text-faint italic">All</span>
                      ) : u.server_ids.length === 0 ? (
                        <span className="text-text-faint">None</span>
                      ) : (
                        <span>{u.server_ids.length} server(s)</span>
                      )}
                    </td>
                    <td>
                      {u.role === 'admin' ? (
                        <span className="text-text-faint italic">All</span>
                      ) : u.project_ids.length === 0 ? (
                        <span className="text-text-faint">None</span>
                      ) : (
                        <span>{u.project_ids.length} project(s)</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        {u.reverification_required && (
                          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                            <ShieldAlert className="w-3 h-3" />
                            Locked
                          </span>
                        )}
                        <button
                          onClick={() => handleToggleActive(u)}
                          title={u.is_active ? 'Disable user' : 'Enable user'}
                          className="p-1.5 rounded text-text-muted hover:text-amber-600 dark:text-amber-400 hover:bg-surface-hover transition-colors"
                        >
                          {u.is_active ? <ShieldOff className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => setConfirmReverify(u)}
                          title="Require re-verification"
                          className="p-1.5 rounded text-text-muted hover:text-amber-600 dark:text-amber-400 hover:bg-surface-hover transition-colors"
                        >
                          <ShieldAlert className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEdit(u)}
                          title="Edit user"
                          className="p-1.5 rounded text-text-muted hover:text-sky-600 dark:text-sky-400 hover:bg-surface-hover transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(u)}
                          title="Delete user"
                          className="p-1.5 rounded text-text-muted hover:text-red-600 dark:text-red-400 hover:bg-surface-hover transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingUser ? 'Edit User' : 'Add User'} size="lg">
        {error && (
          <div className="alert-error mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">
                <span className="inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> Email</span>
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                disabled={!!editingUser}
                required
                className="form-input disabled:opacity-60"
              />
            </div>
            <div>
              <label className="form-label">
                <span className="inline-flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Password {editingUser && '(leave blank to keep)'}</span>
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required={!editingUser}
                minLength={6}
                placeholder={editingUser ? 'Unchanged' : 'Min 6 characters'}
                className="form-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'user' })}
                className="form-input"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="form-label">Account Status</label>
              <select
                value={form.is_active ? 'active' : 'disabled'}
                onChange={(e) => setForm({ ...form, is_active: e.target.value === 'active' })}
                className="form-input"
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
          </div>

          {form.role === 'user' && (
            <div>
              <label className="form-label">Access Type</label>
              <select
                value={form.access_type}
                onChange={(e) => setForm({ ...form, access_type: e.target.value as 'read_only' | 'write' })}
                className="form-input"
              >
                <option value="write">Write (full access)</option>
                <option value="read_only">Read Only (view only)</option>
              </select>
              {form.access_type === 'read_only' && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" />
                  Read-only users can view all data but cannot add, edit, delete, or execute any modifying actions.
                </p>
              )}
            </div>
          )}

          {form.role === 'user' && (
            <div className="space-y-4">
              <div>
                <label className="form-label mb-2">
                  <span className="inline-flex items-center gap-1.5"><ServerIcon className="w-4 h-4" /> Server Access</span>
                </label>
                {servers.length === 0 ? (
                  <p className="text-sm text-text-faint">No servers available.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                    {servers.map((s) => (
                      <label
                        key={s.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                          form.server_ids.includes(s.id)
                            ? 'bg-sky-500/10 border-sky-500/30 text-sky-600 dark:text-sky-300'
                            : 'bg-code-bg border-border text-text-secondary hover:border-border-hover'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={form.server_ids.includes(s.id)}
                          onChange={() => toggleServer(s.id)}
                          className="accent-sky-500"
                        />
                        <span className="text-sm">{s.name}</span>
                        <StatusBadge status={s.environment} />
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="form-label mb-2">
                  <span className="inline-flex items-center gap-1.5"><FolderGit2 className="w-4 h-4" /> Project Access</span>
                </label>
                {form.server_ids.length === 0 ? (
                  <p className="text-sm text-text-faint">Select at least one server to see available projects.</p>
                ) : filteredProjects.length === 0 ? (
                  <p className="text-sm text-text-faint">No projects on the selected server(s).</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                    {filteredProjects.map((p) => {
                      const server = servers.find((s) => s.id === p.server_id);
                      return (
                        <label
                          key={p.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                            form.project_ids.includes(p.id)
                              ? 'bg-sky-500/10 border-sky-500/30 text-sky-600 dark:text-sky-300'
                              : 'bg-code-bg border-border text-text-secondary hover:border-border-hover'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={form.project_ids.includes(p.id)}
                            onChange={() => toggleProject(p.id)}
                            className="accent-sky-500"
                          />
                          <span className="text-sm">{p.name}</span>
                          <span className="text-xs text-text-faint">{server?.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {form.role === 'admin' && (
            <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg px-4 py-3">
              <p className="text-sm text-sky-600 dark:text-sky-300">
                <ShieldCheck className="w-4 h-4 inline mr-1.5" />
                Admin users automatically have access to all servers and projects.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowModal(false)} className="btn-ghost">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || (!editingUser && (!form.email || !form.password))}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingUser ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!confirmReverify} onClose={() => setConfirmReverify(null)} title="Require Re-Verification" size="sm">
        {confirmReverify && (
          <div>
            <div className="flex items-start gap-3 mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-md">
              <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-text-secondary font-medium">
                  Force <span className="font-semibold">{confirmReverify.email}</span> to re-verify?
                </p>
                <p className="text-xs text-text-muted mt-1">
                  This user will be immediately locked out of the application and required to
                  enter an OTP code sent to their email before they can continue.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmReverify(null)} className="btn-ghost">
                Cancel
              </button>
              <button
                onClick={() => handleReverify(confirmReverify)}
                disabled={reverifyLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-all duration-150"
              >
                {reverifyLoading ? 'Processing...' : 'Require Re-Verification'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete User" size="sm">
        {confirmDelete && (
          <div>
            <p className="text-sm text-text-secondary mb-2">
              Are you sure you want to permanently delete <span className="font-semibold text-text-primary">{confirmDelete.email}</span>?
            </p>
            <p className="text-sm text-text-muted mb-4">
              This will remove their account, role, and all access permissions. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelete(null)} className="btn-ghost">
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="btn-danger"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: typeof Users; label: string; value: number; color: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-5 h-5 ${color}`} />
        <span className="text-2xl font-bold text-text-primary">{value}</span>
      </div>
      <p className="text-sm text-text-muted">{label}</p>
    </div>
  );
}
