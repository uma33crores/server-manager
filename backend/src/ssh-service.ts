import { Client } from 'ssh2';
import type { ConnectConfig, ClientChannel } from 'ssh2';

export type SSHConnectionResult = {
  connected: boolean;
  remoteUser?: string;
  hostname?: string;
  pwd?: string;
  error?: string;
  connectedAt?: string;
};

export type ProjectValidationResult = {
  checks: ValidationCheck[];
  overall: 'READY' | 'WARNING' | 'FAILED';
};

export type ValidationCheck = {
  name: string;
  status: 'PASS' | 'WARNING' | 'FAILED';
  message: string;
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

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function escapeForDoubleQuote(arg: string): string {
  return arg.replace(/[$`"\\]/g, '\\$&');
}

export class SSHService {
  private client: Client | null = null;

  async connect(config: ConnectConfig): Promise<SSHConnectionResult> {
    return new Promise((resolve) => {
      this.client = new Client();

      const timeout = setTimeout(() => {
        this.client?.end();
        resolve({ connected: false, error: 'Connection timed out after 15 seconds' });
      }, 15000);

      this.client.on('ready', () => {
        clearTimeout(timeout);
        const connectedAt = new Date().toISOString();

        // Run safe read-only commands: whoami, hostname, pwd
        this.client?.exec('whoami && hostname && pwd', (err: Error | undefined, stream: ClientChannel) => {
          if (err) {
            this.client?.end();
            resolve({ connected: true, error: 'Connected but failed to run verification commands', connectedAt });
            return;
          }

          let output = '';
          stream.on('data', (data: Buffer) => { output += data.toString(); });
          stream.on('close', () => {
            this.client?.end();
            const parts = output.trim().split('\n');
            resolve({
              connected: true,
              remoteUser: parts[0] || 'unknown',
              hostname: parts[1] || 'unknown',
              pwd: parts[2] || 'unknown',
              connectedAt,
            });
          });
        });
      });

      this.client.on('error', (err: Error & { code?: string; level?: string }) => {
        clearTimeout(timeout);
        let message = err.message;
        if (err.code === 'ECONNREFUSED') message = 'Connection refused — check host and port';
        else if (err.code === 'ENOTFOUND') message = 'Host not found — check the server IP/hostname';
        else if (err.code === 'ETIMEDOUT') message = 'Connection timed out';
        else if (err.level === 'client-authentication') message = 'Authentication failed — check username and password';
        resolve({ connected: false, error: message });
      });

      this.client.connect(config);
    });
  }

  async validateProject(
    config: ConnectConfig,
    ctx: ProjectContext
  ): Promise<ProjectValidationResult> {
    return new Promise((resolve) => {
      this.client = new Client();

      const timeout = setTimeout(() => {
        this.client?.end();
        resolve({
          checks: [{ name: 'SSH Connection', status: 'FAILED', message: 'Connection timed out' }],
          overall: 'FAILED',
        });
      }, 30000);

      this.client.on('ready', () => {
        clearTimeout(timeout);

        // Build validation commands — all read-only, safe
        // Each command outputs: NAME:EXIT_CODE:OUTPUT
        const commands: string[] = [];

        // App directory exists
        commands.push(`test -d ${escapeShellArg(ctx.appDirectory)} && echo "APP_DIR:0:exists" || echo "APP_DIR:1:missing"`);

        // Supabase directory exists
        commands.push(`test -d ${escapeShellArg(ctx.supabaseDirectory)} && echo "SUPA_DIR:0:exists" || echo "SUPA_DIR:1:missing"`);

        // Current release / symlink check (common pattern: releases/ or current symlink)
        const releasesDir = `${ctx.appDirectory}/releases`;
        const currentLink = `${ctx.appDirectory}/current`;
        commands.push(`test -L ${escapeShellArg(currentLink)} && echo "CURRENT_LINK:0:exists" || echo "CURRENT_LINK:2:not_a_symlink"`);

        // COMMIT metadata file (commonly in current release dir)
        commands.push(`test -f ${escapeShellArg(currentLink)}/COMMIT && echo "COMMIT_FILE:0:exists" || echo "COMMIT_FILE:2:not_found"`);

        // Git installed
        commands.push(`which git >/dev/null 2>&1 && echo "GIT:0:installed" || echo "GIT:1:not_installed"`);

        // Bash available
        commands.push(`which bash >/dev/null 2>&1 && echo "BASH:0:available" || echo "BASH:1:not_available"`);

        // SSH client available
        commands.push(`which ssh >/dev/null 2>&1 && echo "SSH:0:available" || echo "SSH:1:not_available"`);

        // ssh-keygen available
        commands.push(`which ssh-keygen >/dev/null 2>&1 && echo "KEYGEN:0:available" || echo "KEYGEN:1:not_available"`);

        // Supabase directory readable
        commands.push(`test -r ${escapeShellArg(ctx.supabaseDirectory)} && echo "SUPA_READ:0:readable" || echo "SUPA_READ:1:not_readable"`);

        // Git repository config exists in app directory
        commands.push(`test -d ${escapeShellArg(ctx.appDirectory)}/.git && echo "GIT_REPO:0:exists" || echo "GIT_REPO:2:not_a_repo"`);

        const fullCommand = commands.join(' && echo "---" && ');

        this.client?.exec(fullCommand, (err: Error | undefined, stream: ClientChannel) => {
          if (err) {
            this.client?.end();
            resolve({
              checks: [{ name: 'SSH Connection', status: 'FAILED', message: 'Failed to run validation commands' }],
              overall: 'FAILED',
            });
            return;
          }

          let output = '';
          stream.on('data', (data: Buffer) => { output += data.toString(); });
          stream.stderr.on('data', (data: Buffer) => { output += data.toString(); });
          stream.on('close', () => {
            this.client?.end();
            resolve(this.parseValidationOutput(output, ctx));
          });
        });
      });

      this.client.on('error', (err: Error & { code?: string; level?: string }) => {
        clearTimeout(timeout);
        let message = err.message;
        if (err.code === 'ECONNREFUSED') message = 'Connection refused';
        else if (err.level === 'client-authentication') message = 'Authentication failed';
        resolve({
          checks: [{ name: 'SSH Connection', status: 'FAILED', message }],
          overall: 'FAILED',
        });
      });

      this.client.connect(config);
    });
  }

  private parseValidationOutput(output: string, ctx: ProjectContext): ProjectValidationResult {
    const checks: ValidationCheck[] = [];
    const lines = output.trim().split('\n');

    const labelMap: Record<string, string> = {
      'APP_DIR': 'Application Directory',
      'SUPA_DIR': 'Supabase Directory',
      'CURRENT_LINK': 'Current Release Symlink',
      'COMMIT_FILE': 'Current COMMIT Metadata',
      'GIT': 'Git',
      'BASH': 'Bash',
      'SSH': 'SSH Client',
      'KEYGEN': 'ssh-keygen',
      'SUPA_READ': 'Supabase Directory Readable',
      'GIT_REPO': 'Git Repository',
    };

    for (const line of lines) {
      if (line === '---' || !line.trim()) continue;
      const match = line.match(/^(\w+):(\d+):(.*)$/);
      if (!match) continue;
      const [, code, exitStr, msg] = match;
      const exitCode = parseInt(exitStr, 10);
      const label = labelMap[code] ?? code;

      let status: 'PASS' | 'WARNING' | 'FAILED';
      if (exitCode === 0) status = 'PASS';
      else if (exitCode === 2) status = 'WARNING';
      else status = 'FAILED';

      checks.push({ name: label, status, message: msg });
    }

    const hasFailed = checks.some(c => c.status === 'FAILED');
    const hasWarning = checks.some(c => c.status === 'WARNING');
    const overall = hasFailed ? 'FAILED' : hasWarning ? 'WARNING' : 'READY';

    return { checks, overall };
  }

  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
    }
  }
}
