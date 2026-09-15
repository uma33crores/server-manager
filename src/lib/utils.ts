import { RESERVED_SYSTEM_KEYS } from './constants';

export function generateSlug(name: string): string {
  let slug = name.toLowerCase();
  slug = slug.replace(/[^a-z0-9 ]/g, '');
  slug = slug.replace(/ +/g, '-');
  slug = slug.replace(/-+/g, '-');
  slug = slug.replace(/^-+|-+$/g, '');
  if (!slug) slug = 'project';
  return slug;
}

export function isReservedKey(key: string): boolean {
  return RESERVED_SYSTEM_KEYS.includes(key.toUpperCase());
}

export function normalizeKey(key: string): string {
  let k = key.trim().toUpperCase();
  k = k.replace(/[^A-Z0-9_]/g, '_');
  k = k.replace(/_+/g, '_');
  k = k.replace(/^_+|_+$/g, '');
  return k;
}

export type SystemVariables = Record<string, string>;

export function getSystemVariables(project: {
  name: string;
  slug: string;
  app_domain: string | null;
  supabase_domain: string | null;
  app_directory: string;
  supabase_directory: string;
  compose_name: string;
  project_slot: number;
  api_port: number;
  db_port: number;
  pooler_port: number;
  repository_url: string | null;
  git_branch: string | null;
}, server: {
  name: string;
  public_ip: string | null;
  environment: string;
  supabase_template_directory?: string;
} | null): SystemVariables {
  return {
    PROJECT_NAME: project.name,
    PROJECT_SLUG: project.slug,
    SERVER_NAME: server?.name ?? '',
    SERVER_IP: server?.public_ip ?? '',
    ENVIRONMENT: server?.environment ?? '',
    APP_DIRECTORY: project.app_directory,
    SUPABASE_DIRECTORY: project.supabase_directory,
    SUPABASE_TEMPLATE_DIRECTORY: server?.supabase_template_directory ?? '/opt/supabase-template/multi-project',
    COMPOSE_NAME: project.compose_name,
    PROJECT_SLOT: String(project.project_slot),
    API_PORT: String(project.api_port),
    DB_PORT: String(project.db_port),
    POOLER_PORT: String(project.pooler_port),
    POOLER_TENANT_ID: project.slug.replace(/-/g, ''),
    APP_DOMAIN: project.app_domain ?? '',
    SUPABASE_DOMAIN: project.supabase_domain ?? '',
    REPOSITORY_URL: project.repository_url ?? '',
    GIT_BRANCH: project.git_branch ?? '',
  };
}

export function resolveCommand(
  template: string,
  vars: SystemVariables
): { resolved: string; missing: string[] } {
  const missing: string[] = [];
  const result = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key: string) => {
    if (key in vars) {
      return vars[key];
    }
    missing.push(key);
    return `{{${key}}}`;
  });
  return { resolved: result, missing };
}

export function buildEnvPreview(variables: { key: string; value: string }[]): string {
  return variables.map((v) => `${v.key}=${v.value}`).join('\n');
}
