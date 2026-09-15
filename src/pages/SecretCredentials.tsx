import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { CredentialWithRelations } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useAdminReauth } from '@/context/AdminReauthContext';
import SensitiveValue from '@/components/SensitiveValue';
import CopyButton from '@/components/CopyButton';
import Modal from '@/components/Modal';
import OtpModal from '@/components/OtpModal';
import ConfirmDialog from '@/components/ConfirmDialog';
import PageLoader from '@/components/PageLoader';
import { Plus, Trash2, Pencil, KeyRound, Lock, AlertCircle, X, ShieldCheck, Eye } from 'lucide-react';

type Tab = 'overall' | 'customised';

export default function SecretCredentials() {
  const { isReadOnly, isAdmin } = useAuth();
  const { isReauthed, requestOtp, verifyOtp, otpLoading, otpError, showOtpModal, resendCooldown, resendOtp, cancelOtp } = useAdminReauth();

  const [tab, setTab] = useState<Tab>('overall');
  const [creds, setCreds] = useState<CredentialWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<CredentialWithRelations | null>(null);
  const [form, setForm] = useState({ key: '', value: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CredentialWithRelations | null>(null);
  const [deleteOtpOpen, setDeleteOtpOpen] = useState(false);
  const [deleteOtpError, setDeleteOtpError] = useState<string | null>(null);
  const [deleteOtpLoading, setDeleteOtpLoading] = useState(false);

  const load = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('credentials')
      .select('*, server:servers(id, name), project:projects(id, name, slug)')
      .order('created_at', { ascending: false });
    if (queryError) {
      setError(queryError.message);
    }
    setCreds((data as unknown as CredentialWithRelations[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isReauthed) {
      load();
    }
  }, [isReauthed, load]);

  function openAdd() {
    setEditing(null);
    setForm({ key: '', value: '', notes: '' });
    setError(null);
    setShowAdd(true);
  }

  function openEdit(cred: CredentialWithRelations) {
    setEditing(cred);
    setForm({ key: cred.name, value: cred.value, notes: cred.notes ?? '' });
    setError(null);
    setShowAdd(true);
  }

  async function handleSave() {
    setError(null);
    if (!form.key.trim()) { setError('Key is required'); return; }
    if (!form.value.trim()) { setError('Value is required'); return; }

    if (editing) {
      const { error: e } = await supabase
        .from('credentials')
        .update({ name: form.key.trim(), value: form.value, notes: form.notes || null })
        .eq('id', editing.id);
      if (e) { setError(e.message); return; }
    } else {
      const { error: e } = await supabase
        .from('credentials')
        .insert({
          scope: 'custom',
          server_id: null,
          project_id: null,
          type: 'Other',
          name: form.key.trim(),
          value: form.value,
          is_sensitive: true,
          notes: form.notes || null,
        });
      if (e) { setError(e.message); return; }
    }
    setShowAdd(false);
    await load();
  }

  function handleDeleteClick(cred: CredentialWithRelations) {
    setConfirmDelete(cred);
  }

  async function performDelete() {
    if (!confirmDelete) return;
    setDeleteOtpLoading(true);
    setDeleteOtpError(null);

    try {
      const { error: e } = await supabase.from('credentials').delete().eq('id', confirmDelete.id);
      if (e) { setDeleteOtpError(e.message); return; }
      setConfirmDelete(null);
      setDeleteOtpOpen(false);
      await load();
    } finally {
      setDeleteOtpLoading(false);
    }
  }

  async function handleDeleteOtpVerify(token: string) {
    setDeleteOtpLoading(true);
    setDeleteOtpError(null);
    try {
      const { error: e } = await supabase.auth.verifyOtp({
        email: 'umasankar.dash@33crores.com',
        token,
        type: 'email',
      });
      if (e) {
        setDeleteOtpError(e.message);
        return;
      }
      await performDelete();
    } finally {
      setDeleteOtpLoading(false);
    }
  }

  async function handleDeleteConfirm() {
    setConfirmDelete(null);
    setDeleteOtpError(null);
    setDeleteOtpOpen(true);
    try {
      await supabase.auth.signInWithOtp({
        email: 'umasankar.dash@33crores.com',
        options: { shouldCreateUser: false },
      });
    } catch {
      // OTP send best-effort
    }
  }

  function getSourceLabel(c: CredentialWithRelations): string {
    if (c.scope === 'server') return 'Server';
    if (c.scope === 'project') return 'Project';
    return 'Custom';
  }

  function getSourceName(c: CredentialWithRelations): string {
    return c.server?.name ?? c.project?.name ?? '—';
  }

  if (!isReauthed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-sm">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-sky-500/10 mb-4 mx-auto">
            <Lock className="w-8 h-8 text-sky-500" />
          </div>
          <h2 className="text-lg font-semibold text-text-primary mb-2">OTP Verification Required</h2>
          <p className="text-sm text-text-muted mb-6">
            An OTP has been sent to your admin email. Please verify to access Secret Credentials.
          </p>
          <button onClick={requestOtp} disabled={otpLoading} className="btn-primary">
            {otpLoading ? 'Sending OTP...' : 'Send OTP'}
          </button>
          {otpError && <p className="text-sm text-red-500 mt-3">{otpError}</p>}
        </div>
        <OtpModal
          open={showOtpModal}
          email="your admin email"
          loading={otpLoading}
          error={otpError}
          resendCooldown={resendCooldown}
          onSubmit={verifyOtp}
          onClose={cancelOtp}
          onResend={resendOtp}
        />
      </div>
    );
  }

  if (loading) return <PageLoader label="Loading secret credentials..." />;

  const overallCreds = creds;
  const customCreds = creds.filter((c) => c.scope === 'custom');

  const tabs: { id: Tab; label: string; icon: typeof KeyRound }[] = [
    { id: 'overall', label: 'Overall Credentials', icon: KeyRound },
    { id: 'customised', label: 'Customised Credentials', icon: ShieldCheck },
  ];

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Secret Credentials</h1>
          <p className="page-subtitle">
            {tab === 'overall' ? `${overallCreds.length} credential${overallCreds.length !== 1 ? 's' : ''} total` : `${customCreds.length} custom credential${customCreds.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {tab === 'customised' && !isReadOnly && isAdmin && (
          <button onClick={openAdd} className="btn-primary">
            <Plus className="w-4 h-4" /> Add Credential
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

      <div className="tab-bar mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`tab-button ${tab === t.id ? 'tab-button-active' : 'tab-button-inactive'}`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overall' ? (
        overallCreds.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon"><KeyRound className="w-7 h-7" /></div>
              <p className="text-text-muted text-sm">No credentials found</p>
            </div>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Source</th>
                  <th>Server/Project Name</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {overallCreds.map((c) => (
                  <tr key={c.id}>
                    <td className="text-sm font-medium text-text-primary">{c.name}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <SensitiveValue value={c.value} isSensitive={c.is_sensitive} />
                        <CopyButton value={c.value} />
                      </div>
                    </td>
                    <td>
                      <span className={`scope-badge ${c.scope === 'server' ? '' : c.scope === 'project' ? '' : 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30'}`}>
                        {getSourceLabel(c)}
                      </span>
                    </td>
                    <td className="text-sm text-text-muted">{getSourceName(c)}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {c.scope === 'custom' && isAdmin && !isReadOnly && (
                          <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors" title="Edit">
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {isAdmin && !isReadOnly && (
                          <button onClick={() => handleDeleteClick(c)} className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-surface-hover transition-colors" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        customCreds.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon"><ShieldCheck className="w-7 h-7" /></div>
              <p className="text-text-muted text-sm">No custom credentials yet</p>
              <p className="text-text-faint text-xs mt-0.5">Add standalone credentials not tied to any server or project</p>
            </div>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {customCreds.map((c) => (
                  <tr key={c.id}>
                    <td className="text-sm font-medium text-text-primary">{c.name}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <SensitiveValue value={c.value} isSensitive={c.is_sensitive} />
                        <CopyButton value={c.value} />
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {isAdmin && !isReadOnly && (
                          <>
                            <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors" title="Edit">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDeleteClick(c)} className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-surface-hover transition-colors" title="Delete">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Add/Edit Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={editing ? 'Edit Custom Credential' : 'Add Custom Credential'} size="md">
        {error && (
          <div className="alert-error mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="form-label">Key <span className="text-red-400">*</span></label>
            <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="e.g. DATABASE_PASSWORD" className="form-input font-mono text-sm" />
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
          <button onClick={handleSave} disabled={!form.key.trim() || !form.value.trim()} className="btn-primary disabled:opacity-50">
            {editing ? 'Save Changes' : 'Add Credential'}
          </button>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Credential"
        message="Deleting this credential requires OTP verification. An OTP will be sent to the admin email. Continue?"
        itemName={confirmDelete?.name}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Delete OTP Modal */}
      <OtpModal
        open={deleteOtpOpen}
        email="umasankar.dash@33crores.com"
        loading={deleteOtpLoading}
        error={deleteOtpError}
        resendCooldown={false}
        onSubmit={handleDeleteOtpVerify}
        onClose={() => { setDeleteOtpOpen(false); setDeleteOtpError(null); }}
        onResend={async () => {
          await supabase.auth.signInWithOtp({
            email: 'umasankar.dash@33crores.com',
            options: { shouldCreateUser: false },
          });
        }}
      />
    </div>
  );
}
