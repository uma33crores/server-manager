import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Server } from '@/lib/supabase';
import { generateSlug } from '@/lib/utils';
import { ArrowLeft, Check, Loader2, AlertCircle, Server as ServerIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PageLoader from '@/components/PageLoader';

export default function ProjectCreate() {
  const navigate = useNavigate();
  const { isReadOnly } = useAuth();
  const [params] = useSearchParams();
  const preselectedServer = params.get('server');

  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    server_id: preselectedServer ?? '',
    app_domain: '',
    supabase_domain: '',
    repository_url: '',
    git_branch: 'main',
    notes: '',
  });

  const [preview, setPreview] = useState<{
    slug: string;
    app_directory: string;
    supabase_directory: string;
    compose_name: string;
    project_slot: number | null;
    api_port: number | null;
    db_port: number | null;
    pooler_port: number | null;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('servers').select('*').order('name');
      setServers((data as Server[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const selectedServer = servers.find((s) => s.id === form.server_id);

  useEffect(() => {
    if (form.name && selectedServer) {
      const slug = generateSlug(form.name);
      setPreview({
        slug,
        app_directory: `${selectedServer.frontend_apps_directory}/${slug}`,
        supabase_directory: `${selectedServer.supabase_instances_directory}/${slug}`,
        compose_name: slug,
        project_slot: null,
        api_port: null,
        db_port: null,
        pooler_port: null,
      });
    } else {
      setPreview(null);
    }
  }, [form.name, selectedServer]);

  async function handleReview() {
    setError(null);
    if (!form.name || !form.server_id) {
      setError('Server and project name are required');
      return;
    }

    // Find first available slot
    const { data: slotData } = await supabase
      .from('port_allocations')
      .select('project_slot, api_port, db_port, pooler_port')
      .eq('server_id', form.server_id)
      .eq('status', 'available')
      .order('project_slot', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!slotData) {
      setError('No available port slots on this server');
      return;
    }

    setPreview((prev) => prev ? {
      ...prev,
      project_slot: slotData.project_slot,
      api_port: slotData.api_port,
      db_port: slotData.db_port,
      pooler_port: slotData.pooler_port,
    } : null);
    setStep('review');
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);

    const { data, error } = await supabase.rpc('create_project', {
      p_server_id: form.server_id,
      p_name: form.name,
      p_app_domain: form.app_domain || null,
      p_supabase_domain: form.supabase_domain || null,
      p_repository_url: form.repository_url || null,
      p_git_branch: form.git_branch || null,
      p_notes: form.notes || null,
    });

    setCreating(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (data && data.length > 0) {
      navigate(`/projects/${data[0].project_id}`);
    }
  }

  if (isReadOnly) {
    return (
      <div className="empty-state py-12">
        <div className="empty-state-icon"><AlertCircle className="w-7 h-7 text-amber-500" /></div>
        <p className="text-text-muted text-sm mb-4">Read-only users cannot create projects.</p>
        <Link to="/projects" className="text-sky-600 dark:text-sky-400 hover:text-sky-500">Back to Projects</Link>
      </div>
    );
  }

  if (loading) return <PageLoader label="Loading..." />;
  if (servers.length === 0) {
    return (
      <div className="empty-state py-12">
        <div className="empty-state-icon"><ServerIcon className="w-7 h-7" /></div>
        <p className="text-text-muted text-sm mb-4">You need to create a server first.</p>
        <Link to="/servers" className="text-sky-600 dark:text-sky-400 hover:text-sky-500">Go to Servers</Link>
      </div>
    );
  }

  return (
    <div>
      <Link to="/projects" className="flex items-center gap-2 text-text-muted hover:text-text-primary text-sm mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to Projects
      </Link>

      <h1 className="text-2xl font-bold text-text-primary mb-6">
        {step === 'form' ? 'Add Project' : 'Review Project'}
      </h1>

      {error && (
        <div className="alert-error mb-4">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {step === 'form' && (
        <div className="card p-6 max-w-2xl">
          <div className="space-y-4">
            <div>
              <label className="form-label">
                Project Name <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Bills TEST"
                className="form-input"
              />
              {preview && (
                <p className="mt-1 text-xs text-text-faint">
                  Slug: <code className="font-mono text-sky-600 dark:text-sky-400">{preview.slug}</code>
                </p>
              )}
            </div>

            <div>
              <label className="form-label">
                Server <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <select
                value={form.server_id}
                onChange={(e) => setForm({ ...form, server_id: e.target.value })}
                className="form-input"
              >
                <option value="">Select a server...</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.environment})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label">App Domain</label>
              <input
                value={form.app_domain}
                onChange={(e) => setForm({ ...form, app_domain: e.target.value })}
                placeholder="e.g. bills-test.mandirparikrama.com"
                className="form-input font-mono text-sm"
              />
            </div>

            <div>
              <label className="form-label">Supabase Domain</label>
              <input
                value={form.supabase_domain}
                onChange={(e) => setForm({ ...form, supabase_domain: e.target.value })}
                placeholder="e.g. supabase-bills-test.mandirparikrama.com"
                className="form-input font-mono text-sm"
              />
            </div>

            <div>
              <label className="form-label">Repository URL</label>
              <input
                value={form.repository_url}
                onChange={(e) => setForm({ ...form, repository_url: e.target.value })}
                placeholder="https://github.com/org/repo"
                className="form-input font-mono text-sm"
              />
            </div>

            <div>
              <label className="form-label">Git Branch</label>
              <input
                value={form.git_branch}
                onChange={(e) => setForm({ ...form, git_branch: e.target.value })}
                placeholder="main"
                className="form-input font-mono text-sm"
              />
            </div>

            <div>
              <label className="form-label">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="form-input"
              />
            </div>
          </div>

          <div className="flex justify-end mt-6">
            <button
              onClick={handleReview}
              disabled={!form.name || !form.server_id}
              className="btn-primary disabled:opacity-50"
            >
              Review
            </button>
          </div>
        </div>
      )}

      {step === 'review' && preview && (
        <div className="card p-6 max-w-2xl">
          <p className="text-text-muted text-sm mb-4">
            Review the automatically generated values. Infrastructure fields will be created atomically.
          </p>

          <div className="space-y-3">
            <ReviewRow label="Project Name" value={form.name} />
            <ReviewRow label="Project Slug" value={preview.slug} mono auto />
            <ReviewRow label="Server" value={selectedServer?.name ?? '-'} />
            <ReviewRow label="Environment" value={selectedServer?.environment ?? '-'} />
            <ReviewRow label="App Domain" value={form.app_domain || '-'} mono />
            <ReviewRow label="Supabase Domain" value={form.supabase_domain || '-'} mono />
            <ReviewRow label="App Directory" value={preview.app_directory} mono auto />
            <ReviewRow label="Supabase Directory" value={preview.supabase_directory} mono auto />
            <ReviewRow label="Compose Name" value={preview.compose_name} mono auto />
            <ReviewRow label="Project Slot" value={String(preview.project_slot)} mono auto />
            <ReviewRow label="API Port" value={String(preview.api_port)} mono auto />
            <ReviewRow label="DB Port" value={String(preview.db_port)} mono auto />
            <ReviewRow label="Pooler Port" value={String(preview.pooler_port)} mono auto />
            <ReviewRow label="Repository" value={form.repository_url || '-'} mono />
            <ReviewRow label="Git Branch" value={form.git_branch || '-'} mono />
          </div>

          <div className="flex justify-between mt-6">
            <button
              onClick={() => setStep('form')}
              className="btn-ghost"
            >
              Back to Edit
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-all duration-150 shadow-sm shadow-emerald-600/20"
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Create Project
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewRow({ label, value, mono, auto }: { label: string; value: string; mono?: boolean; auto?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-border">
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-muted">{label}</span>
        {auto && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30">
            auto
          </span>
        )}
      </div>
      <span className={`text-sm text-text-primary text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
