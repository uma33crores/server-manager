import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { SSHService, type ProjectContext } from './ssh-service.js';
import { supabaseAdmin, createUserClient } from './supabase-client.js';
import { encrypt, decrypt } from './crypto.js';

const hasServiceRoleKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const app = express();
const PORT = parseInt(process.env.BACKEND_PORT || '3001', 10);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================================
// Auth middleware: verify Supabase JWT and check user role
// ============================================================
type AuthenticatedRequest = express.Request & {
  userId: string;
  userEmail: string;
  userRole: string;
  isReadOnly: boolean;
  accessToken: string;
};

async function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Look up the user's role. When the service-role key is available,
    // query user_roles directly (bypasses RLS). Otherwise, use the
    // SECURITY DEFINER function get_user_role_record() which also
    // bypasses RLS and is callable with the anon key.
    let roleRecord: { role: string; is_active: boolean; access_type: string } | null = null;
    let roleErr: string | null = null;

    if (hasServiceRoleKey) {
      const { data, error: roleError } = await supabaseAdmin
        .from('user_roles')
        .select('role, is_active, access_type')
        .eq('user_id', user.id)
        .maybeSingle();
      if (roleError) {
        roleErr = roleError.message;
      } else {
        roleRecord = data as { role: string; is_active: boolean; access_type: string } | null;
      }
    } else {
      const userClient = createUserClient(token);
      const { data, error: rpcError } = await userClient
        .rpc('get_user_role_record', { p_user_id: user.id });
      if (rpcError) {
        roleErr = rpcError.message;
      } else {
        const rows = data as { role: string; is_active: boolean; access_type: string }[];
        roleRecord = (rows && rows.length > 0) ? rows[0] : null;
      }
    }

    if (roleErr) {
      console.error('Unable to load user role:', roleErr);
      res.status(500).json({ error: 'Unable to verify account permissions' });
      return;
    }

    if (!roleRecord) {
      console.log(`No user_roles record for user ${user.id} (${user.email ?? 'no email'})`);
      res.status(403).json({ error: 'No Server Manager role is assigned to this account' });
      return;
    }

    if (!roleRecord.is_active) {
      res.status(403).json({ error: 'Account not active' });
      return;
    }

    const authReq = req as AuthenticatedRequest;
    authReq.userId = user.id;
    authReq.userEmail = user.email ?? '';
    authReq.userRole = roleRecord.role;
    authReq.isReadOnly = roleRecord.access_type === 'read_only';
    authReq.accessToken = token;

    next();
  } catch {
    res.status(401).json({ error: 'Token verification failed' });
  }
}

function requireWriteAccess(req: AuthenticatedRequest, res: express.Response): boolean {
  if (req.isReadOnly) {
    res.status(403).json({ error: 'Read-only users cannot perform this action' });
    return false;
  }
  return true;
}

// ============================================================
// Helper: Get SSH connection config for a server
// ============================================================
async function getSSHConfig(serverId: string, accessToken: string): Promise<{
  host: string;
  port: number;
  username: string;
  password: string;
} | null> {
  const userClient = createUserClient(accessToken);

  const { data: server, error: serverError } = await userClient
    .from('servers')
    .select('*')
    .eq('id', serverId)
    .maybeSingle();

  if (serverError || !server) return null;

  const { data: encryptedPassword, error: pwdError } = await userClient
    .rpc('get_ssh_credential_encrypted', { p_server_id: serverId });

  if (pwdError || !encryptedPassword) return null;

  let password: string;
  try {
    password = decrypt(encryptedPassword as string);
  } catch {
    return null;
  }

  return {
    host: server.public_ip || server.hostname || '',
    port: server.ssh_port || 22,
    username: server.ssh_username || 'root',
    password,
  };
}

// ============================================================
// Helper: Build project context from database
// ============================================================
async function getProjectContext(projectId: string, accessToken: string): Promise<ProjectContext | null> {
  const userClient = createUserClient(accessToken);

  const { data: project, error } = await userClient
    .from('projects')
    .select('*, server:servers(*)')
    .eq('id', projectId)
    .maybeSingle();

  if (error || !project) return null;

  const server = project.server as Record<string, unknown>;
  return {
    projectId: project.id,
    projectName: project.name,
    projectSlug: project.slug,
    environment: (server.environment as string) ?? 'production',
    serverId: project.server_id,
    serverName: (server.name as string) ?? '',
    serverIp: (server.public_ip as string) ?? null,
    appDirectory: project.app_directory,
    supabaseDirectory: project.supabase_directory,
    composeName: project.compose_name,
    projectSlot: project.project_slot,
    apiPort: project.api_port,
    dbPort: project.db_port,
    poolerPort: project.pooler_port,
    appDomain: project.app_domain,
    supabaseDomain: project.supabase_domain,
    repositoryUrl: project.repository_url,
    gitBranch: project.git_branch,
    sshUsername: (server.ssh_username as string) ?? null,
    sshPort: (server.ssh_port as number) ?? 22,
  };
}

