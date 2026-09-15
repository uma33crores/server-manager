/*
# Setup Step Commands — Runbook Upgrade

1. New Table
- `setup_step_commands` — one setup step can contain multiple ready-to-copy commands.
  - `id` (uuid, pk)
  - `setup_step_id` (uuid, fk -> project_setup_steps ON DELETE CASCADE)
  - `title` (text) — label shown above the command block
  - `command_template` (text) — template with `{{PLACEHOLDER}}` syntax
  - `sort_order` (integer, default 0)
  - `is_sensitive` (boolean, default false)
  - `is_custom` (boolean, default false) — true when added by the user
  - `created_at`, `updated_at` (timestamptz)

2. RPC: `seed_setup_step_commands(p_project_id uuid)`
   - For each of the 18 setup steps, inserts the standard default commands if none exist yet for that step.
   - Idempotent: checks existence before inserting, never duplicates.
   - Uses the project's server to resolve `{{SUPABASE_TEMPLATE_DIRECTORY}}`.
   - Works for both newly created projects and existing projects (e.g. Bills TEST).

3. RPC: `create_project` updated
   - After creating 18 setup steps, calls `seed_setup_step_commands` for the new project.

4. Security
   - RLS enabled on `setup_step_commands`, authenticated-only CRUD (matches existing tables).

5. Notes
   - Existing `project_setup_steps.command` column is preserved for backward compatibility but the UI will prefer rows from `setup_step_commands`.
   - Default command templates use `{{PLACEHOLDER}}` syntax resolved client-side from project/server values.
*/

-- ============================================================
-- 1. setup_step_commands table
-- ============================================================
CREATE TABLE IF NOT EXISTS setup_step_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setup_step_id uuid NOT NULL REFERENCES project_setup_steps(id) ON DELETE CASCADE,
  title text NOT NULL,
  command_template text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_sensitive boolean NOT NULL DEFAULT false,
  is_custom boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_setup_step_commands_step ON setup_step_commands (setup_step_id, sort_order);

-- updated_at trigger
DROP TRIGGER IF EXISTS set_updated_at ON setup_step_commands;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON setup_step_commands
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE setup_step_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authed_select" ON setup_step_commands;
CREATE POLICY "authed_select" ON setup_step_commands FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authed_insert" ON setup_step_commands;
CREATE POLICY "authed_insert" ON setup_step_commands FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "authed_update" ON setup_step_commands;
CREATE POLICY "authed_update" ON setup_step_commands FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authed_delete" ON setup_step_commands;
CREATE POLICY "authed_delete" ON setup_step_commands FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON setup_step_commands TO authenticated;

