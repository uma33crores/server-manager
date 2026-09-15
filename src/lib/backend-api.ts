import { supabase } from './supabase';

// Use relative /api paths — Vite dev proxy forwards to the Node backend;
// in production, Nginx proxies /api to the Node backend.
const API_BASE = '';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

export type SSHStatus = {
  configured: boolean;
  auth_method: string | null;
  configured_by: string | null;
  configured_at: string | null;
  last_tested_at: string | null;
  last_test_success: boolean | null;
  last_test_error: string | null;
};

export type SSHConnectionResult = {
  connected: boolean;
  remoteUser?: string;
  hostname?: string;
  pwd?: string;
  error?: string;
  connectedAt?: string;
};

export type ValidationCheck = {
  name: string;
  status: 'PASS' | 'WARNING' | 'FAILED';
  message: string;
};

export type ProjectValidationResult = {
  checks: ValidationCheck[];
  overall: 'READY' | 'WARNING' | 'FAILED';
};

export type ProjectContext = {
  projectId: string;
  projectName: string;
  projectSlug: string;
  environment: string;
  serverId: string;
  serverName: string;
  serverIp: string | null;
  appDirectory: string;
  supabaseDirectory: string;
  composeName: string;
  projectSlot: number;
  apiPort: number;
  dbPort: number;
  poolerPort: number;
  appDomain: string | null;
  supabaseDomain: string | null;
  repositoryUrl: string | null;
  gitBranch: string | null;
  sshUsername: string | null;
  sshPort: number;
};

export type BackendError = {
  type: 'backend_unavailable' | 'auth_failed' | 'ssh_failed' | 'server_error' | 'validation_error';
  message: string;
};

function classifyError(err: unknown): Error {
  if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
    return new Error('Server Manager backend is unavailable. Start the backend with: cd backend && npm run dev');
  }
  return err instanceof Error ? err : new Error('Unknown error');
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function getSSHStatus(serverId: string): Promise<SSHStatus> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/ssh-status/${serverId}`, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(data.error || 'Failed to get SSH status');
  }
  return res.json();
}

export async function saveSSHCredential(serverId: string, password: string): Promise<void> {
  const headers = await getAuthHeaders();
  try {
    const res = await fetch(`${API_BASE}/api/ssh-credential/${serverId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(data.error || 'SSH credential save failed');
    }
  } catch (err) {
    throw classifyError(err);
  }
}

export async function testSSHConnection(serverId: string): Promise<SSHConnectionResult> {
  const headers = await getAuthHeaders();
  try {
    const res = await fetch(`${API_BASE}/api/test-connection/${serverId}`, {
      method: 'POST',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(data.error || 'Failed to test connection');
    }
    return res.json();
  } catch (err) {
    throw classifyError(err);
  }
}

export async function validateProject(projectId: string): Promise<ProjectValidationResult> {
  const headers = await getAuthHeaders();
  try {
    const res = await fetch(`${API_BASE}/api/validate-project/${projectId}`, {
      method: 'POST',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(data.error || 'Failed to validate project');
    }
    return res.json();
  } catch (err) {
    throw classifyError(err);
  }
}

export async function getProjectContext(projectId: string): Promise<ProjectContext> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/project-context/${projectId}`, { headers });
  if (!res.ok) throw new Error(`Failed to get project context (${res.status})`);
  return res.json();
}
