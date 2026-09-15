/*
# Seed Default Data

Seeds:
1. A Testing server (DigitalOcean, mandirparikrama.com)
2. Bills TEST project on that server at slot 3 (ports 8200/5434/6545)
3. 18 setup steps for Bills TEST
4. 7 default commands (Server Health, Port Verification, Docker Compose Status/Start/Logs, Supabase Dashboard Login, Supabase Secrets)
5. Auto-generated env variable suggestions for Bills TEST (COMPOSE_PROJECT_NAME, SITE_URL, SUPABASE_PUBLIC_URL, API_EXTERNAL_URL)

No fake credentials or fake secret values are seeded.
*/

-- 1. Create Testing server (idempotent: skip if a testing server already exists)
INSERT INTO servers (name, environment, provider, public_ip, hostname, ssh_username, ssh_port, operating_system, region, ram, disk)
SELECT 'Testing Server', 'testing', 'DigitalOcean', '159.203.50.42', 'testing.mandirparikrama.com', 'root', 22, 'Ubuntu 22.04 LTS', 'Bangalore', '4GB', '80GB'
WHERE NOT EXISTS (SELECT 1 FROM servers WHERE environment = 'testing' LIMIT 1);

-- 2. Create Bills TEST project at slot 3 on the testing server
DO $$
DECLARE
  v_server_id uuid;
  v_project_id uuid;
  v_exists integer;
BEGIN
  SELECT id INTO v_server_id FROM servers WHERE environment = 'testing' ORDER BY created_at ASC LIMIT 1;
  IF v_server_id IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_exists FROM projects WHERE server_id = v_server_id AND slug = 'bills-test';
  IF v_exists > 0 THEN RETURN; END IF;

  INSERT INTO projects (
    name, slug, server_id, app_domain, supabase_domain,
    app_directory, supabase_directory, compose_name,
    project_slot, api_port, db_port, pooler_port,
    repository_url, git_branch, status
  )
  VALUES (
    'Bills TEST', 'bills-test', v_server_id,
    'bills-test.mandirparikrama.com', 'supabase-bills-test.mandirparikrama.com',
    '/var/www/bills-test', '/opt/supabase-instances/bills-test', 'bills-test',
    3, 8200, 5434, 6545,
    'https://github.com/mandirparikrama/bills-test', 'main', 'In Setup'
  )
  RETURNING id INTO v_project_id;

  -- Mark slot 3 as assigned
  UPDATE port_allocations
  SET status = 'assigned', project_id = v_project_id, updated_at = now()
  WHERE server_id = v_server_id AND project_slot = 3;

  -- Create 18 setup steps
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

  -- Auto-generated env variable suggestions (non-sensitive, derived from project)
  INSERT INTO config_variables (scope, project_id, key, value, is_sensitive, description)
  VALUES
    ('project', v_project_id, 'COMPOSE_PROJECT_NAME', 'bills-test', false, 'Docker Compose project namespace'),
    ('project', v_project_id, 'SITE_URL', 'https://bills-test.mandirparikrama.com', false, 'Frontend site URL'),
    ('project', v_project_id, 'SUPABASE_PUBLIC_URL', 'https://supabase-bills-test.mandirparikrama.com', false, 'Supabase public URL'),
    ('project', v_project_id, 'API_EXTERNAL_URL', 'https://supabase-bills-test.mandirparikrama.com', false, 'Supabase API external URL')
  ON CONFLICT DO NOTHING;
END $$;

-- 3. Default commands (global scope, idempotent)
INSERT INTO commands (name, category, scope, command, description, is_sensitive)
SELECT * FROM (VALUES
  ('Server Health', 'Diagnostics', 'global',
   E'echo "========== DISK =========="\nd -h /\n\necho\necho "========== MEMORY =========="\nfree -h\n\necho\necho "========== DOCKER =========="\ndocker system df',
   'Check disk, memory, and Docker usage', false),
  ('Port Verification', 'Diagnostics', 'global',
   E'sudo ss -lntp | grep -E '':({{API_PORT}}|{{DB_PORT}}|{{POOLER_PORT}})\b''',
   'Verify assigned ports are listening', false),
  ('Docker Compose Status', 'Docker', 'global',
   E'cd {{SUPABASE_DIRECTORY}}\ndocker compose ps',
   'Check Supabase container status', false),
  ('Docker Compose Start', 'Docker', 'global',
   E'cd {{SUPABASE_DIRECTORY}}\ndocker compose up -d',
   'Start Supabase containers', false),
  ('Docker Compose Logs', 'Docker', 'global',
   E'cd {{SUPABASE_DIRECTORY}}\ndocker compose logs --tail=100',
   'View recent Supabase logs', false),
  ('Supabase Dashboard Login', 'Supabase', 'global',
   E'cd {{SUPABASE_DIRECTORY}}\ngrep -E ''^(DASHBOARD_USERNAME|DASHBOARD_PASSWORD)='' .env',
   'Get Supabase dashboard credentials from .env', true),
  ('Supabase Secrets', 'Supabase', 'global',
   E'cd {{SUPABASE_DIRECTORY}}\nsh run.sh secrets',
   'Generate fresh Supabase secrets and keys', true)
) AS t(name, category, scope, command, description, is_sensitive)
WHERE NOT EXISTS (SELECT 1 FROM commands WHERE scope = 'global' LIMIT 1);
