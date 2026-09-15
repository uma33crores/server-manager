/*
# Server Manager - Core Schema

Creates all tables, constraints, RLS policies, triggers, and RPC functions
for the Server Manager internal application.

## Tables
1. servers — Server records with shared infrastructure paths (Testing/Staging/Production)
2. projects — Project records with auto-generated infrastructure fields (slug, paths, ports, compose name)
3. port_allocations — Port registry per server (50 slots pre-seeded via trigger)
4. project_setup_steps — 18-step setup checklist per project
5. config_variables — Generic key-value configuration (global/server/project scope)
6. commands — Command library with text templates (global/server/project scope)
7. command_variables — Command-specific key-value variables
8. credentials — Credentials (server/project scope)
9. notes — Notes (server/project scope)

## Security
- RLS enabled on ALL tables
- All tables accessible to authenticated users only (internal tool, single-user)
- Any authenticated user has full CRUD access to all data

## Automation
- Trigger: auto-creates 50 port allocation slots when a server is inserted
- Trigger: auto-updates updated_at on every row update
- RPC: create_project() — atomic project creation with auto slug, paths, ports, setup steps
- RPC: ensure_project_setup_steps() — creates 18 default steps if missing (fix for existing projects)
*/

-- ============================================================
-- 1. SERVERS
-- ============================================================
CREATE TABLE IF NOT EXISTS servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('testing', 'staging', 'production')),
  provider text,
  public_ip text,
  hostname text,
  ssh_username text,
  ssh_port integer NOT NULL DEFAULT 22,
  operating_system text,
  region text,
  ram text,
  disk text,
  supabase_template_directory text NOT NULL DEFAULT '/opt/supabase-template/multi-project',
  supabase_instances_directory text NOT NULL DEFAULT '/opt/supabase-instances',
  frontend_apps_directory text NOT NULL DEFAULT '/var/www',
  nginx_sites_available text NOT NULL DEFAULT '/etc/nginx/sites-available',
  nginx_sites_enabled text NOT NULL DEFAULT '/etc/nginx/sites-enabled',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. PROJECTS
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  app_domain text,
  supabase_domain text,
  app_directory text NOT NULL,
  supabase_directory text NOT NULL,
  compose_name text NOT NULL,
  project_slot integer NOT NULL,
  api_port integer NOT NULL,
  db_port integer NOT NULL,
  pooler_port integer NOT NULL,
  repository_url text,
  git_branch text,
  status text NOT NULL DEFAULT 'In Setup' CHECK (status IN ('In Setup', 'Running', 'Stopped', 'Archived')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_server_slug_unique ON projects (server_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS projects_server_app_dir_unique ON projects (server_id, app_directory);
CREATE UNIQUE INDEX IF NOT EXISTS projects_server_supabase_dir_unique ON projects (server_id, supabase_directory);
CREATE UNIQUE INDEX IF NOT EXISTS projects_server_compose_unique ON projects (server_id, compose_name);
CREATE UNIQUE INDEX IF NOT EXISTS projects_server_api_port_unique ON projects (server_id, api_port);
CREATE UNIQUE INDEX IF NOT EXISTS projects_server_db_port_unique ON projects (server_id, db_port);
CREATE UNIQUE INDEX IF NOT EXISTS projects_server_pooler_port_unique ON projects (server_id, pooler_port);
CREATE UNIQUE INDEX IF NOT EXISTS projects_server_slot_unique ON projects (server_id, project_slot);

-- ============================================================
-- 3. PORT ALLOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS port_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  project_slot integer NOT NULL,
  api_port integer NOT NULL,
  db_port integer NOT NULL,
  pooler_port integer NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'assigned')),
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS port_alloc_server_slot_unique ON port_allocations (server_id, project_slot);

-- ============================================================
-- 4. PROJECT SETUP STEPS
-- ============================================================
CREATE TABLE IF NOT EXISTS project_setup_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'blocked')),
  command text,
  notes text,
  command_output text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS setup_steps_project_step_unique ON project_setup_steps (project_id, step_number);

