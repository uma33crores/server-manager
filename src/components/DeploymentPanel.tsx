import { useEffect, useState, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import { supabase } from '@/lib/supabase';
import type { Project, Server as ServerType, DeploymentSnapshot, DeploymentComparison, DeploymentComparisonChange, DeploymentCommandStep } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import PageLoader from '@/components/PageLoader';
import Pagination from '@/components/Pagination';
import CopyButton from '@/components/CopyButton';
import ServerConnectionSection from '@/components/ServerConnectionSection';
import {
  Upload,
  GitBranch,
  GitCommit,
  RefreshCw,
  FileCode,
  Database,
  Cloud,
  Package,
  Settings,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  Server,
  ShieldAlert,
  History,
  Search,
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
  Layers,
  Archive,
  Eye,
  ClipboardList,
  FileCheck,
  Lock,
  Download,
  KeyRound,
  Wifi,
  WifiOff,
  Loader2,
  ListChecks,
  Info,
} from 'lucide-react';

type SnapshotFile = {
  relative_path: string;
  file_hash: string;
  file_size: number;
  file_type: string;
  category: string;
  area: string;
};

type ComparisonResult = {
  comparisonId: string;
  totalChanged: number;
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
  summary: Record<string, number>;
  cached: boolean;
};

type PlanStep = {
  step: number;
  title: string;
  purpose: string;
  skip: boolean;
  risk_level: string;
  expected_result: string;
  rollback_note: string;
};

type CommandStep = {
  step_number: number;
  title: string;
  purpose: string | null;
  command: string;
  risk_level: string;
  expected_result: string | null;
  rollback_note: string | null;
  config_used: Record<string, unknown>;
};

type GitConnection = {
  id: string;
  project_id: string;
  repository_url: string;
  auth_method: 'ssh_deploy_key';
  connection_status: 'not_configured' | 'waiting_for_deploy_key' | 'connected' | 'auth_failed' | 'repo_unreachable' | 'config_error';
  public_key: string | null;
  key_fingerprint: string | null;
  key_created_at: string | null;
  last_connection_check: string | null;
  connection_error: string | null;
  selected_branch: string | null;
  created_at: string;
  updated_at: string;
};

type DeploymentState = {
  state: {
    current_baseline_snapshot_id: string | null;
    current_git_target_snapshot_id: string | null;
    current_comparison_id: string | null;
    baseline_initialized: boolean;
    git_status: string;
  } | null;
  baselineSnapshot: DeploymentSnapshot | null;
  gitTargetSnapshot: DeploymentSnapshot | null;
  currentComparison: DeploymentComparison | null;
  comparisonChanges: DeploymentComparisonChange[];
  snapshots: DeploymentSnapshot[];
  comparisons: DeploymentComparison[];
  deployments: Record<string, unknown>[];
  lastDeployment: Record<string, unknown> | null;
  unacknowledgedGitEvents: Record<string, unknown>[];
  gitConnection: GitConnection | null;
};

type ChangeFilter = 'All' | 'Added' | 'Modified' | 'Deleted' | 'Frontend' | 'Backend' | 'Database Migration' | 'Edge Function' | 'Dependencies' | 'Configuration';

const CHANGE_FILTERS: ChangeFilter[] = ['All', 'Added', 'Modified', 'Deleted', 'Frontend', 'Backend', 'Database Migration', 'Edge Function', 'Dependencies', 'Configuration'];

const RISK_COLORS: Record<string, string> = {
  read_only: 'text-text-muted',
  backup: 'text-sky-600 dark:text-sky-400',
  file_change: 'text-amber-600 dark:text-amber-400',
  build: 'text-amber-600 dark:text-amber-400',
  database_change: 'text-red-600 dark:text-red-400',
  service_restart: 'text-amber-600 dark:text-amber-400',
  verification: 'text-emerald-600 dark:text-emerald-400',
  high_risk: 'text-red-600 dark:text-red-400',
};

const VERIFICATION_LABELS: Record<string, string> = {
  unverified: 'Unverified',
  admin_confirmed: 'Admin Confirmed',
  snapshot_verified: 'Snapshot Verified',
  drift_detected: 'Drift Detected',
};

const VERIFICATION_COLORS: Record<string, string> = {
  unverified: 'text-text-muted',
  admin_confirmed: 'text-sky-600 dark:text-sky-400',
  snapshot_verified: 'text-emerald-600 dark:text-emerald-400',
  drift_detected: 'text-red-600 dark:text-red-400',
};

const SECRET_PATTERNS = [
  /\.env(\.|$)/i, /private_key/i, /\.pem$/i, /id_rsa/i, /id_ed25519/i,
  /\.key$/i, /credentials/i, /secret/i, /token/i, /password/i,
];

const EXCLUDE_PATTERNS = [
  /^\.git\//, /^node_modules\//, /^dist\//, /^\.next\//, /^__pycache__\//,
  /^\.cache\//, /^\.DS_Store$/, /^Thumbs\.db$/,
  /\.log$/, /\.tmp$/,
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILE_COUNT = 10000;
const MAX_TOTAL_SIZE = 500 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortenSha(sha: string | null): string {
  if (!sha) return '-';
  return sha.substring(0, 7);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function calculateSHA256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function shouldExclude(path: string): boolean {
  return EXCLUDE_PATTERNS.some(p => p.test(path));
}

function isSecretFile(path: string): boolean {
  return SECRET_PATTERNS.some(p => p.test(path));
}

function classifyFile(filePath: string): { category: string; area: string } {
  const lower = filePath.toLowerCase();
  const isSupabase = lower.startsWith('supabase/') || lower.includes('/supabase/');

  if (lower.includes('/migrations/') || lower.startsWith('supabase/migrations/')) return { category: 'Database Migration', area: isSupabase ? 'supabase' : 'application' };
  if (lower.startsWith('supabase/functions/') || lower.includes('/functions/')) return { category: 'Edge Function', area: 'supabase' };
  const depFiles = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'composer.json', 'composer.lock'];
  if (depFiles.some(f => lower === f || lower.endsWith('/' + f))) return { category: 'Dependencies', area: isSupabase ? 'supabase' : 'application' };
  if (lower.endsWith('.tsx') || lower.endsWith('.jsx') || lower.endsWith('.vue') || lower.endsWith('.svelte') || lower.endsWith('.css') || lower.endsWith('.html') || lower.startsWith('src/')) return { category: 'Frontend', area: 'application' };
  if (lower.includes('/api/') || lower.includes('/services/') || lower.includes('/lib/') || lower.endsWith('.ts') || lower.endsWith('.js')) return { category: 'Backend', area: 'application' };
  if (lower.endsWith('.toml') || lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.json') || lower.includes('docker-compose') || lower.includes('vite.config') || lower.includes('nginx')) return { category: 'Configuration', area: isSupabase ? 'supabase' : 'application' };
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return { category: 'Documentation', area: isSupabase ? 'supabase' : 'application' };
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.svg') || lower.endsWith('.webp') || lower.endsWith('.ico')) return { category: 'Asset', area: 'application' };
  return { category: 'Other', area: isSupabase ? 'supabase' : 'application' };
}

function isBinaryFile(filePath: string, fileSize: number): boolean {
  const lower = filePath.toLowerCase();
  const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip', '.tar', '.gz', '.mp4', '.mp3'];
  if (binaryExts.some(ext => lower.endsWith(ext))) return true;
  return fileSize > 512 * 1024;
}

export default function DeploymentPanel({ project, server }: { project: Project; server: ServerType | null }) {
  const { isAdmin, isReadOnly } = useAuth();
  const canManage = isAdmin && !isReadOnly;
  const isProduction = server?.environment === 'production';

  const [state, setState] = useState<DeploymentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [fetchingGit, setFetchingGit] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [generatingCommands, setGeneratingCommands] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showBaselineConfirm, setShowBaselineConfirm] = useState(false);
  const [showGitAccessModal, setShowGitAccessModal] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesAutoDiscovered, setBranchesAutoDiscovered] = useState(false);
  const [branchSearch, setBranchSearch] = useState('');
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [manualBranchInput, setManualBranchInput] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [gitActionError, setGitActionError] = useState<string | null>(null);
  const [connectionTestResult, setConnectionTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [baselineSnapshotId, setBaselineSnapshotId] = useState<string | null>(null);
  const [planSteps, setPlanSteps] = useState<PlanStep[] | null>(null);
  const [commandSteps, setCommandSteps] = useState<CommandStep[] | null>(null);
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>('All');
  const [activeTab, setActiveTab] = useState<'overview' | 'changes' | 'plan' | 'commands' | 'history' | 'snapshots'>('overview');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Upload form state
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadGitCommit, setUploadGitCommit] = useState('');
  const [uploadBranch, setUploadBranch] = useState(project.git_branch ?? '');
  const [uploadNotes, setUploadNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showGitTargetUpload, setShowGitTargetUpload] = useState(false);
  const [gitTargetUploading, setGitTargetUploading] = useState(false);
  const [gitTargetProgress, setGitTargetProgress] = useState('');
  const [gitTargetBranch, setGitTargetBranch] = useState(project.git_branch ?? 'main');
  const [gitTargetCommit, setGitTargetCommit] = useState('');
  const gitTargetFileRef = useRef<HTMLInputElement>(null);

  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/deploy-manager`;
  const gitWorkerUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/git-worker`;

  const callEdgeFunction = useCallback(async (action: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const params = new URLSearchParams({ action });
    if (action !== 'get-comparison-detail' && action !== 'acknowledge-git-event') {
      params.set('projectId', project.id);
    }
    const url = `${apiUrl}?${params}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(errorData.error || `Request failed (${response.status})`);
    }
    return response.json();
  }, [project.id, apiUrl]);

  const callGitWorker = useCallback(async (action: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const params = new URLSearchParams({ action, projectId: project.id });
    const url = `${gitWorkerUrl}?${params}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(errorData.error || `Git Worker request failed (${response.status})`);
    }
    return response.json();
  }, [project.id, gitWorkerUrl]);

  const loadState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callEdgeFunction('get-state');
      setState(data as DeploymentState);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deployment state');
    } finally {
      setLoading(false);
    }
  }, [callEdgeFunction]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // ============================================================
  // Snapshot upload
  // ============================================================
  async function handleUploadSnapshot(file: File) {
    setUploading(true);
    setError(null);
    setUploadProgress('Reading archive...');

    try {
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter(e => !e.dir);
      const files: SnapshotFile[] = [];
      let totalSize = 0;
      const secretFiles: string[] = [];

      if (entries.length > MAX_FILE_COUNT) {
        throw new Error(`Archive contains too many files (${entries.length}). Maximum is ${MAX_FILE_COUNT}.`);
      }

      for (const entry of entries) {
        const path = entry.name.replace(/^\.\//, '').replace(/^\//, '');

        // Path traversal protection
        if (path.includes('..') || path.startsWith('/')) continue;
        if (shouldExclude(path)) continue;

        if (isSecretFile(path)) {
          secretFiles.push(path);
          continue;
        }

        const data = await entry.async('arraybuffer');
        if (data.byteLength > MAX_FILE_SIZE) continue;
        totalSize += data.byteLength;
        if (totalSize > MAX_TOTAL_SIZE) {
          throw new Error('Archive exceeds maximum total size limit (500MB).');
        }

        const hash = await calculateSHA256(data);
        const { category, area } = classifyFile(path);
        const fileType = isBinaryFile(path, data.byteLength) ? 'binary' : 'text';

        files.push({ relative_path: path, file_hash: hash, file_size: data.byteLength, file_type: fileType, category, area });
      }

      setUploadProgress(`Processed ${files.length} files. Uploading...`);

      // Upload archive to storage
      const storagePath = `${project.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('deployment-snapshots')
        .upload(storagePath, file, { contentType: file.type || 'application/zip' });

      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      // Create snapshot record
      const { data: { session } } = await supabase.auth.getSession();
      const { data: snapshot, error: snapError } = await supabase
        .from('deployment_snapshots')
        .insert({
          project_id: project.id,
          environment: server?.environment ?? 'production',
          source_type: 'environment',
          label: uploadLabel || `${server?.environment ?? 'production'} baseline ${state?.snapshots.filter(s => s.source_type === 'environment').length ?? 0 + 1}`,
          description: uploadDescription || null,
          known_git_commit: uploadGitCommit || null,
          known_git_branch: uploadBranch || null,
          notes: uploadNotes || null,
          storage_path: storagePath,
          file_count: files.length,
          total_size: totalSize,
          created_by: session?.user?.id ?? null,
        })
        .select('id')
        .single();

      if (snapError) throw new Error(`Failed to create snapshot: ${snapError.message}`);
      const snapshotId = (snapshot as { id: string }).id;

      // Insert file manifest in batches
      const batchSize = 500;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize).map(f => ({ ...f, snapshot_id: snapshotId }));
        const { error: batchError } = await supabase
          .from('deployment_snapshot_files')
          .insert(batch);
        if (batchError) console.error('Batch insert error:', batchError);
      }

      setUploadProgress('Snapshot created successfully.');

      // If this is the first snapshot, set as baseline
      if (!state?.state?.baseline_initialized) {
        await callEdgeFunction('set-baseline', 'POST', {
          snapshotId,
          verificationType: 'admin_confirmed',
        });
      }

      await loadState();
      setShowUploadModal(false);
      setUploadLabel('');
      setUploadDescription('');
      setUploadGitCommit('');
      setUploadNotes('');

      if (secretFiles.length > 0) {
        setError(`Warning: ${secretFiles.length} secret files were detected and excluded from the snapshot: ${secretFiles.slice(0, 5).join(', ')}${secretFiles.length > 5 ? '...' : ''}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload snapshot');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }

  // ============================================================
  // Git Access: Generate Deploy Key
  // ============================================================
  async function handleGenerateKey() {
    setGeneratingKey(true);
    setGitActionError(null);
    try {
      const data = await callGitWorker('generate-key', 'POST');
      if (data.error) {
        setGitActionError(data.error);
      } else {
        await loadState();
      }
    } catch (err) {
      setGitActionError(err instanceof Error ? err.message : 'Failed to generate deploy key');
    } finally {
      setGeneratingKey(false);
    }
  }

  // ============================================================
  // Git Access: Test Connection
  // ============================================================
  async function handleTestConnection() {
    setTestingConnection(true);
    setGitActionError(null);
    setConnectionTestResult(null);
    try {
      const data = await callGitWorker('test-connection', 'POST');
      if (data.error) {
        setConnectionTestResult({ success: false, message: data.error });
        await loadState();
      } else {
        setConnectionTestResult({ success: true, message: 'Connection successful' });
        await loadState();
      }
    } catch (err) {
      setConnectionTestResult({ success: false, message: err instanceof Error ? err.message : 'Connection test failed' });
    } finally {
      setTestingConnection(false);
    }
  }

  // ============================================================
  // Git Access: Load Branches
  // ============================================================
  async function handleLoadBranches() {
    setLoadingBranches(true);
    setGitActionError(null);
    try {
      const data = await callGitWorker('list-branches', 'GET');
      if (data.error) {
        setGitActionError(data.error);
      } else {
        setBranches(data.branches ?? []);
        setBranchesAutoDiscovered(data.autoDiscovered === true);
      }
    } catch (err) {
      setGitActionError(err instanceof Error ? err.message : 'Failed to load branches');
    } finally {
      setLoadingBranches(false);
    }
  }

  // ============================================================
  // Git Access: Select Branch
  // ============================================================
  async function handleSelectBranch(branch: string) {
    setSelectedBranch(branch);
    setShowBranchDropdown(false);
    setGitActionError(null);
    try {
      await callGitWorker('select-branch', 'POST', { branch });
      await loadState();
    } catch (err) {
      setGitActionError(err instanceof Error ? err.message : 'Failed to select branch');
    }
  }

  // ============================================================
  // Git Target Upload (SSH-only workflow, no GITHUB_TOKEN needed)
  // Admin clones the repo locally using the SSH deploy key, zips the
  // branch working tree, and uploads it. Processed identically to the
  // environment snapshot but tagged as git_target source.
  // ============================================================
  async function handleUploadGitTarget(file: File) {
    setGitTargetUploading(true);
    setError(null);
    setGitTargetProgress('Reading archive...');

    try {
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter(e => !e.dir);
      const files: SnapshotFile[] = [];
      let totalSize = 0;
      const secretFiles: string[] = [];

      if (entries.length > MAX_FILE_COUNT) {
        throw new Error(`Archive contains too many files (${entries.length}). Maximum is ${MAX_FILE_COUNT}.`);
      }

      for (const entry of entries) {
        const path = entry.name.replace(/^\.\//, '').replace(/^\//, '');
        if (path.includes('..') || path.startsWith('/')) continue;
        if (shouldExclude(path)) continue;
        if (isSecretFile(path)) {
          secretFiles.push(path);
          continue;
        }

        const data = await entry.async('arraybuffer');
        if (data.byteLength > MAX_FILE_SIZE) continue;
        totalSize += data.byteLength;
        if (totalSize > MAX_TOTAL_SIZE) {
          throw new Error('Archive exceeds maximum total size limit (500MB).');
        }

        const hash = await calculateSHA256(data);
        const { category, area } = classifyFile(path);
        const fileType = isBinaryFile(path, data.byteLength) ? 'binary' : 'text';
        files.push({ relative_path: path, file_hash: hash, file_size: data.byteLength, file_type: fileType, category, area });
      }

      setGitTargetProgress(`Processed ${files.length} files. Uploading...`);

      const storagePath = `${project.id}/git-target-${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('deployment-snapshots')
        .upload(storagePath, file, { contentType: file.type || 'application/zip' });
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      const { data: { session } } = await supabase.auth.getSession();
      const branch = gitTargetBranch || project.git_branch || 'main';
      const commitSha = gitTargetCommit.trim() || null;

      const { data: snapshot, error: snapError } = await supabase
        .from('deployment_snapshots')
        .insert({
          project_id: project.id,
          environment: server?.environment ?? 'production',
          source_type: 'git_target',
          label: `Git Target ${branch}${commitSha ? ' ' + commitSha.substring(0, 7) : ''}`,
          git_commit_sha: commitSha,
          known_git_branch: branch,
          git_fetch_at: new Date().toISOString(),
          storage_path: storagePath,
          file_count: files.length,
          total_size: totalSize,
          created_by: session?.user?.id ?? null,
        })
        .select('id')
        .single();

      if (snapError) throw new Error(`Failed to create snapshot: ${snapError.message}`);
      const snapshotId = (snapshot as { id: string }).id;

      for (let i = 0; i < files.length; i += 500) {
        const batch = files.slice(i, i + 500).map(f => ({ ...f, snapshot_id: snapshotId }));
        await supabase.from('deployment_snapshot_files').insert(batch);
      }

      // Update deployment state
      const prevState = state?.state;
      const historyRewritten = prevState?.current_remote_commit_sha && commitSha && prevState.current_remote_commit_sha !== commitSha;
      await callEdgeFunction('set-git-target', 'POST', {
        snapshotId,
        commitSha: commitSha,
        branch,
        historyRewritten: !!historyRewritten,
      }).catch(() => {
        // If edge function doesn't support set-git-target, the snapshot still exists
      });

      setGitTargetProgress('Git target snapshot created successfully.');
      await loadState();
      setShowGitTargetUpload(false);
      setGitTargetCommit('');

      if (secretFiles.length > 0) {
        setError(`Warning: ${secretFiles.length} secret files were detected and excluded: ${secretFiles.slice(0, 5).join(', ')}${secretFiles.length > 5 ? '...' : ''}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload git target');
    } finally {
      setGitTargetUploading(false);
      setGitTargetProgress('');
    }
  }

  // ============================================================
  // Git fetch (via git-worker, no subprocesses)
  // ============================================================
  async function handleFetchGit() {
    setFetchingGit(true);
    setError(null);
    try {
      const branch = selectedBranch || state?.gitConnection?.selected_branch || project.git_branch || 'main';
      const data = await callGitWorker('fetch-snapshot', 'POST', { branch });
      if (data.error) {
        setError(data.error);
      } else {
        await loadState();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch Git. The Git Worker may be unavailable.');
    } finally {
      setFetchingGit(false);
    }
  }

  // ============================================================
  // Compare snapshots
  // ============================================================
  async function handleCompare() {
    if (!state?.baselineSnapshot || !state?.gitTargetSnapshot) return;
    setComparing(true);
    setError(null);
    try {
      const data = await callEdgeFunction('compare-snapshots', 'POST', {
        sourceSnapshotId: state.baselineSnapshot.id,
        targetSnapshotId: state.gitTargetSnapshot.id,
      }) as ComparisonResult;
      if (data.cached) {
        // Already exists, just reload
      }
      await loadState();
      setActiveTab('changes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compare snapshots');
    } finally {
      setComparing(false);
    }
  }

  // ============================================================
  // Generate plan
  // ============================================================
  async function handleGeneratePlan() {
    if (!state?.currentComparison) return;
    setGeneratingPlan(true);
    setError(null);
    try {
      const data = await callEdgeFunction('generate-plan', 'POST', {
        comparisonId: state.currentComparison.id,
      });
      if (data.error) {
        setError(data.error);
      } else {
        setPlanSteps(data.steps);
        setActiveTab('plan');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate plan');
    } finally {
      setGeneratingPlan(false);
    }
  }

  // ============================================================
  // Generate commands
  // ============================================================
  async function handleGenerateCommands() {
    if (!state?.currentComparison) return;
    setGeneratingCommands(true);
    setError(null);
    try {
      // First ensure we have a plan
      let planId = planSteps ? (state as unknown as { planId?: string }).planId : null;
      if (!planId) {
        const planData = await callEdgeFunction('generate-plan', 'POST', {
          comparisonId: state.currentComparison.id,
        });
        if (planData.error) {
          setError(planData.error);
          setGeneratingCommands(false);
          return;
        }
        setPlanSteps(planData.steps);
        planId = planData.planId;
      }

      const data = await callEdgeFunction('generate-commands', 'POST', { planId });
      if (data.error) {
        setError(data.error);
      } else {
        setCommandSteps(data.steps);
        setActiveTab('commands');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate commands');
    } finally {
      setGeneratingCommands(false);
    }
  }

  // ============================================================
  // Accept target as baseline
  // ============================================================
  async function handleAcceptTargetAsBaseline() {
    if (!state?.gitTargetSnapshot || !baselineSnapshotId) return;
    try {
      await callEdgeFunction('set-baseline', 'POST', {
        snapshotId: baselineSnapshotId,
        verificationType: 'admin_confirmed',
      });
      setShowBaselineConfirm(false);
      setBaselineSnapshotId(null);
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set baseline');
    }
  }

  // ============================================================
  // Acknowledge git event
  // ============================================================
  async function handleAcknowledgeGitEvent(eventId: string) {
    try {
      await callEdgeFunction('acknowledge-git-event', 'GET');
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to acknowledge');
    }
  }

  const filteredChanges = state?.comparisonChanges.filter(c => {
    if (changeFilter === 'All') return true;
    if (changeFilter === 'Added') return c.status === 'added';
    if (changeFilter === 'Modified') return c.status === 'modified';
    if (changeFilter === 'Deleted') return c.status === 'deleted';
    return c.category === changeFilter;
  }) ?? [];

  const totalPages = Math.max(1, Math.ceil((state?.deployments ?? []).length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const pagedDeployments = (state?.deployments ?? []).slice(startIdx, startIdx + pageSize);

  const needsBaseline = !state?.state?.baseline_initialized;
  const hasGitTarget = !!state?.gitTargetSnapshot;
  const hasComparison = !!state?.currentComparison;
  const hasChanges = (state?.currentComparison?.total_changed ?? 0) > 0;

  if (loading) return <PageLoader label="Loading deployments..." />;

  const envLabel = server?.environment ? server.environment.charAt(0).toUpperCase() + server.environment.slice(1) : 'Production';
  const envColor = server?.environment === 'production' ? 'text-red-600 dark:text-red-400' : server?.environment === 'staging' ? 'text-amber-600 dark:text-amber-400' : 'text-sky-600 dark:text-sky-400';

  return (
    <div className="space-y-6">
      {error && (
        <div className="alert-error">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">x</button>
        </div>
      )}

      {/* Server Connection & Project Validation */}
      <ServerConnectionSection project={project} server={server} />

      {/* Needs Baseline Banner */}
      {needsBaseline && (
        <div className="card p-5 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-text-primary mb-1">Deployment Tracking Not Initialized</h3>
              <p className="text-sm text-text-muted mb-3">
                Upload a snapshot of the files currently deployed in this environment to create the initial baseline.
                The snapshot is a ZIP archive of the project files from {envLabel}.
              </p>
              <button
                onClick={() => setShowUploadModal(true)}
                disabled={!canManage}
                className="btn-primary btn-sm"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload Current Environment Snapshot
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Current Environment */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Server className="w-4 h-4 text-text-muted" />
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Current Environment</span>
          </div>
          <div className="space-y-1.5">
            <div className={`text-sm font-medium ${envColor}`}>{envLabel}</div>
            {state?.baselineSnapshot ? (
              <>
                <div className="text-sm text-text-secondary">{state.baselineSnapshot.label}</div>
                <div className="text-xs text-text-muted">{formatDate(state.baselineSnapshot.created_at)}</div>
                <div className={`text-xs font-medium ${VERIFICATION_COLORS[state.baselineSnapshot.verification_state] ?? 'text-text-muted'}`}>
                  {VERIFICATION_LABELS[state.baselineSnapshot.verification_state] ?? 'Unverified'}
                </div>
              </>
            ) : (
              <div className="text-sm text-text-muted">No baseline snapshot</div>
            )}
          </div>
        </div>

        {/* Git Target */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <GitBranch className="w-4 h-4 text-text-muted" />
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Git Target</span>
          </div>
          <div className="space-y-1.5">
            {(() => {
              const conn = state?.gitConnection;
              const status = conn?.connection_status ?? 'not_configured';
              const statusLabel = status === 'not_configured' ? 'Not Configured'
                : status === 'waiting_for_deploy_key' ? 'Waiting for Deploy Key'
                : status === 'connected' ? 'Connected'
                : status === 'auth_failed' ? 'Authentication Failed'
                : status === 'repo_unreachable' ? 'Repository Unreachable'
                : 'Configuration Error';
              const statusColor = status === 'connected' ? 'text-emerald-600 dark:text-emerald-400'
                : status === 'waiting_for_deploy_key' ? 'text-amber-600 dark:text-amber-400'
                : status === 'not_configured' ? 'text-text-muted'
                : 'text-red-600 dark:text-red-400';
              const StatusIcon = status === 'connected' ? Wifi : status === 'waiting_for_deploy_key' ? KeyRound : status === 'not_configured' ? Lock : WifiOff;

              if (state?.gitTargetSnapshot) {
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <GitCommit className="w-3.5 h-3.5 text-text-muted" />
                      <span className="font-mono text-sm text-text-secondary">{shortenSha(state.gitTargetSnapshot.git_commit_sha)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-3.5 h-3.5 text-text-muted" />
                      <span className="text-sm text-text-secondary">{state.gitTargetSnapshot.known_git_branch ?? project.git_branch ?? '-'}</span>
                    </div>
                    {state.gitTargetSnapshot.git_commit_message && (
                      <div className="text-xs text-text-secondary truncate" title={state.gitTargetSnapshot.git_commit_message}>
                        {state.gitTargetSnapshot.git_commit_message.split('\n')[0]}
                      </div>
                    )}
                    {state.gitTargetSnapshot.git_commit_author && (
                      <div className="text-xs text-text-muted">{state.gitTargetSnapshot.git_commit_author}</div>
                    )}
                    {state.gitTargetSnapshot.git_commit_date && (
                      <div className="text-xs text-text-muted">{formatDateTime(state.gitTargetSnapshot.git_commit_date)}</div>
                    )}
                    <div className="text-xs text-text-muted">Fetched: {formatDateTime(state.gitTargetSnapshot.git_fetch_at)}</div>
                    {state.gitTargetSnapshot.file_count != null && (
                      <div className="text-xs text-text-muted">{state.gitTargetSnapshot.file_count} files</div>
                    )}
                    <div className="flex items-center gap-1.5 pt-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Ready to Compare</span>
                    </div>
                  </>
                );
              }

              return (
                <>
                  <div className="flex items-center gap-1.5">
                    <StatusIcon className="w-3.5 h-3.5 text-text-muted" />
                    <span className={`text-sm font-medium ${statusColor}`}>{statusLabel}</span>
                  </div>
                  {status === 'connected' && conn?.selected_branch && (
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-3.5 h-3.5 text-text-muted" />
                      <span className="text-sm text-text-secondary">{conn.selected_branch}</span>
                    </div>
                  )}
                  {status === 'connected' && !conn?.selected_branch && (
                    <div className="text-xs text-text-muted">Select a deployment branch</div>
                  )}
                  {status !== 'connected' && status !== 'not_configured' && status !== 'waiting_for_deploy_key' && (
                    <div className="text-xs text-red-600 dark:text-red-400">{conn?.connection_error ?? 'Connection issue detected'}</div>
                  )}
                  {status === 'not_configured' && (
                    <div className="text-xs text-text-muted">Private Repository</div>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {/* Pending Changes */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileCode className="w-4 h-4 text-text-muted" />
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Pending Changes</span>
          </div>
          {hasComparison ? (
            <div className="space-y-1">
              <div className="text-lg font-bold text-text-primary">
                {state?.currentComparison?.total_changed ?? 0} Files Changed
              </div>
              <div className="text-xs text-text-muted">
                {state?.currentComparison?.added_count ?? 0} added, {state?.currentComparison?.modified_count ?? 0} modified, {state?.currentComparison?.deleted_count ?? 0} deleted
              </div>
              {state?.currentComparison?.summary && (
                <div className="text-xs text-text-muted">
                  {state.currentComparison.summary['Database Migration'] > 0 && `${state.currentComparison.summary['Database Migration']} migrations, `}
                  {state.currentComparison.summary['Edge Function'] > 0 && `${state.currentComparison.summary['Edge Function']} functions, `}
                  {state.currentComparison.summary['Dependencies'] > 0 && `${state.currentComparison.summary['Dependencies']} deps`}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-text-muted">Run comparison to detect</div>
          )}
        </div>

        {/* Last Deployment */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-text-muted" />
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Last Deployment</span>
          </div>
          {state?.lastDeployment ? (
            <div className="space-y-1.5">
              <div className="font-mono text-sm text-text-secondary">
                {String(state.lastDeployment.deployment_id ?? String(state.lastDeployment.id).substring(0, 8)).toUpperCase()}
              </div>
              <div className="text-sm text-text-muted">{formatDate(String(state.lastDeployment.created_at))}</div>
              <div className="text-sm font-medium text-text-secondary">{String(state.lastDeployment.status)}</div>
            </div>
          ) : (
            <div className="text-sm text-text-muted">No deployments recorded</div>
          )}
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setShowUploadModal(true)}
          disabled={!canManage || uploading}
          className="btn-primary btn-sm"
        >
          {uploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Upload Snapshot
        </button>
        {state?.gitConnection?.connection_status !== 'connected' || !(state?.gitConnection?.selected_branch) ? (
          <button
            onClick={() => {
              setGitActionError(null);
              setConnectionTestResult(null);
              setShowGitAccessModal(true);
            }}
            disabled={!canManage || !project.repository_url}
            className="btn-secondary btn-sm"
            title={!project.repository_url ? 'Configure repository URL in project settings' : ''}
          >
            <KeyRound className="w-3.5 h-3.5" />
            Configure Git Access
          </button>
        ) : (
          <button
            onClick={handleFetchGit}
            disabled={!canManage || fetchingGit}
            className="btn-secondary btn-sm"
          >
            {fetchingGit ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
            Fetch Latest Git
          </button>
        )}
        <button
          onClick={() => setShowGitTargetUpload(true)}
          disabled={!canManage || gitTargetUploading}
          className="btn-secondary btn-sm"
          title="Upload a ZIP of your Git branch working tree (SSH-only, no GitHub API token needed)"
        >
          {gitTargetUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Upload Git Target
        </button>
        <button
          onClick={handleCompare}
          disabled={!canManage || comparing || !state?.baselineSnapshot || !state?.gitTargetSnapshot}
          className="btn-secondary btn-sm"
          title={!state?.baselineSnapshot ? 'Upload a baseline snapshot first' : !state?.gitTargetSnapshot ? 'Fetch Git target first' : ''}
        >
          {comparing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Compare Changes
        </button>
        <button
          onClick={handleGeneratePlan}
          disabled={!canManage || generatingPlan || !hasComparison}
          className="btn-secondary btn-sm"
        >
          {generatingPlan ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />}
          Generate Plan
        </button>
        <button
          onClick={handleGenerateCommands}
          disabled={!canManage || generatingCommands || !hasComparison}
          className="btn-secondary btn-sm"
        >
          {generatingCommands ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Terminal className="w-3.5 h-3.5" />}
          Generate Commands
        </button>
        {state?.gitTargetSnapshot && (
          <button
            onClick={() => {
              const snap = state.gitTargetSnapshot;
              if (!snap) return;
              setBaselineSnapshotId(snap.id);
              setShowBaselineConfirm(true);
            }}
            disabled={!canManage}
            className="btn-secondary btn-sm"
          >
            <FileCheck className="w-3.5 h-3.5" />
            Accept Target as Baseline
          </button>
        )}
        <button onClick={loadState} className="btn-ghost btn-sm">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Git History Warning */}
      {state?.state?.git_status === 'HISTORY_REWRITE' && state.unacknowledgedGitEvents.length > 0 && (
        <div className="card p-5 border-red-500/40 bg-red-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">
                GIT HISTORY REWRITE DETECTED
              </h3>
              <p className="text-sm text-text-secondary mb-2">
                Git history changed since the previous fetch. File-level comparison is being used as the authoritative deployment comparison.
              </p>
              <button
                onClick={() => handleAcknowledgeGitEvent(String(state.unacknowledgedGitEvents[0].id))}
                className="btn-secondary btn-sm"
              >
                Acknowledge History Change
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Current Baseline vs Git Target Comparison */}
      {state?.baselineSnapshot && state?.gitTargetSnapshot && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-4">Current Baseline vs Git Target</h2>
          <div className="flex items-center justify-center gap-6 mb-6">
            <div className="text-center">
              <div className="text-xs text-text-muted uppercase mb-1">Current Environment</div>
              <div className="text-sm font-medium text-text-secondary">{state.baselineSnapshot.label}</div>
              <div className="text-xs text-text-muted">{formatDateTime(state.baselineSnapshot.created_at)}</div>
              <div className={`text-xs font-medium mt-1 ${VERIFICATION_COLORS[state.baselineSnapshot.verification_state] ?? 'text-text-muted'}`}>
                {VERIFICATION_LABELS[state.baselineSnapshot.verification_state] ?? 'Unverified'}
              </div>
            </div>
            <ArrowRight className="w-6 h-6 text-text-muted" />
            <div className="text-center">
              <div className="text-xs text-text-muted uppercase mb-1">Target Git</div>
              <div className="font-mono text-sm text-text-secondary">{shortenSha(state.gitTargetSnapshot.git_commit_sha)}</div>
              <div className="text-xs text-text-muted">{state.gitTargetSnapshot.known_git_branch ?? project.git_branch}</div>
              <div className="text-xs text-text-muted mt-1">{formatDateTime(state.gitTargetSnapshot.git_fetch_at)}</div>
            </div>
          </div>

          {hasComparison && state.currentComparison && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {[
                { label: 'Frontend', count: state.currentComparison.summary['Frontend'] ?? 0, icon: FileCode },
                { label: 'Backend', count: state.currentComparison.summary['Backend'] ?? 0, icon: Terminal },
                { label: 'Database', count: state.currentComparison.summary['Database Migration'] ?? 0, icon: Database },
                { label: 'Edge Functions', count: state.currentComparison.summary['Edge Function'] ?? 0, icon: Cloud },
                { label: 'Dependencies', count: state.currentComparison.summary['Dependencies'] ?? 0, icon: Package },
                { label: 'Configuration', count: state.currentComparison.summary['Configuration'] ?? 0, icon: Settings },
                { label: 'Other', count: state.currentComparison.summary['Other'] ?? 0, icon: FileText },
              ].map((s) => (
                <div key={s.label} className="text-center p-3 bg-surface-hover rounded-lg">
                  <s.icon className="w-4 h-4 text-text-muted mx-auto mb-1.5" />
                  <div className="text-lg font-bold text-text-primary">{s.count}</div>
                  <div className="text-xs text-text-muted">{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {[
          { id: 'overview' as const, label: 'Overview', icon: Layers },
          { id: 'changes' as const, label: 'Changed Files', icon: FileCode },
          { id: 'plan' as const, label: 'Deployment Plan', icon: ClipboardList },
          { id: 'commands' as const, label: 'Manual Commands', icon: Terminal },
          { id: 'history' as const, label: 'Deployment History', icon: History },
          { id: 'snapshots' as const, label: 'Snapshot History', icon: Archive },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {state?.currentComparison && state.comparisonChanges.length > 0 && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-text-primary mb-3">Change Summary</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="text-center p-3 bg-surface-hover rounded-lg">
                  <div className="text-2xl font-bold text-text-primary">{state.currentComparison.total_changed}</div>
                  <div className="text-xs text-text-muted">Total Changed</div>
                </div>
                <div className="text-center p-3 bg-emerald-500/5 rounded-lg">
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{state.currentComparison.added_count}</div>
                  <div className="text-xs text-text-muted">Added</div>
                </div>
                <div className="text-center p-3 bg-amber-500/5 rounded-lg">
                  <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{state.currentComparison.modified_count}</div>
                  <div className="text-xs text-text-muted">Modified</div>
                </div>
                <div className="text-center p-3 bg-red-500/5 rounded-lg">
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">{state.currentComparison.deleted_count}</div>
                  <div className="text-xs text-text-muted">Deleted</div>
                </div>
              </div>
            </div>
          )}

          {/* Database Migration Analysis */}
          {state?.currentComparison && state.comparisonChanges.some(c => c.category === 'Database Migration') && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                <Database className="w-4 h-4 text-text-muted" />
                Database Migration Analysis
              </h3>
              <div className="space-y-2">
                {state.comparisonChanges.filter(c => c.category === 'Database Migration').map((c, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-surface-hover rounded-lg">
                    <span className="font-mono text-xs text-text-secondary">{c.relative_path}</span>
                    <span className={`text-xs font-medium ${
                      c.status === 'added' ? 'text-emerald-600 dark:text-emerald-400' :
                      c.status === 'modified' ? 'text-red-600 dark:text-red-400' :
                      c.status === 'deleted' ? 'text-amber-600 dark:text-amber-400' :
                      'text-text-muted'
                    }`}>
                      {c.status === 'added' ? 'NEW' :
                       c.status === 'modified' ? 'EXISTING MIGRATION MODIFIED' :
                       c.status === 'deleted' ? 'MIGRATION HISTORY WARNING' :
                       c.status}
                    </span>
                  </div>
                ))}
              </div>
              {state.comparisonChanges.some(c => c.category === 'Database Migration' && c.status === 'modified') && (
                <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
                    <span className="text-sm font-medium text-red-600 dark:text-red-400">EXISTING MIGRATION MODIFIED</span>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Existing migrations should normally be immutable. Do not blindly rerun modified migrations. Seek expert review.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Edge Function Analysis */}
          {state?.currentComparison && state.comparisonChanges.some(c => c.category === 'Edge Function') && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                <Cloud className="w-4 h-4 text-text-muted" />
                Edge Function Analysis
              </h3>
              <div className="space-y-2">
                {state.comparisonChanges.filter(c => c.category === 'Edge Function').map((c, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-surface-hover rounded-lg">
                    <span className="font-mono text-xs text-text-secondary">{c.relative_path}</span>
                    <span className={`text-xs font-medium ${
                      c.status === 'added' ? 'text-emerald-600 dark:text-emerald-400' :
                      c.status === 'modified' ? 'text-amber-600 dark:text-amber-400' :
                      c.status === 'deleted' ? 'text-red-600 dark:text-red-400' :
                      'text-text-muted'
                    }`}>
                      {c.status === 'added' ? 'NEW' :
                       c.status === 'modified' ? 'CHANGED' :
                       c.status === 'deleted' ? 'REMOVED FROM TARGET' :
                       c.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dependency & Configuration Analysis */}
          {state?.currentComparison && state.comparisonChanges.some(c => c.category === 'Dependencies' || c.category === 'Configuration') && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                <Package className="w-4 h-4 text-text-muted" />
                Dependencies & Configuration
              </h3>
              <div className="space-y-2">
                {state.comparisonChanges.filter(c => c.category === 'Dependencies' || c.category === 'Configuration').map((c, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-surface-hover rounded-lg">
                    <span className="font-mono text-xs text-text-secondary">{c.relative_path}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-muted">{c.category}</span>
                      <span className={`text-xs font-medium ${
                        c.status === 'added' ? 'text-emerald-600 dark:text-emerald-400' :
                        c.status === 'modified' ? 'text-amber-600 dark:text-amber-400' :
                        c.status === 'deleted' ? 'text-red-600 dark:text-red-400' :
                        'text-text-muted'
                      }`}>{c.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Changed Files Tab */}
      {activeTab === 'changes' && (
        <div className="card overflow-hidden">
          {state?.comparisonChanges && state.comparisonChanges.length > 0 ? (
            <>
              <div className="p-4 border-b border-border">
                <div className="flex flex-wrap gap-1.5">
                  {CHANGE_FILTERS.map((f) => {
                    const count = f === 'All'
                      ? state.comparisonChanges.length
                      : f === 'Added' ? state.comparisonChanges.filter(c => c.status === 'added').length
                      : f === 'Modified' ? state.comparisonChanges.filter(c => c.status === 'modified').length
                      : f === 'Deleted' ? state.comparisonChanges.filter(c => c.status === 'deleted').length
                      : state.comparisonChanges.filter(c => c.category === f).length;
                    return (
                      <button
                        key={f}
                        onClick={() => setChangeFilter(f)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          changeFilter === f
                            ? 'bg-sky-500 text-white'
                            : 'bg-surface-hover text-text-muted hover:text-text-primary'
                        }`}
                      >
                        {f} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Path</th>
                      <th>Category</th>
                      <th>Area</th>
                      <th>Source Hash</th>
                      <th>Target Hash</th>
                      <th>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredChanges.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <span className={`text-sm font-medium ${
                            c.status === 'added' ? 'text-emerald-600 dark:text-emerald-400' :
                            c.status === 'modified' ? 'text-amber-600 dark:text-amber-400' :
                            c.status === 'deleted' ? 'text-red-600 dark:text-red-400' :
                            'text-text-muted'
                          }`}>
                            {c.status}
                          </span>
                        </td>
                        <td><span className="font-mono text-xs text-text-secondary">{c.relative_path}</span></td>
                        <td><span className="text-sm text-text-muted">{c.category}</span></td>
                        <td><span className="text-sm text-text-muted">{c.area}</span></td>
                        <td><span className="font-mono text-xs text-text-muted">{c.source_hash ? c.source_hash.substring(0, 12) : '-'}</span></td>
                        <td><span className="font-mono text-xs text-text-muted">{c.target_hash ? c.target_hash.substring(0, 12) : '-'}</span></td>
                        <td>
                          <span className="text-xs text-text-muted">
                            {c.source_size != null ? formatBytes(c.source_size) : '-'}
                            {c.target_size != null ? ` → ${formatBytes(c.target_size)}` : ''}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="p-6 text-center text-sm text-text-muted">
              {hasComparison ? 'No changes detected — all files match.' : 'Run a comparison to see changed files.'}
            </div>
          )}
        </div>
      )}

      {/* Deployment Plan Tab */}
      {activeTab === 'plan' && (
        <div className="card p-5">
          {planSteps ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-text-primary mb-2">Deployment Plan</h2>
              {planSteps.map((step) => (
                <div key={step.step} className={`p-4 rounded-lg border ${step.skip ? 'border-border bg-surface-hover opacity-60' : 'border-border'}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-hover flex-shrink-0">
                      <span className="text-sm font-bold text-text-secondary">{step.step}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-text-primary">{step.title}</h3>
                        {step.skip && <span className="text-xs font-medium text-text-muted">SKIP</span>}
                        <span className={`text-xs font-medium ${RISK_COLORS[step.risk_level] ?? 'text-text-muted'}`}>
                          {step.risk_level.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm text-text-muted mb-2">{step.purpose}</p>
                      <div className="text-xs text-text-muted">
                        <span className="font-medium">Expected:</span> {step.expected_result}
                      </div>
                      {!step.skip && (
                        <div className="text-xs text-text-muted mt-1">
                          <span className="font-medium">Rollback:</span> {step.rollback_note}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-sm text-text-muted py-6">
              {hasComparison ? 'Click "Generate Plan" to create a deployment plan.' : 'Run a comparison first to generate a plan.'}
            </div>
          )}
        </div>
      )}

      {/* Manual Commands Tab */}
      {activeTab === 'commands' && (
        <div className="card p-5">
          {commandSteps ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                  Commands are displayed only. Do NOT execute them automatically. Copy and run manually on the target server.
                </span>
              </div>
              {commandSteps.map((step) => (
                <div key={step.step_number} className="p-4 rounded-lg border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-surface-hover text-xs font-bold text-text-secondary">
                      {step.step_number}
                    </span>
                    <h3 className="text-sm font-semibold text-text-primary">{step.title}</h3>
                    <span className={`text-xs font-medium ${RISK_COLORS[step.risk_level] ?? 'text-text-muted'}`}>
                      {step.risk_level.replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>
                  {step.purpose && <p className="text-sm text-text-muted mb-2">{step.purpose}</p>}
                  <div className="bg-surface rounded-lg p-3 mb-2">
                    <div className="flex items-start justify-between gap-2">
                      <pre className="font-mono text-xs text-text-secondary whitespace-pre-wrap break-all flex-1">{step.command}</pre>
                      <CopyButton value={step.command} label="Copy" />
                    </div>
                  </div>
                  {step.expected_result && (
                    <div className="text-xs text-text-muted mb-1">
                      <span className="font-medium">Expected:</span> {step.expected_result}
                    </div>
                  )}
                  {step.rollback_note && (
                    <div className="text-xs text-text-muted">
                      <span className="font-medium">Rollback:</span> {step.rollback_note}
                    </div>
                  )}
                  {Object.keys(step.config_used).length > 0 && (
                    <div className="mt-2 p-2 bg-surface-hover rounded text-xs text-text-muted">
                      <span className="font-medium">Config used:</span>{' '}
                      {Object.entries(step.config_used).map(([k, v]) => `${k}=${String(v)}`).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-sm text-text-muted py-6">
              {hasComparison ? 'Click "Generate Commands" to create manual deployment commands.' : 'Run a comparison first to generate commands.'}
            </div>
          )}
        </div>
      )}

      {/* Deployment History Tab */}
      {activeTab === 'history' && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Deployment History</h2>
          </div>
          {pagedDeployments.length === 0 ? (
            <div className="p-6 text-center text-sm text-text-muted">No deployments recorded yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Deployment ID</th>
                    <th>Environment</th>
                    <th>Method</th>
                    <th>Result</th>
                    <th>Verification</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDeployments.map((d) => (
                    <tr key={String(d.id)}>
                      <td><span className="font-mono text-xs text-text-secondary">{String(d.deployment_id ?? String(d.id).substring(0, 8)).toUpperCase()}</span></td>
                      <td><span className="text-sm text-text-muted">{String(d.environment ?? server?.environment ?? '-')}</span></td>
                      <td><span className="text-sm text-text-muted">{String(d.method ?? 'manual_commands')}</span></td>
                      <td><span className="text-sm font-medium text-text-secondary">{String(d.result ?? d.status ?? '-')}</span></td>
                      <td><span className="text-sm text-text-muted">{String(d.verification_state ?? 'unverified')}</span></td>
                      <td><span className="text-sm text-text-muted">{formatDateTime(String(d.created_at))}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {state && state.deployments.length > 0 && (
            <Pagination
              page={currentPage}
              pageSize={pageSize}
              total={state.deployments.length}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            />
          )}
        </div>
      )}

      {/* Snapshot History Tab */}
      {activeTab === 'snapshots' && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Snapshot History</h2>
          </div>
          {state?.snapshots && state.snapshots.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Source</th>
                    <th>Git SHA</th>
                    <th>Files</th>
                    <th>Size</th>
                    <th>Verification</th>
                    <th>Baseline</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {state.snapshots.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-text-secondary">{s.label}</span>
                          {s.is_archived && <span className="text-xs text-text-muted">(archived)</span>}
                        </div>
                      </td>
                      <td>
                        <span className={`text-xs font-medium ${s.source_type === 'git_target' ? 'text-sky-600 dark:text-sky-400' : 'text-text-muted'}`}>
                          {s.source_type === 'git_target' ? 'Git Target' : 'Environment'}
                        </span>
                      </td>
                      <td><span className="font-mono text-xs text-text-muted">{shortenSha(s.git_commit_sha ?? s.known_git_commit)}</span></td>
                      <td><span className="text-sm text-text-muted">{s.file_count}</span></td>
                      <td><span className="text-sm text-text-muted">{formatBytes(s.total_size)}</span></td>
                      <td><span className={`text-xs font-medium ${VERIFICATION_COLORS[s.verification_state] ?? 'text-text-muted'}`}>{VERIFICATION_LABELS[s.verification_state] ?? 'Unverified'}</span></td>
                      <td>{s.is_current_baseline && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}</td>
                      <td><span className="text-sm text-text-muted">{formatDateTime(s.created_at)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-text-muted">No snapshots uploaded yet</div>
          )}
        </div>
      )}

      {/* Upload Modal */}
      <Modal
        open={showUploadModal}
        onClose={() => !uploading && setShowUploadModal(false)}
        title={`Upload ${envLabel} Environment Snapshot`}
        size="md"
      >
        <div className="space-y-4">
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span className="text-sm font-medium text-amber-600 dark:text-amber-400">Secret Protection</span>
            </div>
            <p className="text-xs text-text-muted">
              Do not include .env files, private keys, tokens, or credentials. Secret files are automatically detected and excluded.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Snapshot Label</label>
            <input
              type="text"
              value={uploadLabel}
              onChange={(e) => setUploadLabel(e.target.value)}
              placeholder={`${envLabel} baseline ${state?.snapshots.filter(s => s.source_type === 'environment').length ?? 0 + 1}`}
              className="input w-full"
              disabled={uploading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Description (optional)</label>
            <input
              type="text"
              value={uploadDescription}
              onChange={(e) => setUploadDescription(e.target.value)}
              placeholder="Brief description of this snapshot"
              className="input w-full"
              disabled={uploading}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Known Git Commit (optional)</label>
              <input
                type="text"
                value={uploadGitCommit}
                onChange={(e) => setUploadGitCommit(e.target.value)}
                placeholder="abc1234"
                className="input w-full"
                disabled={uploading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Branch (optional)</label>
              <input
                type="text"
                value={uploadBranch}
                onChange={(e) => setUploadBranch(e.target.value)}
                placeholder="main"
                className="input w-full"
                disabled={uploading}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Notes (optional)</label>
            <textarea
              value={uploadNotes}
              onChange={(e) => setUploadNotes(e.target.value)}
              placeholder="Additional notes about this snapshot"
              className="input w-full min-h-[60px]"
              disabled={uploading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">ZIP Archive</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.tar,.tar.gz,.tgz"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUploadSnapshot(file);
              }}
              className="input w-full"
              disabled={uploading}
            />
          </div>

          {uploadProgress && (
            <div className="flex items-center gap-2 text-sm text-sky-600 dark:text-sky-400">
              <RefreshCw className="w-4 h-4 animate-spin" />
              {uploadProgress}
            </div>
          )}

          <div className="text-xs text-text-muted">
            Max {MAX_FILE_COUNT} files, {formatBytes(MAX_TOTAL_SIZE)} total. Files over {formatBytes(MAX_FILE_SIZE)} are skipped.
            Excluded: .git, node_modules, dist, logs, caches, .env files.
          </div>
        </div>
      </Modal>

      {/* Accept Target as Baseline Confirmation */}
      <ConfirmDialog
        open={showBaselineConfirm}
        title="Accept Target as Current Baseline?"
        message={
          isProduction
            ? 'PRODUCTION SAFETY: Server Manager does not have direct evidence that the server matches this target. This records the Git target as the current baseline based only on administrator confirmation. Are you sure?'
            : 'Server Manager does not have direct evidence that the server matches this target. This records the Git target as the current baseline based only on administrator confirmation. Continue?'
        }
        confirmLabel="Accept as Baseline"
        onConfirm={handleAcceptTargetAsBaseline}
        onCancel={() => { setShowBaselineConfirm(false); setBaselineSnapshotId(null); }}
      />

      {/* Git Access Setup Modal */}
      <Modal
        open={showGitAccessModal}
        onClose={() => setShowGitAccessModal(false)}
        title="Configure Git Access"
        size="lg"
      >
        <div className="space-y-5">
          {gitActionError && (
            <div className="alert-error">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {gitActionError}
            </div>
          )}

          {/* Repository info */}
          <div>
            <label className="text-xs font-medium text-text-muted uppercase tracking-wide">Repository</label>
            <div className="mt-1 flex items-center gap-2 p-3 bg-surface-hover rounded-lg">
              <GitBranch className="w-4 h-4 text-text-muted flex-shrink-0" />
              <span className="text-sm text-text-secondary font-mono break-all">{project.repository_url ?? 'Not configured'}</span>
            </div>
            {!project.repository_url && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                Configure the repository URL in project settings first.
              </p>
            )}
          </div>

          {/* Authentication method */}
          <div>
            <label className="text-xs font-medium text-text-muted uppercase tracking-wide">Authentication</label>
            <div className="mt-1 flex items-center gap-2 p-3 bg-surface-hover rounded-lg">
              <KeyRound className="w-4 h-4 text-text-muted flex-shrink-0" />
              <span className="text-sm text-text-secondary">SSH Deploy Key</span>
            </div>
          </div>

          {(() => {
            const conn = state?.gitConnection;
            const status = conn?.connection_status ?? 'not_configured';

            // Not configured - show generate button
            if (status === 'not_configured' || !conn) {
              return (
                <div className="space-y-3">
                  <p className="text-sm text-text-secondary">
                    Generate a deploy key to enable read-only access to your private repository.
                    The key pair is generated server-side. You will add the public key to your GitHub repository settings.
                  </p>
                  <button
                    onClick={handleGenerateKey}
                    disabled={!canManage || generatingKey || !project.repository_url}
                    className="btn-primary btn-sm"
                  >
                    {generatingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                    Generate Deploy Key
                  </button>
                </div>
              );
            }

            // Waiting for deploy key - show public key + instructions
            if (status === 'waiting_for_deploy_key') {
              return (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <KeyRound className="w-4 h-4" />
                    <span className="text-sm font-medium">GitHub Deploy Key Required</span>
                  </div>

                  {conn.public_key && (
                    <div>
                      <label className="text-xs font-medium text-text-muted uppercase tracking-wide">Public Key</label>
                      <div className="mt-1 p-3 bg-surface-hover rounded-lg border border-border">
                        <div className="flex items-start gap-2">
                          <pre className="text-xs font-mono text-text-secondary break-all whitespace-pre-wrap flex-1">{conn.public_key}</pre>
                          <CopyButton value={conn.public_key} />
                        </div>
                      </div>
                      {conn.key_fingerprint && (
                        <div className="text-xs text-text-muted mt-1.5">Fingerprint: {conn.key_fingerprint}</div>
                      )}
                      {conn.key_created_at && (
                        <div className="text-xs text-text-muted">Created: {formatDateTime(conn.key_created_at)}</div>
                      )}
                    </div>
                  )}

                  <div className="p-4 bg-surface-hover rounded-lg space-y-2">
                    <p className="text-sm font-medium text-text-primary">Instructions:</p>
                    <ol className="text-xs text-text-secondary space-y-1.5 list-decimal list-inside">
                      <li>Open the configured GitHub repository.</li>
                      <li>Go to Settings.</li>
                      <li>Open Deploy keys.</li>
                      <li>Select Add deploy key.</li>
                      <li>Give it a recognizable title, for example: Server Manager - {project.name}</li>
                      <li>Paste the displayed public key.</li>
                      <li>Leave "Allow write access" OFF.</li>
                      <li>Save the deploy key.</li>
                      <li>Return to Server Manager.</li>
                      <li>Click Test Connection.</li>
                    </ol>
                    <p className="text-xs text-text-muted pt-1">The deployment tracker requires read-only repository access.</p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        setConnectionTestResult(null);
                        handleTestConnection();
                      }}
                      disabled={!canManage || testingConnection}
                      className="btn-primary btn-sm"
                    >
                      {testingConnection ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      I've Added This Key
                    </button>
                    <button
                      onClick={handleGenerateKey}
                      disabled={!canManage || generatingKey}
                      className="btn-secondary btn-sm"
                    >
                      {generatingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      Regenerate Key
                    </button>
                  </div>

                  {connectionTestResult && (
                    <div className={`p-3 rounded-lg ${connectionTestResult.success ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                      <div className="flex items-start gap-2">
                        {connectionTestResult.success ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className={`text-sm font-medium ${connectionTestResult.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                            {connectionTestResult.success ? 'Git Connection' : 'Git Authentication Failed'}
                          </p>
                          <p className="text-xs text-text-secondary mt-0.5">{connectionTestResult.message}</p>
                          {connectionTestResult.success && (
                            <div className="text-xs text-text-muted mt-1.5 space-y-0.5">
                              <div>Authentication: SSH Deploy Key</div>
                              <div>Access: Read Only</div>
                            </div>
                          )}
                          {!connectionTestResult.success && (
                            <p className="text-xs text-text-muted mt-1.5">
                              Verify that the public deploy key has been added to: Repository &rarr; Settings &rarr; Deploy keys
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // Connected - show branch selection
            if (status === 'connected') {
              const currentBranch = selectedBranch || conn.selected_branch || project.git_branch || '';
              const filteredBranches = branches.filter(b =>
                b.toLowerCase().includes(branchSearch.toLowerCase())
              );

              return (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <Wifi className="w-4 h-4" />
                    <span className="text-sm font-medium">Connected</span>
                    <span className="text-xs text-text-muted ml-2">SSH Deploy Key &middot; Read Only</span>
                  </div>

                  {connectionTestResult?.success === false && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                      <div className="flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-text-secondary">{connectionTestResult.message}</p>
                      </div>
                    </div>
                  )}

                  {/* Branch selection */}
                  <div>
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wide">Deployment Branch</label>
                    {branchesAutoDiscovered ? (
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="relative flex-1">
                          <button
                            onClick={() => {
                              setShowBranchDropdown(!showBranchDropdown);
                            }}
                            disabled={!canManage || loadingBranches}
                            className="w-full flex items-center justify-between p-2.5 bg-surface-hover rounded-lg border border-border text-sm text-text-secondary hover:bg-surface-hover/80 transition-colors"
                          >
                            <span className="flex items-center gap-2">
                              <GitBranch className="w-3.5 h-3.5 text-text-muted" />
                              {currentBranch || 'Select branch...'}
                            </span>
                            {loadingBranches ? <Loader2 className="w-3.5 h-3.5 animate-spin text-text-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-text-muted" />}
                          </button>
                          {showBranchDropdown && (
                            <div className="absolute z-10 mt-1 w-full bg-surface-primary border border-border rounded-lg shadow-lg max-h-64 overflow-hidden">
                              <div className="p-2 border-b border-border">
                                <div className="relative">
                                  <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
                                  <input
                                    type="text"
                                    value={branchSearch}
                                    onChange={(e) => setBranchSearch(e.target.value)}
                                    placeholder="Search branches..."
                                    className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-hover rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-sky-500"
                                  />
                                </div>
                              </div>
                              <div className="max-h-40 overflow-y-auto">
                                {filteredBranches.length === 0 ? (
                                  <div className="p-3 text-sm text-text-muted text-center">No matching branches</div>
                                ) : (
                                  filteredBranches.map((b) => (
                                    <button
                                      key={b}
                                      onClick={() => handleSelectBranch(b)}
                                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface-hover transition-colors ${b === currentBranch ? 'text-sky-600 dark:text-sky-400 font-medium' : 'text-text-secondary'}`}
                                    >
                                      <GitBranch className="w-3.5 h-3.5 text-text-muted" />
                                      {b}
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={handleLoadBranches}
                          disabled={!canManage || loadingBranches}
                          className="btn-ghost btn-sm"
                          title="Reload branches"
                        >
                          {loadingBranches ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <div className="mt-1.5 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <GitBranch className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              value={manualBranchInput || currentBranch}
                              onChange={(e) => setManualBranchInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && manualBranchInput.trim()) {
                                  handleSelectBranch(manualBranchInput.trim());
                                  setManualBranchInput('');
                                }
                              }}
                              disabled={!canManage}
                              placeholder="Enter branch name (e.g. main, testing, staging)"
                              className="w-full pl-8 pr-3 py-2.5 text-sm bg-surface-hover rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-sky-500"
                            />
                          </div>
                          <button
                            onClick={() => {
                              if (manualBranchInput.trim() || currentBranch) {
                                handleSelectBranch(manualBranchInput.trim() || currentBranch);
                                setManualBranchInput('');
                              }
                            }}
                            disabled={!canManage || (!manualBranchInput.trim() && !currentBranch)}
                            className="btn-secondary btn-sm"
                          >
                            Set Branch
                          </button>
                        </div>
                        {(branches.length > 1 || (branches.length === 1 && branches[0] !== project.git_branch)) && (
                          <div className="flex flex-wrap gap-1.5">
                            {branches.map((b) => (
                              <button
                                key={b}
                                onClick={() => handleSelectBranch(b)}
                                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${b === currentBranch ? 'bg-sky-500 text-white' : 'bg-surface-hover text-text-muted hover:text-text-primary'}`}
                              >
                                {b}
                              </button>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-text-muted">
                          Branch auto-discovery requires a server-side GitHub token. Enter the branch name manually, or type a branch and press Enter.
                        </p>
                      </div>
                    )}
                  </div>

                  {currentBranch && (
                    <button
                      onClick={() => {
                        handleFetchGit();
                        setShowGitAccessModal(false);
                      }}
                      disabled={!canManage || fetchingGit}
                      className="btn-primary btn-sm"
                    >
                      {fetchingGit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
                      Fetch Latest Git
                    </button>
                  )}
                </div>
              );
            }

            // Error states (auth_failed, repo_unreachable, config_error)
            return (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <WifiOff className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    {status === 'auth_failed' ? 'Authentication Failed' : status === 'repo_unreachable' ? 'Repository Unreachable' : 'Configuration Error'}
                  </span>
                </div>
                <p className="text-sm text-text-secondary">{conn.connection_error ?? 'Unknown error'}</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTestConnection}
                    disabled={!canManage || testingConnection}
                    className="btn-primary btn-sm"
                  >
                    {testingConnection ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
                    Test Connection
                  </button>
                  <button
                    onClick={handleGenerateKey}
                    disabled={!canManage || generatingKey}
                    className="btn-secondary btn-sm"
                  >
                    {generatingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Regenerate Key
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </Modal>

      {/* Git Target Upload Modal (SSH-only, no GITHUB_TOKEN needed) */}
      <Modal
        isOpen={showGitTargetUpload}
        onClose={() => !gitTargetUploading && setShowGitTargetUpload(false)}
        title="Upload Git Target Snapshot"
        size="md"
      >
        <div className="space-y-4">
          <div className="p-4 bg-sky-500/10 border border-sky-500/30 rounded-lg">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-text-secondary space-y-2">
                <p className="font-medium text-text-primary">SSH-only workflow — no GitHub API token required.</p>
                <p>To create a Git target snapshot using your SSH deploy key:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Clone the repository locally using the SSH URL.</li>
                  <li>Checkout the branch you want to deploy: <code className="text-text-primary">git checkout &lt;branch&gt;</code></li>
                  <li>Create a ZIP of the working tree (exclude <code className="text-text-primary">.git/</code>, <code className="text-text-primary">node_modules/</code>): <code className="text-text-primary">git archive --format=zip HEAD -o target.zip</code></li>
                  <li>Upload the ZIP below.</li>
                </ol>
                <p>The system will compute SHA-256 file hashes and create a Git target snapshot for comparison.</p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-text-muted uppercase tracking-wide">Branch</label>
              <input
                type="text"
                value={gitTargetBranch}
                onChange={(e) => setGitTargetBranch(e.target.value)}
                disabled={gitTargetUploading}
                placeholder="e.g. main, testing, staging"
                className="mt-1.5 w-full px-3 py-2 text-sm bg-surface-hover rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-muted uppercase tracking-wide">Commit SHA (optional)</label>
              <input
                type="text"
                value={gitTargetCommit}
                onChange={(e) => setGitTargetCommit(e.target.value)}
                disabled={gitTargetUploading}
                placeholder="e.g. abc123def456..."
                className="mt-1.5 w-full px-3 py-2 text-sm font-mono bg-surface-hover rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <p className="text-xs text-text-muted mt-1">Find it with: <code>git rev-parse HEAD</code></p>
            </div>
            <div>
              <label className="text-xs font-medium text-text-muted uppercase tracking-wide">ZIP Archive</label>
              <input
                ref={gitTargetFileRef}
                type="file"
                accept=".zip,application/zip"
                disabled={gitTargetUploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadGitTarget(file);
                }}
                className="mt-1.5 w-full text-sm text-text-secondary file:mr-3 file:py-1.5 file:px-4 file:rounded-lg file:border-0 file:bg-sky-500 file:text-white file:cursor-pointer hover:file:bg-sky-600"
              />
            </div>
          </div>

          {gitTargetProgress && (
            <div className="flex items-center gap-2 p-3 bg-surface-hover rounded-lg">
              <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
              <span className="text-sm text-text-secondary">{gitTargetProgress}</span>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