-- ============================================================
-- 2. seed_setup_step_commands RPC
-- ============================================================
CREATE OR REPLACE FUNCTION seed_setup_step_commands(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_step RECORD;
  v_count integer;
  v_inserted integer := 0;
BEGIN
  FOR v_step IN
    SELECT id, step_number FROM project_setup_steps
    WHERE project_id = p_project_id
    ORDER BY step_number
  LOOP
    -- Only seed if this step has zero commands yet
    SELECT count(*) INTO v_count FROM setup_step_commands WHERE setup_step_id = v_step.id;
    IF v_count > 0 THEN CONTINUE; END IF;

    INSERT INTO setup_step_commands (setup_step_id, title, command_template, sort_order, is_sensitive)
    SELECT v_step.id, t.title, t.command_template, t.sort_order, t.is_sensitive
    FROM (
      VALUES
        -- Step 1: Server Preflight
        (1,  1, 'Disk / Memory / Docker', E'echo "========== DISK =========="\ndf -h /\n\necho\necho "========== MEMORY =========="\nfree -h\n\necho\necho "========== DOCKER =========="\ndocker system df', false),
        (1,  2, 'Running Containers', 'docker ps', false),
        (1,  3, 'Port Check', E'sudo ss -lntp | grep -E '':({{API_PORT}}|{{DB_PORT}}|{{POOLER_PORT}})\b''', false),

        -- Step 2: Verify Project Ports
        (2,  1, 'Port Check', E'sudo ss -lntp | grep -E '':({{API_PORT}}|{{DB_PORT}}|{{POOLER_PORT}})\b''', false),
        (2,  2, 'lsof API', E'sudo lsof -i :{{API_PORT}}', false),
        (2,  3, 'lsof DB', E'sudo lsof -i :{{DB_PORT}}', false),
        (2,  4, 'lsof Pooler', E'sudo lsof -i :{{POOLER_PORT}}', false),

        -- Step 3: DNS
        (3,  1, 'dig App Domain', E'dig +short {{APP_DOMAIN}}', false),
        (3,  2, 'dig Supabase Domain', E'dig +short {{SUPABASE_DOMAIN}}', false),
        (3,  3, 'nslookup App', E'nslookup {{APP_DOMAIN}}', false),
        (3,  4, 'nslookup Supabase', E'nslookup {{SUPABASE_DOMAIN}}', false),

        -- Step 4: Copy Supabase Template
        (4,  1, 'Copy Template', E'sudo cp -a {{SUPABASE_TEMPLATE_DIRECTORY}} {{SUPABASE_DIRECTORY}}', false),
        (4,  2, 'Verify', E'cd {{SUPABASE_DIRECTORY}}\npwd\nls -la', false),

        -- Step 5: Create .env
        (5,  1, 'Enter Directory', 'cd {{SUPABASE_DIRECTORY}}', false),
        (5,  2, 'List Files', 'ls -la', false),
        (5,  3, 'Edit .env', 'nano .env', false),

        -- Step 6: Compose Project Name
        (6,  1, 'Verify COMPOSE_PROJECT_NAME', E'cd {{SUPABASE_DIRECTORY}}\ngrep ''^COMPOSE_PROJECT_NAME='' .env', false),
        (6,  2, 'Edit .env', E'cd {{SUPABASE_DIRECTORY}}\nnano .env', false),

        -- Step 7: Generate Keys
        (7,  1, 'Generate Keys', E'cd {{SUPABASE_DIRECTORY}}\nsh utils/generate-keys.sh', false),
        (7,  2, 'Add Auth Keys', E'cd {{SUPABASE_DIRECTORY}}\nsh utils/add-new-auth-keys.sh', false),
        (7,  3, 'Secrets', E'cd {{SUPABASE_DIRECTORY}}\nsh run.sh secrets', true),

        -- Step 8: Configure Ports
        (8,  1, 'Edit .env', E'cd {{SUPABASE_DIRECTORY}}\nnano .env', false),
        (8,  2, 'Verify Ports', E'cd {{SUPABASE_DIRECTORY}}\ngrep -E ''^(API_GW_HTTP_PORT|POSTGRES_PORT|POOLER_PROXY_PORT_TRANSACTION|POOLER_TENANT_ID)='' .env', false),

        -- Step 9: Start Supabase
        (9,  1, 'Start', E'cd {{SUPABASE_DIRECTORY}}\ndocker compose up -d', false),
        (9,  2, 'Check Containers', E'cd {{SUPABASE_DIRECTORY}}\ndocker compose ps', false),
        (9,  3, 'View Logs', E'cd {{SUPABASE_DIRECTORY}}\ndocker compose logs --tail=100', false),
        (9,  4, 'Project Containers', E'docker ps --filter "label=com.docker.compose.project={{COMPOSE_NAME}}"', false),

        -- Step 10: Clone Frontend
        (10, 1, 'Clone', E'sudo mkdir -p {{APP_DIRECTORY}}\nsudo chown -R $USER:$USER {{APP_DIRECTORY}}\ngit clone {{REPOSITORY_URL}} {{APP_DIRECTORY}}\ncd {{APP_DIRECTORY}}', false),
        (10, 2, 'Checkout Branch', E'cd {{APP_DIRECTORY}}\ngit checkout {{GIT_BRANCH}}', false),

        -- Step 11: Database / Migrations
        (11, 1, 'Connection Check', E'nc -zv 127.0.0.1 {{DB_PORT}}', false),

        -- Step 12: Frontend Nginx
        (12, 1, 'Create Config', E'sudo nano /etc/nginx/sites-available/{{PROJECT_SLUG}}', false),
        (12, 2, 'Enable Site', E'sudo ln -s /etc/nginx/sites-available/{{PROJECT_SLUG}} /etc/nginx/sites-enabled/{{PROJECT_SLUG}}', false),
        (12, 3, 'Test Config', 'sudo nginx -t', false),
        (12, 4, 'Reload', 'sudo systemctl reload nginx', false),

        -- Step 13: Supabase Nginx
        (13, 1, 'Create Config', E'sudo nano /etc/nginx/sites-available/supabase-{{PROJECT_SLUG}}', false),
        (13, 2, 'Enable Site', E'sudo ln -s /etc/nginx/sites-available/supabase-{{PROJECT_SLUG}} /etc/nginx/sites-enabled/supabase-{{PROJECT_SLUG}}', false),
        (13, 3, 'Test Config', 'sudo nginx -t', false),
        (13, 4, 'Reload', 'sudo systemctl reload nginx', false),

        -- Step 14: SSL
        (14, 1, 'Frontend Cert', E'sudo certbot --nginx -d {{APP_DOMAIN}}', false),
        (14, 2, 'Supabase Cert', E'sudo certbot --nginx -d {{SUPABASE_DOMAIN}}', false),
        (14, 3, 'Verify Certs', 'sudo certbot certificates', false),

        -- Step 15: Supabase URLs
        (15, 1, 'Edit .env', E'cd {{SUPABASE_DIRECTORY}}\nnano .env', false),
        (15, 2, 'Verify URLs', E'cd {{SUPABASE_DIRECTORY}}\ngrep -E ''^(SUPABASE_PUBLIC_URL|API_EXTERNAL_URL|SITE_URL)='' .env', false),

        -- Step 16: Frontend Env
        (16, 1, 'List Files', E'cd {{APP_DIRECTORY}}\nls -la', false),
        (16, 2, 'Edit .env', E'cd {{APP_DIRECTORY}}\nnano .env', false),

        -- Step 17: Build Frontend
        (17, 1, 'Install', E'cd {{APP_DIRECTORY}}\nnpm install', false),
        (17, 2, 'Build', E'cd {{APP_DIRECTORY}}\nnpm run build', false),
        (17, 3, 'Verify Build', E'cd {{APP_DIRECTORY}}\nls -lah dist', false),

        -- Step 18: Final Verification
        (18, 1, 'curl App', E'curl -I https://{{APP_DOMAIN}}', false),
        (18, 2, 'curl Supabase', E'curl -I https://{{SUPABASE_DOMAIN}}', false),
        (18, 3, 'Supabase Status', E'cd {{SUPABASE_DIRECTORY}}\ndocker compose ps', false),
        (18, 4, 'Project Containers', E'docker ps --filter "label=com.docker.compose.project={{COMPOSE_NAME}}"', false),
        (18, 5, 'Nginx Test', 'sudo nginx -t', false),
        (18, 6, 'Port Check', E'sudo ss -lntp | grep -E '':({{API_PORT}}|{{DB_PORT}}|{{POOLER_PORT}})\b''', false)
    ) AS t(step_num, sort_order, title, command_template, is_sensitive)
    WHERE t.step_num = v_step.step_number;

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

-- ============================================================
-- 3. Update create_project to seed commands
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

  v_base_slug := lower(regexp_replace(regexp_replace(p_name, '[^a-zA-Z0-9 ]', '', 'g'), ' +', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '-+', '-', 'g');
  v_base_slug := trim(both '-' from v_base_slug);
  IF v_base_slug = '' THEN
    v_base_slug := 'project';
  END IF;

  SELECT project_slot INTO v_slot FROM port_allocations
  WHERE server_id = p_server_id AND status = 'available'
  ORDER BY project_slot ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'No available port slots on this server';
  END IF;

  v_api_port := 8000 + ((v_slot - 1) * 100);
  v_db_port := 5432 + (v_slot - 1);
  v_pooler_port := 6543 + (v_slot - 1);

  v_slug := v_base_slug;
  LOOP
    SELECT count(*) INTO v_count FROM projects WHERE server_id = p_server_id AND slug = v_slug;
    EXIT WHEN v_count = 0;
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  END LOOP;

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

  UPDATE port_allocations
  SET status = 'assigned', project_id = v_project_id, updated_at = now()
  WHERE server_id = p_server_id AND project_slot = v_slot;

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

  -- Seed default commands for all 18 steps
  PERFORM seed_setup_step_commands(v_project_id);

  RETURN QUERY SELECT
    v_project_id, v_slug, v_slot, v_api_port, v_db_port, v_pooler_port,
    v_server.frontend_apps_directory || '/' || v_slug,
    v_server.supabase_instances_directory || '/' || v_slug,
    v_slug;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. Seed commands for existing projects (Bills TEST etc.)
-- ============================================================
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT id FROM projects LOOP
    PERFORM seed_setup_step_commands(p.id);
  END LOOP;
END $$;