-- ============================================================
-- 5. CONFIG VARIABLES
-- ============================================================
CREATE TABLE IF NOT EXISTS config_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('global', 'server', 'project')),
  server_id uuid REFERENCES servers(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL DEFAULT '',
  is_sensitive boolean NOT NULL DEFAULT false,
  description text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS config_vars_global_unique ON config_variables (key) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS config_vars_server_unique ON config_variables (server_id, key) WHERE scope = 'server';
CREATE UNIQUE INDEX IF NOT EXISTS config_vars_project_unique ON config_variables (project_id, key) WHERE scope = 'project';

-- ============================================================
-- 6. COMMANDS
-- ============================================================
CREATE TABLE IF NOT EXISTS commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  scope text NOT NULL CHECK (scope IN ('global', 'server', 'project')),
  server_id uuid REFERENCES servers(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  command text NOT NULL,
  description text,
  notes text,
  is_sensitive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. COMMAND VARIABLES
-- ============================================================
CREATE TABLE IF NOT EXISTS command_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL DEFAULT '',
  is_sensitive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cmd_vars_unique ON command_variables (command_id, key);

-- ============================================================
-- 8. CREDENTIALS
-- ============================================================
CREATE TABLE IF NOT EXISTS credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('server', 'project')),
  server_id uuid REFERENCES servers(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  value text NOT NULL,
  is_sensitive boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 9. NOTES
-- ============================================================
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('server', 'project')),
  server_id uuid REFERENCES servers(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['servers','projects','port_allocations','project_setup_steps','config_variables','commands','command_variables','credentials','notes'])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t);
  END LOOP;
END $$;

-- ============================================================
-- TRIGGER: auto-create 50 port allocation slots on server insert
-- ============================================================
CREATE OR REPLACE FUNCTION create_server_port_slots()
RETURNS trigger AS $$
BEGIN
  INSERT INTO port_allocations (server_id, project_slot, api_port, db_port, pooler_port, status)
  SELECT NEW.id, i, 8000 + ((i - 1) * 100), 5432 + (i - 1), 6543 + (i - 1), 'available'
  FROM generate_series(1, 50) AS i;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_create_server_port_slots ON servers;
CREATE TRIGGER trigger_create_server_port_slots
AFTER INSERT ON servers
FOR EACH ROW EXECUTE FUNCTION create_server_port_slots();

-- ============================================================
-- RPC: create_project (atomic project creation)
-- ============================================================
CREATE OR REPLACE FUNCTION create_project(
  p_server_id uuid,
  p_name text,
  p_app_domain text DEFAULT NULL,
  p_supabase_domain text DEFAULT NULL,
  p_repository_url text DEFAULT NULL,
  p_git_branch text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_status text DEFAULT 'In Setup'
)
RETURNS TABLE(
  project_id uuid,
  project_slug text,
  project_slot integer,
  api_port integer,
  db_port integer,
  pooler_port integer,
  app_directory text,
  supabase_directory text,
  compose_name text
)
AS $$
DECLARE
  v_server RECORD;
  v_slug text;
  v_base_slug text;
  v_suffix integer := 0;
  v_slot integer;
  v_api_port integer;
  v_db_port integer;
  v_pooler_port integer;
  v_project_id uuid;
  v_count integer;
