import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Credential } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import SensitiveValue from '@/components/SensitiveValue';
import CopyButton from '@/components/CopyButton';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Plus, Trash2, Pencil, KeyRound, AlertCircle, X } from 'lucide-react';

type Props = {
  serverId: string;
};

export default function ServerCredentialsSection({ serverId }: Props) {
  const { isReadOnly } = useAuth();
  const [creds, setCreds] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Credential | null>(null);
  const [form, setForm] = useState({ name: '', value: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Credential | null>(null);

  const load = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('credentials')
      .select('*')
      .eq('scope', 'server')
      .eq('server_id', serverId)
      .order('created_at', { ascending: false });
    if (queryError) {
      setError(queryError.message);
    }
    setCreds((data as Credential[]) ?? []);
    setLoading(false);
  }, [serverId]);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setEditing(null);
    setForm({ name: '', value: '', notes: '' });
    setError(null);
    setShowAdd(true);
  }

  function openEdit(cred: Credential) {
    setEditing(cred);
    setForm({ name: cred.name, value: cred.value, notes: cred.notes ?? '' });
    setError(null);
    setShowAdd(true);
  }

  async function handleSave() {
    setError(null);
    if (!form.name.trim()) { setError('Key is required'); return; }
    if (!form.value.trim()) { setError('Value is required'); return; }

    if (editing) {
      const { error: e } = await supabase
        .from('credentials')
        .update({ name: form.name.trim(), value: form.value, notes: form.notes || null })
        .eq('id', editing.id);
      if (e) { setError(e.message); return; }
    } else {
      const { error: e } = await supabase
        .from('credentials')
        .insert({
          scope: 'server',
          server_id: serverId,
          project_id: null,
          type: 'Other',
          name: form.name.trim(),
          value: form.value,
          is_sensitive: true,
          notes: form.notes || null,
        });
      if (e) { setError(e.message); return; }
    }
    setShowAdd(false);
    await load();
  }

  async function handleDelete(cred: Credential) {
    setConfirmDelete(null);
    await supabase.from('credentials').delete().eq('id', cred.id);
    await load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-primary">Credentials ({creds.length})</h2>
        {!isReadOnly && (
          <button onClick={openAdd} className="btn-primary btn-sm">
            <Plus className="w-3.5 h-3.5" /> Add Credential
          </button>
        )}
      </div>

      {error && (
        <div className="alert-error mb-4">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-text-muted text-sm">Loading credentials...</p>
      ) : creds.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><KeyRound className="w-7 h-7" /></div>
          <p className="text-text-muted text-sm">No credentials stored for this server</p>
          <p className="text-text-faint text-xs mt-0.5">Add SSH passwords, API keys, and other server secrets</p>
        </div>
      ) : (
        <div className="space-y-3">
          {creds.map((c) => (
            <div key={c.id} className="card-hover p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-text-primary">{c.name}</span>
                  <div className="flex items-center gap-2 mt-2">
                    <SensitiveValue value={c.value} isSensitive={c.is_sensitive} />
                    <CopyButton value={c.value} />
                  </div>
                  {c.notes && <p className="text-xs text-text-muted mt-2">{c.notes}</p>}
                </div>
                {!isReadOnly && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors" title="Edit">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => setConfirmDelete(c)} className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-surface-hover transition-colors" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={editing ? 'Edit Credential' : 'Add Credential'} size="md">
        {error && (
          <div className="alert-error mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="form-label">Key <span className="text-red-400">*</span></label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. SSH_PASSWORD" className="form-input font-mono text-sm" />
          </div>
          <div>
            <label className="form-label">Value <span className="text-red-400">*</span></label>
            <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Enter credential value" className="form-input font-mono text-sm" />
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="form-input" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setShowAdd(false)} className="btn-ghost">Cancel</button>
          <button onClick={handleSave} disabled={!form.name.trim() || !form.value.trim()} className="btn-primary disabled:opacity-50">
            {editing ? 'Save Changes' : 'Add Credential'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Credential"
        message="Are you sure you want to delete this credential?"
        itemName={confirmDelete?.name}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