// ============================================================
// Helper: Log audit
// ============================================================
async function logAudit(
  accessToken: string,
  userId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  status: 'SUCCESS' | 'FAILURE',
  failureReason: string | null = null
) {
  const userClient = createUserClient(accessToken);
  await userClient.from('audit_logs').insert({
    admin_id: userId,
    admin_email: '',
    action,
    entity_type: entityType,
    entity_id: entityId,
    status,
    failure_reason: failureReason,
  });
}

// ============================================================
// Routes
// ============================================================

// Health check (unauthenticated)
app.get('/api/health', (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok' });
});

// Get SSH credential status (safe fields only — no password)
app.get('/api/ssh-status/:serverId', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userClient = createUserClient(authReq.accessToken);

    const serverId = String(req.params.serverId);
    const { data, error } = await userClient
      .rpc('get_ssh_credential_status', { p_server_id: serverId });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    if (!data || (data as unknown[]).length === 0) {
      res.json({
        configured: false,
        auth_method: null,
        configured_by: null,
        configured_at: null,
        last_tested_at: null,
        last_test_success: null,
        last_test_error: null,
      });
      return;
    }

    res.json((data as Record<string, unknown>[])[0]);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Save SSH credential (encrypts password in Node.js, stores encrypted blob)
app.post('/api/ssh-credential/:serverId', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!requireWriteAccess(authReq, res)) return;

    const { password } = req.body as { password?: string };
    if (!password || typeof password !== 'string') {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    const serverId = String(req.params.serverId);
    const encryptedPassword = encrypt(password);
    const userClient = createUserClient(authReq.accessToken);

    const { error } = await userClient.rpc('save_ssh_credential_encrypted', {
      p_server_id: serverId,
      p_encrypted_password: encryptedPassword,
    });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await logAudit(authReq.accessToken, authReq.userId, 'ssh_credential_configured', 'servers', serverId, 'SUCCESS');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Test SSH connection
app.post('/api/test-connection/:serverId', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!requireWriteAccess(authReq, res)) return;

    const serverId = String(req.params.serverId);
    const sshConfig = await getSSHConfig(serverId, authReq.accessToken);
    if (!sshConfig) {
      res.status(400).json({ error: 'Server not found or SSH credential not configured' });
      return;
    }

    if (!sshConfig.host) {
      res.status(400).json({ error: 'Server has no public IP or hostname configured' });
      return;
    }

    const ssh = new SSHService();
    const result = await ssh.connect({
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.username,
      password: sshConfig.password,
      readyTimeout: 15000,
    });

    ssh.disconnect();

    const userClient = createUserClient(authReq.accessToken);
    await userClient.rpc('update_ssh_test_result', {
      p_server_id: serverId,
      p_success: result.connected,
      p_error: result.error ?? null,
    });

    await logAudit(
      authReq.accessToken,
      authReq.userId,
      'server_connection_tested',
      'servers',
      serverId,
      result.connected ? 'SUCCESS' : 'FAILURE',
      result.error
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Validate project configuration on server
app.post('/api/validate-project/:projectId', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!requireWriteAccess(authReq, res)) return;

    const projectId = String(req.params.projectId);
    const ctx = await getProjectContext(projectId, authReq.accessToken);
    if (!ctx) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const sshConfig = await getSSHConfig(ctx.serverId, authReq.accessToken);
    if (!sshConfig) {
      res.status(400).json({ error: 'SSH credential not configured for this server' });
      return;
    }

    const ssh = new SSHService();
    const result = await ssh.validateProject(
      {
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        password: sshConfig.password,
        readyTimeout: 30000,
      },
      ctx
    );

    ssh.disconnect();

    await logAudit(
      authReq.accessToken,
      authReq.userId,
      'project_validation_performed',
      'projects',
      projectId,
      result.overall === 'FAILED' ? 'FAILURE' : 'SUCCESS'
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Get project context (for frontend to display)
app.get('/api/project-context/:projectId', authMiddleware, async (req: express.Request, res: express.Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const projectId = String(req.params.projectId);
    const ctx = await getProjectContext(projectId, authReq.accessToken);
    if (!ctx) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(ctx);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server Manager backend running on port ${PORT}`);
});
