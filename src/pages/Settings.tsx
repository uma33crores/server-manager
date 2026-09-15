import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Check, Copy } from 'lucide-react';

const FLOW_SUMMARY = `# Server Manager — Project Setup Flow

## What This Tool Does
Server Manager is an internal infrastructure management tool for managing DigitalOcean Ubuntu servers running multiple independent React/Vite + self-hosted Supabase projects on a single server.

## Server Setup
- Each server has shared paths: Supabase template directory, Supabase instances directory, frontend apps directory, Nginx sites-available, and Nginx sites-enabled.
- Each server has its own independent port registry with 50 slots.

## Port Allocation (Automatic)
- API Port = 8000 + ((slot - 1) * 100)
- DB Port = 5432 + (slot - 1)
- Pooler Port = 6543 + (slot - 1)
- Example: Slot 3 → API 8200, DB 5434, Pooler 6545

## Project Creation (Automatic)
When a project is created on a server, the system automatically generates:
- Project slug (from project name, lowercased, hyphenated)
- App directory: {frontend_apps_directory}/{slug}
- Supabase directory: {supabase_instances_directory}/{slug}
- Compose name: {slug}
- Project slot (next available slot on that server)
- API port, DB port, Pooler port (from the slot)
- 18 setup steps with default commands per step

## The 18 Setup Steps (Runbook)
1. Server Preflight — Check RAM, disk, Docker usage, and port availability
2. Verify Project Ports — Confirm API, DB, and Pooler ports are free
3. DNS — Create A records for app domain and Supabase domain
4. Copy Supabase Template — Copy from server's template directory to project's Supabase directory
5. Create Project .env — Edit the .env file in the Supabase directory
6. Configure COMPOSE_PROJECT_NAME — Set to the project slug in .env
7. Generate Supabase Keys — Run generate-keys.sh and add-new-auth-keys.sh
8. Configure Ports — Set API_GW_HTTP_PORT, POSTGRES_PORT, POOLER_PROXY_PORT_TRANSACTION, POOLER_TENANT_ID in .env
9. Start Supabase — docker compose up -d, verify containers are running
10. Clone Frontend — git clone the repository into the app directory
11. Database / Migrations — Connect to the project's DB port on 127.0.0.1, run migrations or restore
12. Frontend Nginx — Create Nginx config for the app domain
13. Supabase Nginx — Create Nginx config for the Supabase domain, proxy to 127.0.0.1:{API_PORT}
14. SSL / Certbot — Run certbot for both domains
15. Supabase URLs — Set SUPABASE_PUBLIC_URL, API_EXTERNAL_URL, SITE_URL in .env
16. Frontend Supabase Environment — Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the app's .env
17. Build Frontend — npm install, npm run build, verify dist directory
18. Final Verification — curl both domains, check Docker containers, Nginx config, and ports

## Key Rules
- Each project has its own: app directory, Supabase directory, Docker Compose namespace, database, Auth, Storage, .env, secrets, keys, Nginx config, domains, and ports.
- Never reuse another project's .env, database, secrets, keys, containers, directories, Compose Name, or ports.
- DB and Pooler should bind to 127.0.0.1 — never expose them publicly.
- Supabase Nginx proxies to 127.0.0.1:{API_PORT}.
- Commands are stored as templates with {{PLACEHOLDER}} syntax and resolved with project values when displayed.
- All commands are for manual execution on the Ubuntu server — the tool does not execute commands remotely.
- Custom commands can be added to any setup step for project-specific needs.

## Placeholders Used in Commands
{{PROJECT_NAME}}, {{PROJECT_SLUG}}, {{SERVER_NAME}}, {{SERVER_IP}}, {{ENVIRONMENT}}, {{APP_DIRECTORY}}, {{SUPABASE_DIRECTORY}}, {{SUPABASE_TEMPLATE_DIRECTORY}}, {{COMPOSE_NAME}}, {{PROJECT_SLOT}}, {{API_PORT}}, {{DB_PORT}}, {{POOLER_PORT}}, {{POOLER_TENANT_ID}}, {{APP_DOMAIN}}, {{SUPABASE_DOMAIN}}, {{REPOSITORY_URL}}, {{GIT_BRANCH}}

## Example: Bills TEST (Slot 3)
- Slug: bills-test
- App Directory: /var/www/bills-test
- Supabase Directory: /opt/supabase-instances/bills-test
- Compose Name: bills-test
- API Port: 8200, DB Port: 5434, Pooler Port: 6545
- POOLER_TENANT_ID: billstest`;

export default function Settings() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  function copyFlow() {
    navigator.clipboard.writeText(FLOW_SUMMARY);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Settings</h1>

      <div className="card p-5 mb-4">
        <h2 className="text-lg font-semibold text-text-primary mb-3">Account</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-text-muted">Email</dt>
            <dd className="text-text-primary">{user?.email}</dd>
          </div>
        </dl>
      </div>

      <div className="card p-5 mb-4">
        <h2 className="text-lg font-semibold text-text-primary mb-3">About Server Manager</h2>
        <p className="text-sm text-text-muted mb-3">
          Server Manager is an internal infrastructure management tool for managing DigitalOcean Ubuntu servers
          running multiple independent React/Vite + self-hosted Supabase projects.
        </p>
        <ul className="text-sm text-text-muted space-y-1 list-disc list-inside">
          <li>Automatic port allocation per server (50 slots, API/DB/Pooler)</li>
          <li>Automatic project slug, path, and compose name generation</li>
          <li>18-step project setup checklist created automatically</li>
          <li>Dynamic key-value configuration (no schema changes needed)</li>
          <li>Dynamic command library with placeholder resolution</li>
          <li>Credential storage with sensitive value protection</li>
          <li>Commands are stored for manual execution - no remote execution</li>
        </ul>
      </div>

      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-text-primary">Project Setup Flow Summary</h2>
          <button
            onClick={copyFlow}
            className="btn-secondary btn-sm"
          >
            {copied ? <><Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy for ChatGPT</>}
          </button>
        </div>
        <p className="text-sm text-text-muted mb-3">
          Copy this summary and paste it into ChatGPT when you need assistance with your server setup flow.
          It describes the full project creation process, port allocation, all 18 setup steps, key rules, and placeholder variables.
        </p>
        <pre className="bg-surface border border-border rounded-lg p-4 max-h-[400px] overflow-y-auto text-xs font-mono text-text-secondary whitespace-pre-wrap">{FLOW_SUMMARY}</pre>
      </div>

      <div className="card p-5">
        <h2 className="text-lg font-semibold text-text-primary mb-3">Port Allocation Formula</h2>
        <div className="space-y-2 text-sm font-mono text-text-secondary">
          <p>API Port = 8000 + ((slot - 1) * 100)</p>
          <p>DB Port = 5432 + (slot - 1)</p>
          <p>Pooler Port = 6543 + (slot - 1)</p>
        </div>
        <p className="text-xs text-text-faint mt-3">
          Each server has its own independent port registry. Ports allocated on one server do not affect another.
        </p>
      </div>
    </div>
  );
}
