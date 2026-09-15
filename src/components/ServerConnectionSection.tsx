import { useEffect, useState, useCallback } from 'react';
import type { Project, Server } from '@/lib/supabase';
import {
  getSSHStatus,
  saveSSHCredential,
  testSSHConnection,
  validateProject,
  type SSHStatus,
  type SSHConnectionResult,
  type ProjectValidationResult,
} from '@/lib/backend-api';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';
import {
  Server as ServerIcon,
  KeyRound,
  Wifi,
  WifiOff,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  Lock,
  Terminal,
  RefreshCw,
} from 'lucide-react';

type ConnectionStatus = 'not_tested' | 'connected' | 'failed' | 'testing';

export default function ServerConnectionSection({
  project,
  server,
  onConnectionChange,
}: {
  project: Project;
  server: Server | null;
  onConnectionChange?: (connected: boolean) => void;
}) {
  const { isAdmin, isReadOnly } = useAuth();
  const canManage = isAdmin && !isReadOnly;

  const [sshStatus, setSSHStatus] = useState<SSHStatus | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('not_tested');
  const [connectionResult, setConnectionResult] = useState<SSHConnectionResult | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [testing, setTesting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [showCredModal, setShowCredModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [savingCred, setSavingCred] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [credSaved, setCredSaved] = useState(false);
  const [validation, setValidation] = useState<ProjectValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);

  const loadStatus = useCallback(async () => {
    if (!server) return;
    setLoadingStatus(true);
    try {
      const status = await getSSHStatus(server.id);
      setSSHStatus(status);
      setBackendAvailable(true);
      if (status.last_test_success === true) {
        setConnectionStatus('connected');
      } else if (status.last_test_success === false) {
        setConnectionStatus('failed');
      } else {
        setConnectionStatus('not_tested');
      }
    } catch (err) {
      setSSHStatus(null);
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('backend is unavailable') || msg.includes('Failed to fetch')) {
        setBackendAvailable(false);
      }
    } finally {
      setLoadingStatus(false);
    }
  }, [server]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function handleTestConnection() {
    if (!server) return;
    setTesting(true);
    setActionError(null);
    setConnectionResult(null);
    setConnectionStatus('testing');
    try {
      const result = await testSSHConnection(server.id);
      setConnectionResult(result);
      setConnectionStatus(result.connected ? 'connected' : 'failed');
      onConnectionChange?.(result.connected);
      await loadStatus();
    } catch (err) {
      setConnectionStatus('failed');
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      setActionError(msg);
      if (msg.includes('backend is unavailable')) setBackendAvailable(false);
    } finally {
      setTesting(false);
    }
  }

  async function handleValidateProject() {
    setValidating(true);
    setValidationError(null);
    try {
      const result = await validateProject(project.id);
      setValidation(result);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setValidating(false);
    }
  }

  async function handleSaveCredential() {
    if (!server || !passwordInput) return;
    setSavingCred(true);
    setCredError(null);
    try {
      await saveSSHCredential(server.id, passwordInput);
      setCredSaved(true);
      setPasswordInput('');
      setShowCredModal(false);
      await loadStatus();
      setTimeout(() => setCredSaved(false), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save credential';
      setCredError(msg);
      if (msg.includes('backend is unavailable')) setBackendAvailable(false);
    } finally {
      setSavingCred(false);
    }
  }

  if (!server) {
    return (
      <div className="card p-5 border-amber-500/40 bg-amber-500/5">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          <div>
            <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400">No Server Assigned</h3>
            <p className="text-xs text-text-muted mt-0.5">This project is not linked to a server. Assign a server in the project overview first.</p>
          </div>
        </div>
      </div>
    );
  }

  const statusConfig: Record<ConnectionStatus, { label: string; color: string; icon: typeof Wifi }> = {
    not_tested: { label: 'Not Tested', color: 'text-text-muted', icon: WifiOff },
    connected: { label: 'Connected', color: 'text-emerald-600 dark:text-emerald-400', icon: Wifi },
    failed: { label: 'Failed', color: 'text-red-600 dark:text-red-400', icon: XCircle },
    testing: { label: 'Testing...', color: 'text-sky-600 dark:text-sky-400', icon: Loader2 },
  };

  const StatusIcon = statusConfig[connectionStatus].icon;
  const statusLabel = statusConfig[connectionStatus].label;
  const statusColor = statusConfig[connectionStatus].color;

  return (
    <div className="space-y-4">
      {/* Backend unavailable banner */}
      {backendAvailable === false && (
        <div className="card p-4 border-red-500/40 bg-red-500/5">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <div>
              <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">Server Manager Backend Unavailable</h3>
              <p className="text-xs text-text-muted mt-0.5">
                The Node.js backend is not running. Start it with <code className="font-mono text-text-secondary">cd backend && npm run dev</code> in a separate terminal.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Status Bar */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <ServerIcon className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          <h3 className="text-sm font-semibold text-text-primary">Server Connection</h3>
          <span className={`ml-auto flex items-center gap-1.5 text-xs font-medium ${statusColor}`}>
            <StatusIcon className={`w-3.5 h-3.5 ${connectionStatus === 'testing' ? 'animate-spin' : ''}`} />
            {statusLabel}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <InfoRow label="Server" value={server.name} />
          <InfoRow label="Environment" value={server.environment} badge />
          <InfoRow label="Host" value={server.public_ip ?? server.hostname ?? '-'} mono />
          <InfoRow label="SSH Port" value={String(server.ssh_port)} mono />
          <InfoRow label="Username" value={server.ssh_username ?? '-'} mono />
          <InfoRow
            label="Authentication"
            value={sshStatus?.configured ? 'Password' : 'Not Configured'}
          />
        </div>

        {/* Credential status */}
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-2 text-xs">
            <Lock className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-text-muted">
              SSH Password: {sshStatus?.configured ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Configured</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400 font-medium">Not Configured</span>
              )}
            </span>
            {sshStatus?.last_tested_at && (
              <span className="text-text-faint ml-auto">
                Last tested: {new Date(sshStatus.last_tested_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        {canManage && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
            <button
              onClick={() => { setCredError(null); setShowCredModal(true); }}
              className="btn-secondary btn-sm"
            >
              <KeyRound className="w-3.5 h-3.5" />
              {sshStatus?.configured ? 'Update Credential' : 'Configure Credential'}
            </button>
            <button
              onClick={handleTestConnection}
              disabled={testing || !sshStatus?.configured}
              className="btn-primary btn-sm disabled:opacity-50"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
              Test Connection
            </button>
            {connectionStatus === 'connected' && (
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="btn-ghost btn-sm"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reconnect
              </button>
            )}
          </div>
        )}

        {/* Connection result */}
        {connectionResult && (
          <div className={`mt-3 p-3 rounded-lg border ${connectionResult.connected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
            {connectionResult.connected ? (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  Connected
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-text-muted">
                  <span>Remote User:</span><span className="font-mono text-text-secondary">{connectionResult.remoteUser}</span>
                  <span>Hostname:</span><span className="font-mono text-text-secondary">{connectionResult.hostname}</span>
                  <span>Working Dir:</span><span className="font-mono text-text-secondary">{connectionResult.pwd}</span>
                  <span>Connected At:</span><span className="text-text-secondary">{connectionResult.connectedAt ? new Date(connectionResult.connectedAt).toLocaleString() : '-'}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                <XCircle className="w-4 h-4" />
                <span>{connectionResult.error || 'Connection failed'}</span>
              </div>
            )}
          </div>
        )}

        {actionError && (
          <div className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {actionError}
          </div>
        )}
      </div>

      {/* Project Validation */}
      {connectionStatus === 'connected' && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              <h3 className="text-sm font-semibold text-text-primary">Project Validation</h3>
            </div>
            {canManage && (
              <button
                onClick={handleValidateProject}
                disabled={validating}
                className="btn-secondary btn-sm disabled:opacity-50"
              >
                {validating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Terminal className="w-3.5 h-3.5" />}
                {validation ? 'Re-validate' : 'Validate Project'}
              </button>
            )}
          </div>

          {validation && (
            <div className="space-y-1.5">
              {validation.checks.map((check) => (
                <div key={check.name} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/50 last:border-0">
                  <span className="text-sm text-text-secondary">{check.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-faint">{check.message}</span>
                    <ValidationBadge status={check.status} />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 mt-1">
                <span className="text-sm font-medium text-text-primary">Project Configuration</span>
                <OverallBadge status={validation.overall} />
              </div>
            </div>
          )}

          {validationError && (
            <div className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {validationError}
            </div>
          )}

          {!validation && !validating && (
            <p className="text-xs text-text-muted">Click "Validate Project" to check the server configuration.</p>
          )}
          {validating && (
            <div className="flex items-center gap-2 text-xs text-sky-600 dark:text-sky-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Running read-only validation checks...
            </div>
          )}
        </div>
      )}

      {/* Credential Modal */}
      <Modal open={showCredModal} onClose={() => setShowCredModal(false)} title="Configure SSH Password" size="md">
        {credError && (
          <div className="alert-error mb-4">
            <AlertTriangle className="w-4 h-4" />
            {credError}
          </div>
        )}
        {credSaved && (
          <div className="alert-success mb-4">
            <ShieldCheck className="w-4 h-4" />
            SSH password saved securely. The password is encrypted and will never be shown again.
          </div>
        )}
        <div className="space-y-4">
          <div className="card p-3 bg-surface-hover">
            <div className="flex items-center gap-2 text-xs text-text-muted mb-2">
              <ServerIcon className="w-3.5 h-3.5" />
              <span>Target: <span className="font-mono text-text-secondary">{server.name}</span></span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-text-muted">
              <span>Host: <span className="font-mono text-text-secondary">{server.public_ip ?? server.hostname}</span></span>
              <span>Port: <span className="font-mono text-text-secondary">{server.ssh_port}</span></span>
              <span>Username: <span className="font-mono text-text-secondary">{server.ssh_username ?? 'root'}</span></span>
              <span>Method: <span className="text-text-secondary">Password</span></span>
            </div>
          </div>
          <div>
            <label className="form-label">SSH Password</label>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Enter SSH password"
              className="form-input font-mono"
              autoFocus
            />
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              The password is encrypted before storage and never displayed again.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setShowCredModal(false)} className="btn-ghost">Cancel</button>
          <button
            onClick={handleSaveCredential}
            disabled={!passwordInput || savingCred}
            className="btn-primary disabled:opacity-50"
          >
            {savingCred ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Save Securely
          </button>
        </div>
      </Modal>
    </div>
  );
}

function InfoRow({ label, value, mono, badge }: { label: string; value: string; mono?: boolean; badge?: boolean }) {
  return (
    <div>
      <div className="text-xs text-text-muted mb-0.5">{label}</div>
      {badge ? (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30 capitalize">{value}</span>
      ) : (
        <div className={mono ? 'font-mono text-sm text-text-secondary' : 'text-sm text-text-secondary'}>{value}</div>
      )}
    </div>
  );
}

function ValidationBadge({ status }: { status: 'PASS' | 'WARNING' | 'FAILED' }) {
  const config = {
    PASS: { color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30', icon: CheckCircle2 },
    WARNING: { color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30', icon: AlertTriangle },
    FAILED: { color: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30', icon: XCircle },
  };
  const { color, icon: Icon } = config[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${color}`}>
      <Icon className="w-3 h-3" />
      {status}
    </span>
  );
}

function OverallBadge({ status }: { status: 'READY' | 'WARNING' | 'FAILED' }) {
  const config = {
    READY: { color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30', label: 'READY' },
    WARNING: { color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30', label: 'WARNING' },
    FAILED: { color: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30', label: 'FAILED' },
  };
  const { color, label } = config[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold border ${color}`}>
      {label}
    </span>
  );
}