BEGIN
  SELECT * INTO v_server FROM servers WHERE id = p_server_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Server not found';
  END IF;

  -- Generate base slug from name
  v_base_slug := lower(regexp_replace(regexp_replace(p_name, '[^a-zA-Z0-9 ]', '', 'g'), ' +', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '-+', '-', 'g');
  v_base_slug := trim(both '-' from v_base_slug);
  IF v_base_slug = '' THEN
    v_base_slug := 'project';
  END IF;

  -- Atomically find and lock first available slot
  SELECT project_slot INTO v_slot FROM port_allocations
  WHERE server_id = p_server_id AND status = 'available'
  ORDER BY project_slot ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'No available port slots on this server';
  END IF;

  -- Calculate ports from slot
  v_api_port := 8000 + ((v_slot - 1) * 100);
  v_db_port := 5432 + (v_slot - 1);
  v_pooler_port := 6543 + (v_slot - 1);

  -- Generate unique slug within this server
  v_slug := v_base_slug;
  LOOP
    SELECT count(*) INTO v_count FROM projects WHERE server_id = p_server_id AND slug = v_slug;
    EXIT WHEN v_count = 0;
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  END LOOP;

  -- Create project
  INSERT INTO projects (
    name, slug, server_id, app_domain, supabase_domain,
    app_directory, supabase_directory, compose_name,
    project_slot, api_port, db_port, pooler_port,
    repository_url, git_branch, notes, status
  )
  VALUES (
    p_name, v_slug, p_server_id, p_app_domain, p_supabase_domain,
    v_server.frontend_apps_directory || '/' || v_slug,
    v_server.supabase_instances_directory || '/' || v_slug,
    v_slug, v_slot, v_api_port, v_db_port, v_pooler_port,
    p_repository_url, p_git_branch, p_notes, p_status
  )
  RETURNING id INTO v_project_id;

  -- Mark port allocation as assigned
  UPDATE port_allocations
  SET status = 'assigned', project_id = v_project_id, updated_at = now()
  WHERE server_id = p_server_id AND project_slot = v_slot;

  -- Create 18 default setup steps
  INSERT INTO project_setup_steps (project_id, step_number, title, status)
  SELECT v_project_id, i,
    CASE i
      WHEN 1 THEN 'Check server RAM, disk, Docker usage and ports'
      WHEN 2 THEN 'Verify assigned API, DB and Pooler ports'
      WHEN 3 THEN 'Create App and Supabase DNS'
      WHEN 4 THEN 'Copy Supabase template'
      WHEN 5 THEN 'Create project .env'
      WHEN 6 THEN 'Configure COMPOSE_PROJECT_NAME'
      WHEN 7 THEN 'Generate fresh Supabase secrets and keys'
      WHEN 8 THEN 'Configure API, DB, Pooler and POOLER_TENANT_ID'
      WHEN 9 THEN 'Start and verify Supabase containers'
      WHEN 10 THEN 'Clone frontend project'
      WHEN 11 THEN 'Restore database or run migrations'
      WHEN 12 THEN 'Configure frontend Nginx'
      WHEN 13 THEN 'Configure Supabase Nginx'
      WHEN 14 THEN 'Configure SSL with Certbot'
      WHEN 15 THEN 'Configure SUPABASE_PUBLIC_URL, API_EXTERNAL_URL and SITE_URL'
      WHEN 16 THEN 'Configure frontend Supabase URL and anon key'
      WHEN 17 THEN 'Build frontend'
      WHEN 18 THEN 'Verify new project and verify existing projects are unaffected'
    END,
    'not_started'
  FROM generate_series(1, 18) AS i;

  RETURN QUERY SELECT
    v_project_id, v_slug, v_slot, v_api_port, v_db_port, v_pooler_port,
    v_server.frontend_apps_directory || '/' || v_slug,
    v_server.supabase_instances_directory || '/' || v_slug,
    v_slug;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: ensure_project_setup_steps (fix projects with 0 steps)
-- ============================================================
CREATE OR REPLACE FUNCTION ensure_project_setup_steps(p_project_id uuid)
RETURNS integer AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM project_setup_steps WHERE project_id = p_project_id;
  IF v_count = 0 THEN
    INSERT INTO project_setup_steps (project_id, step_number, title, status)
    SELECT p_project_id, i,
      CASE i
        WHEN 1 THEN 'Check server RAM, disk, Docker usage and ports'
        WHEN 2 THEN 'Verify assigned API, DB and Pooler ports'
        WHEN 3 THEN 'Create App and Supabase DNS'
        WHEN 4 THEN 'Copy Supabase template'
        WHEN 5 THEN 'Create project .env'
        WHEN 6 THEN 'Configure COMPOSE_PROJECT_NAME'
        WHEN 7 THEN 'Generate fresh Supabase secrets and keys'
        WHEN 8 THEN 'Configure API, DB, Pooler and POOLER_TENANT_ID'
        WHEN 9 THEN 'Start and verify Supabase containers'
        WHEN 10 THEN 'Clone frontend project'
        WHEN 11 THEN 'Restore database or run migrations'
        WHEN 12 THEN 'Configure frontend Nginx'
        WHEN 13 THEN 'Configure Supabase Nginx'
        WHEN 14 THEN 'Configure SSL with Certbot'
        WHEN 15 THEN 'Configure SUPABASE_PUBLIC_URL, API_EXTERNAL_URL and SITE_URL'
        WHEN 16 THEN 'Configure frontend Supabase URL and anon key'
        WHEN 17 THEN 'Build frontend'
        WHEN 18 THEN 'Verify new project and verify existing projects are unaffected'
      END,
      'not_started'
    FROM generate_series(1, 18) AS i;
    RETURN 18;
  END IF;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RLS: Enable on all tables, authenticated users have full access
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['servers','projects','port_allocations','project_setup_steps','config_variables','commands','command_variables','credentials','notes'])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS "authed_select" ON %I', t);
    EXECUTE format('CREATE POLICY "authed_select" ON %I FOR SELECT TO authenticated USING (true)', t);

    EXECUTE format('DROP POLICY IF EXISTS "authed_insert" ON %I', t);
    EXECUTE format('CREATE POLICY "authed_insert" ON %I FOR INSERT TO authenticated WITH CHECK (true)', t);

    EXECUTE format('DROP POLICY IF EXISTS "authed_update" ON %I', t);
    EXECUTE format('CREATE POLICY "authed_update" ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t);

    EXECUTE format('DROP POLICY IF EXISTS "authed_delete" ON %I', t);
    EXECUTE format('CREATE POLICY "authed_delete" ON %I FOR DELETE TO authenticated USING (true)', t);
  END LOOP;
END $$;

-- Grant necessary permissions to authenticated role
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['servers','projects','port_allocations','project_setup_steps','config_variables','commands','command_variables','credentials','notes'])
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
  END LOOP;
END $$;
