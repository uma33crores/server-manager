import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Server } from '@/lib/supabase';
import { StatusBadge } from '@/components/Badge';
import Modal from '@/components/Modal';
import CopyButton from '@/components/CopyButton';
import { Plus, Server as ServerIcon, ExternalLink, Cpu, HardDrive, MapPin, Globe, AlertCircle } from 'lucide-react';
import { ENVIRONMENTS } from '@/lib/constants';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/PageLoader';

export default function Servers() {
  const { isReadOnly } = useAuth();
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    name: '',
    environment: 'testing' as string,
    provider: 'DigitalOcean',
    public_ip: '',
    hostname: '',
    ssh_username: 'root',
    ssh_port: '22',
    operating_system: 'Ubuntu 22.04 LTS',
    region: '',
    ram: '',
    disk: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase.from('servers').select('*').order('created_at', { ascending: false });
    setServers((data as Server[]) ?? []);
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from('servers')
      .insert({
        name: form.name,
        environment: form.environment,
        provider: form.provider || null,
        public_ip: form.public_ip || null,
        hostname: form.hostname || null,
        ssh_username: form.ssh_username || null,
        ssh_port: parseInt(form.ssh_port) || 22,
        operating_system: form.operating_system || null,
        region: form.region || null,
        ram: form.ram || null,
        disk: form.disk || null,
        notes: form.notes || null,
      })
      .select()
      .single();

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setShowModal(false);
    setForm({
      name: '',
      environment: 'testing',
      provider: 'DigitalOcean',
      public_ip: '',
      hostname: '',
      ssh_username: 'root',
      ssh_port: '22',
      operating_system: 'Ubuntu 22.04 LTS',
      region: '',
      ram: '',
      disk: '',
      notes: '',
    });
    await load();
  }

  if (loading) return <PageLoader label="Loading servers..." />;

  const envCounts = servers.reduce<Record<string, number>>((acc, s) => {
    acc[s.environment] = (acc[s.environment] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Servers</h1>
          <p className="page-subtitle">{servers.length} server{servers.length !== 1 ? 's' : ''} registered</p>
        </div>
        {!isReadOnly && (
          <button onClick={() => setShowModal(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            Add Server
          </button>
        )}
      </div>

      {servers.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="card p-4">
            <div className="stat-icon bg-sky-500/10 w-9 h-9 mb-2">
              <Globe className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            </div>
            <div className="text-xl font-bold text-text-primary leading-none">{envCounts.testing ?? 0}</div>
            <div className="text-xs text-text-muted mt-1">Testing</div>
          </div>
          <div className="card p-4">
            <div className="stat-icon bg-amber-500/10 w-9 h-9 mb-2">
              <Globe className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="text-xl font-bold text-text-primary leading-none">{envCounts.staging ?? 0}</div>
            <div className="text-xs text-text-muted mt-1">Staging</div>
          </div>
          <div className="card p-4">
            <div className="stat-icon bg-emerald-500/10 w-9 h-9 mb-2">
              <Globe className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="text-xl font-bold text-text-primary leading-none">{envCounts.production ?? 0}</div>
            <div className="text-xs text-text-muted mt-1">Production</div>
          </div>
        </div>
      )}

      {servers.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <ServerIcon className="w-7 h-7" />
            </div>
            <p className="text-text-muted text-sm mb-1">No servers yet</p>
            {!isReadOnly ? (
              <button onClick={() => setShowModal(true)} className="btn-primary mt-4">
                <Plus className="w-4 h-4" />
                Add your first server
              </button>
            ) : (
              <p className="text-text-faint text-xs">No servers to display</p>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {servers.map((s) => (
            <Link
              key={s.id}
              to={`/servers/${s.id}`}
              className="card-hover p-5 group block"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-text-primary group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">{s.name}</h3>
                  <div className="mt-1.5">
                    <StatusBadge status={s.environment} />
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-text-faint group-hover:text-text-secondary transition-colors" />
              </div>
              <div className="space-y-2.5 text-sm">
                {s.public_ip && (
                  <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-text-faint flex-shrink-0" />
                    <span className="font-mono text-xs text-text-secondary">{s.public_ip}</span>
                    <CopyButton value={s.public_ip} />
                  </div>
                )}
                {s.provider && (
                  <div className="flex items-center gap-2 text-text-muted">
                    <span className="text-xs">Provider:</span>
                    <span className="text-text-secondary text-xs font-medium">{s.provider}</span>
                  </div>
                )}
                {s.region && (
                  <div className="flex items-center gap-2 text-text-muted">
                    <MapPin className="w-3.5 h-3.5 text-text-faint" />
                    <span className="text-text-secondary text-xs">{s.region}</span>
                  </div>
                )}
                {s.ram && (
                  <div className="flex items-center gap-2 text-text-muted">
                    <Cpu className="w-3.5 h-3.5 text-text-faint" />
                    <span className="text-text-secondary text-xs">{s.ram}</span>
                  </div>
                )}
                {s.disk && (
                  <div className="flex items-center gap-2 text-text-muted">
                    <HardDrive className="w-3.5 h-3.5 text-text-faint" />
                    <span className="text-text-secondary text-xs">{s.disk}</span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Server" size="lg">
        {error && (
          <div className="alert-error mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Server Name" required>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="form-input" />
          </Field>
          <Field label="Environment" required>
            <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} className="form-input">
              {ENVIRONMENTS.map((env) => (
                <option key={env} value={env}>{env.charAt(0).toUpperCase() + env.slice(1)}</option>
              ))}
            </select>
          </Field>
          <Field label="Provider">
            <input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className="form-input" />
          </Field>
          <Field label="Public IP">
            <input value={form.public_ip} onChange={(e) => setForm({ ...form, public_ip: e.target.value })} className="form-input font-mono" />
          </Field>
          <Field label="Hostname">
            <input value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} className="form-input font-mono" />
          </Field>
          <Field label="SSH Username">
            <input value={form.ssh_username} onChange={(e) => setForm({ ...form, ssh_username: e.target.value })} className="form-input font-mono" />
          </Field>
          <Field label="SSH Port">
            <input value={form.ssh_port} onChange={(e) => setForm({ ...form, ssh_port: e.target.value })} className="form-input font-mono" />
          </Field>
          <Field label="Operating System">
            <input value={form.operating_system} onChange={(e) => setForm({ ...form, operating_system: e.target.value })} className="form-input" />
          </Field>
          <Field label="Region">
            <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className="form-input" />
          </Field>
          <Field label="RAM">
            <input value={form.ram} onChange={(e) => setForm({ ...form, ram: e.target.value })} className="form-input" />
          </Field>
          <Field label="Disk">
            <input value={form.disk} onChange={(e) => setForm({ ...form, disk: e.target.value })} className="form-input" />
          </Field>
          <Field label="Notes" full>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="form-input" rows={2} />
          </Field>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setShowModal(false)} className="btn-ghost">Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.name} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving...' : 'Create Server'}
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
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
