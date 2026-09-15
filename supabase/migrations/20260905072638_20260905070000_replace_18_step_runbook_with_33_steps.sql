/*
# Replace 18-step runbook with 33-step deployment runbook

1. Purpose
- Replaces the old 18-step project setup checklist with a 33-step deployment runbook.
- Removes all database migration, database restore, schema restore, data restore, and `supabase db push` steps.
- Supabase remains a fresh blank project on first start.

2. Modified database objects
- `create_project` — now creates 33 setup steps (titles updated) and seeds commands for all 33.
- `ensure_project_setup_steps` — now ensures 33 steps with new titles.
- `seed_setup_step_commands` — now seeds the full 33-step command set.

3. Data migration for existing projects
- Deletes setup steps 19-18 (old) and recreates the full 1-33 set for every existing project.
- Re-seeds commands for all existing projects.
- Preserves user-added custom commands and step statuses where step numbers overlap (1-18 titles change, so statuses are reset for safety).

4. Security
- No RLS or permission changes. SECURITY DEFINER preserved on all functions.
*/

-- ============================================================
-- 1. Updated create_project (33 steps, qualified pa.project_slot)
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

  SELECT pa.project_slot INTO v_slot
  FROM port_allocations AS pa
  WHERE pa.server_id = p_server_id AND pa.status = 'available'
  ORDER BY pa.project_slot ASC
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

  UPDATE port_allocations AS pa
  SET status = 'assigned', project_id = v_project_id, updated_at = now()
  WHERE pa.server_id = p_server_id AND pa.project_slot = v_slot;

  INSERT INTO project_setup_steps (project_id, step_number, title, status)
  SELECT v_project_id, i,
    CASE i
      WHEN 1 THEN 'Check Server Resources'
      WHEN 2 THEN 'Check Assigned Ports'
      WHEN 3 THEN 'Verify DNS'
      WHEN 4 THEN 'Check Project Does Not Already Exist'
      WHEN 5 THEN 'Create Supabase Instance'
      WHEN 6 THEN 'Verify Multi-Project Template'
      WHEN 7 THEN 'Create Project .env'
      WHEN 8 THEN 'Configure Compose Project Name'
      WHEN 9 THEN 'Generate Fresh Supabase Secrets'
      WHEN 10 THEN 'Configure API, DB and Pooler Ports'
      WHEN 11 THEN 'Configure Supabase Studio'
      WHEN 12 THEN 'Configure Supabase Public URLs'
      WHEN 13 THEN 'Keep DB and Pooler Private'
      WHEN 14 THEN 'Validate Docker Compose'
      WHEN 15 THEN 'Pull Supabase Images'
      WHEN 16 THEN 'Start Supabase'
      WHEN 17 THEN 'Test Supabase Locally'
      WHEN 18 THEN 'Get Dashboard Login'
      WHEN 19 THEN 'Clone Fresh Frontend Project'
      WHEN 20 THEN 'Create Frontend Nginx Config'
      WHEN 21 THEN 'Create Supabase Nginx Config'
      WHEN 22 THEN 'Test Nginx'
      WHEN 23 THEN 'Test HTTP Supabase Routing'
      WHEN 24 THEN 'Configure SSL'
      WHEN 25 THEN 'Recreate Supabase'
      WHEN 26 THEN 'Get Frontend Supabase Key'
      WHEN 27 THEN 'Configure Frontend Environment'
      WHEN 28 THEN 'Install Frontend Dependencies'
      WHEN 29 THEN 'Build Frontend'
      WHEN 30 THEN 'Final App Verification'
      WHEN 31 THEN 'Verify Project Containers'
      WHEN 32 THEN 'Verify Project Ports'
      WHEN 33 THEN 'Verify Existing Projects Are Unaffected'
    END,
    'not_started'
  FROM generate_series(1, 33) AS i;

  PERFORM seed_setup_step_commands(v_project_id);

  RETURN QUERY SELECT
    v_project_id, v_slug, v_slot, v_api_port, v_db_port, v_pooler_port,
    v_server.frontend_apps_directory || '/' || v_slug,
    v_server.supabase_instances_directory || '/' || v_slug,
    v_slug;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. Updated ensure_project_setup_steps (33 steps)
-- ============================================================
CREATE OR REPLACE FUNCTION ensure_project_setup_steps(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM project_setup_steps WHERE project_id = p_project_id;
  IF v_count = 0 THEN
    INSERT INTO project_setup_steps (project_id, step_number, title, status)
    SELECT p_project_id, i,
      CASE i
        WHEN 1 THEN 'Check Server Resources'
        WHEN 2 THEN 'Check Assigned Ports'
        WHEN 3 THEN 'Verify DNS'
        WHEN 4 THEN 'Check Project Does Not Already Exist'
        WHEN 5 THEN 'Create Supabase Instance'
        WHEN 6 THEN 'Verify Multi-Project Template'
        WHEN 7 THEN 'Create Project .env'
        WHEN 8 THEN 'Configure Compose Project Name'
        WHEN 9 THEN 'Generate Fresh Supabase Secrets'
        WHEN 10 THEN 'Configure API, DB and Pooler Ports'
        WHEN 11 THEN 'Configure Supabase Studio'
        WHEN 12 THEN 'Configure Supabase Public URLs'
        WHEN 13 THEN 'Keep DB and Pooler Private'
        WHEN 14 THEN 'Validate Docker Compose'
        WHEN 15 THEN 'Pull Supabase Images'
        WHEN 16 THEN 'Start Supabase'
        WHEN 17 THEN 'Test Supabase Locally'
        WHEN 18 THEN 'Get Dashboard Login'
        WHEN 19 THEN 'Clone Fresh Frontend Project'
        WHEN 20 THEN 'Create Frontend Nginx Config'
        WHEN 21 THEN 'Create Supabase Nginx Config'
        WHEN 22 THEN 'Test Nginx'
        WHEN 23 THEN 'Test HTTP Supabase Routing'
        WHEN 24 THEN 'Configure SSL'
        WHEN 25 THEN 'Recreate Supabase'
        WHEN 26 THEN 'Get Frontend Supabase Key'
        WHEN 27 THEN 'Configure Frontend Environment'
        WHEN 28 THEN 'Install Frontend Dependencies'
        WHEN 29 THEN 'Build Frontend'
        WHEN 30 THEN 'Final App Verification'
        WHEN 31 THEN 'Verify Project Containers'
        WHEN 32 THEN 'Verify Project Ports'
        WHEN 33 THEN 'Verify Existing Projects Are Unaffected'
      END,
      'not_started'
    FROM generate_series(1, 33) AS i;
    RETURN 33;
  END IF;
  RETURN v_count;
END;
$$;

-- ============================================================
-- 3. Updated seed_setup_step_commands (33 steps, full command set)
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
    SELECT count(*) INTO v_count FROM setup_step_commands WHERE setup_step_id = v_step.id;
    IF v_count > 0 THEN CONTINUE; END IF;

    INSERT INTO setup_step_commands (setup_step_id, title, command_template, sort_order, is_sensitive)
    SELECT v_step.id, t.title, t.command_template, t.sort_order, t.is_sensitive
    FROM (
      VALUES
        -- Step 1: Check Server Resources
        (1,  1, 'Disk / Memory / Swap / Docker / Load', E'echo "========== DISK =========="\ndf -h /\n\necho\necho "========== MEMORY =========="\nfree -h\n\necho\necho "========== SWAP =========="\nswapon --show\n\necho\necho "========== DOCKER =========="\ndocker system df\n\necho\necho "========== RUNNING CONTAINERS =========="\ndocker ps\n\necho\necho "========== LOAD =========="\nuptime\n\ndocker stats --no-stream', false),

        -- Step 2: Check Assigned Ports
        (2,  1, 'Port Status Check', E'for PORT in "$API_PORT" "$DB_PORT" "$POOLER_PORT"; do\n    if sudo ss -lnt | grep -q ":${PORT} "; then\n        echo "PORT ${PORT}: IN USE"\n    else\n        echo "PORT ${PORT}: FREE"\n    fi\ndone', false),
        (2,  2, 'lsof API', E'sudo lsof -i :"{{API_PORT}}"', false),
        (2,  3, 'lsof DB', E'sudo lsof -i :"{{DB_PORT}}"', false),
        (2,  4, 'lsof Pooler', E'sudo lsof -i :"{{POOLER_PORT}}"', false),

        -- Step 3: Verify DNS
        (3,  1, 'dig App Domain', E'dig +short "{{APP_DOMAIN}}"', false),
        (3,  2, 'dig Supabase Domain', E'dig +short "{{SUPABASE_DOMAIN}}"', false),
        (3,  3, 'nslookup App', E'nslookup "{{APP_DOMAIN}}"', false),
        (3,  4, 'nslookup Supabase', E'nslookup "{{SUPABASE_DOMAIN}}"', false),

        -- Step 4: Check Project Does Not Already Exist
        (4,  1, 'Check Supabase Dir', E'ls -ld "{{SUPABASE_DIRECTORY}}" 2>/dev/null', false),
        (4,  2, 'Check App Dir', E'ls -ld "{{APP_DIRECTORY}}" 2>/dev/null', false),

        -- Step 5: Create Supabase Instance
        (5,  1, 'Create Directory', E'sudo mkdir -p "{{SUPABASE_DIRECTORY}}"', false),
        (5,  2, 'Copy Template', E'sudo cp -rf \\\n{{SUPABASE_TEMPLATE_DIRECTORY}}/. \\\n"{{SUPABASE_DIRECTORY}}/"', false),
        (5,  3, 'Set Ownership', E'sudo chown -R "$USER":"$USER" "{{SUPABASE_DIRECTORY}}"', false),
        (5,  4, 'Verify', E'cd "{{SUPABASE_DIRECTORY}}"\npwd\nls -la', false),

        -- Step 6: Verify Multi-Project Template
        (6,  1, 'Check container_name', E'cd "{{SUPABASE_DIRECTORY}}"\ngrep -n ''^[[:space:]]*container_name:'' docker-compose.yml', false),

        -- Step 7: Create Project .env
        (7,  1, 'Copy .env.example', E'cd "{{SUPABASE_DIRECTORY}}"\ncp .env.example .env\nls -la .env', false),

        -- Step 8: Configure Compose Project Name
        (8,  1, 'Set COMPOSE_PROJECT_NAME', E'cd "{{SUPABASE_DIRECTORY}}"\nif grep -q ''^COMPOSE_PROJECT_NAME='' .env; then\n    sed -i \\\n    "s/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME={{PROJECT_SLUG}}/" \\\n    .env\nelse\n    echo "COMPOSE_PROJECT_NAME={{PROJECT_SLUG}}" >> .env\nfi', false),
        (8,  2, 'Verify', E'cd "{{SUPABASE_DIRECTORY}}"\ngrep ''^COMPOSE_PROJECT_NAME='' .env', false),

        -- Step 9: Generate Fresh Supabase Secrets
        (9,  1, 'Generate Keys', E'cd "{{SUPABASE_DIRECTORY}}"\nsh utils/generate-keys.sh', false),
        (9,  2, 'Add Auth Keys', E'cd "{{SUPABASE_DIRECTORY}}"\nsh utils/add-new-auth-keys.sh', false),
        (9,  3, 'Verify Secrets (hidden)', E'cd "{{SUPABASE_DIRECTORY}}"\ngrep -E \\\n''^(POSTGRES_PASSWORD|JWT_SECRET|SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY|DASHBOARD_PASSWORD)='' \\\n.env | sed ''s/=.*/=[HIDDEN]/''', false),

        -- Step 10: Configure API, DB and Pooler Ports
        (10, 1, 'Set Ports', E'cd "{{SUPABASE_DIRECTORY}}"\nsed -i \\\n"s/^API_GW_HTTP_PORT=.*/API_GW_HTTP_PORT={{API_PORT}}/" \\\n.env\n\nsed -i \\\n"s/^POSTGRES_PORT=.*/POSTGRES_PORT={{DB_PORT}}/" \\\n.env\n\nsed -i \\\n"s/^POOLER_PROXY_PORT_TRANSACTION=.*/POOLER_PROXY_PORT_TRANSACTION={{POOLER_PORT}}/" \\\n.env\n\nsed -i \\\n"s/^POOLER_TENANT_ID=.*/POOLER_TENANT_ID={{PROJECT_SLUG}}/" \\\n.env', false),
        (10, 2, 'Verify Ports', E'cd "{{SUPABASE_DIRECTORY}}"\ngrep -E \\\n''^(API_GW_HTTP_PORT|POSTGRES_PORT|POOLER_PROXY_PORT_TRANSACTION|POOLER_TENANT_ID|COMPOSE_PROJECT_NAME)='' \\\n.env', false),

        -- Step 11: Configure Supabase Studio
        (11, 1, 'Set Studio Project/Org', E'cd "{{SUPABASE_DIRECTORY}}"\nsed -i \\\n"s/^STUDIO_DEFAULT_PROJECT=.*/STUDIO_DEFAULT_PROJECT={{PROJECT_NAME}}/" \\\n.env\n\nsed -i \\\n"s/^STUDIO_DEFAULT_ORGANIZATION=.*/STUDIO_DEFAULT_ORGANIZATION={{PROJECT_NAME}}/" \\\n.env', false),
        (11, 2, 'Verify Studio', E'cd "{{SUPABASE_DIRECTORY}}"\ngrep -E \\\n''^(STUDIO_DEFAULT_PROJECT|STUDIO_DEFAULT_ORGANIZATION)='' \\\n.env', false),

        -- Step 12: Configure Supabase Public URLs
        (12, 1, 'Set URLs', E'cd "{{SUPABASE_DIRECTORY}}"\nsed -i \\\n"s|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=https://{{SUPABASE_DOMAIN}}|" \\\n.env\n\nsed -i \\\n"s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=https://{{SUPABASE_DOMAIN}}/auth/v1|" \\\n.env\n\nsed -i \\\n"s|^SITE_URL=.*|SITE_URL=https://{{APP_DOMAIN}}|" \\\n.env', false),
        (12, 2, 'Verify URLs', E'cd "{{SUPABASE_DIRECTORY}}"\ngrep -E \\\n''^(SUPABASE_PUBLIC_URL|API_EXTERNAL_URL|SITE_URL)='' \\\n.env', false),

        -- Step 13: Keep DB and Pooler Private
        (13, 1, 'Bind to 127.0.0.1', E'cd "{{SUPABASE_DIRECTORY}}"\nsed -i \\\n''s|- ${POSTGRES_PORT}:5432|- "127.0.0.1:${POSTGRES_PORT}:5432"|'' \\\ndocker-compose.yml\n\nsed -i \\\n''s|- ${POOLER_PROXY_PORT_TRANSACTION}:6543|- "127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION}:6543"|'' \\\ndocker-compose.yml', false),
        (13, 2, 'Verify', E'cd "{{SUPABASE_DIRECTORY}}"\ngrep -n ''127.0.0.1'' docker-compose.yml', false),

        -- Step 14: Validate Docker Compose
        (14, 1, 'Validate', E'cd "{{SUPABASE_DIRECTORY}}"\ndocker compose config --quiet', false),
        (14, 2, 'Verify Project Name', E'cd "{{SUPABASE_DIRECTORY}}"\ngrep ''^COMPOSE_PROJECT_NAME='' .env', false),

        -- Step 15: Pull Supabase Images
        (15, 1, 'Pull', E'cd "{{SUPABASE_DIRECTORY}}"\ndocker compose pull', false),

        -- Step 16: Start Supabase
        (16, 1, 'Start', E'cd "{{SUPABASE_DIRECTORY}}"\nsh run.sh start', false),
        (16, 2, 'Check Containers', E'cd "{{SUPABASE_DIRECTORY}}"\ndocker compose ps', false),
        (16, 3, 'Project Containers', E'docker ps \\\n--filter "label=com.docker.compose.project={{COMPOSE_NAME}}"', false),
        (16, 4, 'Logs', E'cd "{{SUPABASE_DIRECTORY}}"\ndocker compose logs --tail=100', false),

        -- Step 17: Test Supabase Locally
        (17, 1, 'curl Auth', E'curl -I \\\n"http://127.0.0.1:{{API_PORT}}/auth/v1/"', false),

        -- Step 18: Get Dashboard Login
        (18, 1, 'Dashboard Credentials', E'grep -E \\\n''^(DASHBOARD_USERNAME|DASHBOARD_PASSWORD)='' \\\n"{{SUPABASE_DIRECTORY}}/.env"', true),

        -- Step 19: Clone Fresh Frontend Project
        (19, 1, 'Create App Dir', E'sudo mkdir -p "{{APP_DIRECTORY}}"\nsudo chown -R "$USER":"$USER" "{{APP_DIRECTORY}}"', false),
        (19, 2, 'Clone', E'git clone \\\n--branch "{{GIT_BRANCH}}" \\\n--single-branch \\\n"{{REPOSITORY_URL}}" \\\n"{{APP_DIRECTORY}}"', false),
        (19, 3, 'Verify', E'cd "{{APP_DIRECTORY}}"\ngit branch --show-current\ngit status', false),

        -- Step 20: Create Frontend Nginx Config
        (20, 1, 'Create Config', E'sudo nano \\\n"/etc/nginx/sites-available/{{PROJECT_SLUG}}"', false),
        (20, 2, 'Config Content', E'server {\n    listen 80;\n    listen [::]:80;\n\n    server_name {{APP_DOMAIN}};\n\n    root /var/www/{{PROJECT_SLUG}}/dist;\n    index index.html;\n\n    location / {\n        try_files $uri $uri/ /index.html;\n    }\n}', false),
        (20, 3, 'Enable Site', E'sudo ln -sfn \\\n"/etc/nginx/sites-available/{{PROJECT_SLUG}}" \\\n"/etc/nginx/sites-enabled/{{PROJECT_SLUG}}"', false),

        -- Step 21: Create Supabase Nginx Config
        (21, 1, 'Create Config', E'sudo nano \\\n"/etc/nginx/sites-available/supabase-{{PROJECT_SLUG}}"', false),
        (21, 2, 'Config Content', E'server {\n    listen 80;\n    listen [::]:80;\n\n    server_name {{SUPABASE_DOMAIN}};\n\n    client_max_body_size 100M;\n\n    location /realtime/v1/ {\n        proxy_pass http://127.0.0.1:{{API_PORT}};\n\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection "upgrade";\n\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n\n        proxy_read_timeout 3600;\n    }\n\n    location / {\n        proxy_pass http://127.0.0.1:{{API_PORT}};\n\n        proxy_http_version 1.1;\n\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}', false),
        (21, 3, 'Enable Site', E'sudo ln -sfn \\\n"/etc/nginx/sites-available/supabase-{{PROJECT_SLUG}}" \\\n"/etc/nginx/sites-enabled/supabase-{{PROJECT_SLUG}}"', false),

        -- Step 22: Test Nginx
        (22, 1, 'Test Config', 'sudo nginx -t', false),
        (22, 2, 'Reload', 'sudo systemctl reload nginx', false),
        (22, 3, 'Status', 'sudo systemctl is-active nginx', false),

        -- Step 23: Test HTTP Supabase Routing
        (23, 1, 'curl Supabase HTTP', E'curl -I \\\n"http://{{SUPABASE_DOMAIN}}/auth/v1/"', false),

        -- Step 24: Configure SSL
        (24, 1, 'Frontend Cert', E'sudo certbot --nginx \\\n-d "{{APP_DOMAIN}}"', false),
        (24, 2, 'Supabase Cert', E'sudo certbot --nginx \\\n-d "{{SUPABASE_DOMAIN}}"', false),
        (24, 3, 'Verify Certs', 'sudo certbot certificates', false),
        (24, 4, 'Reload Nginx', E'sudo nginx -t\nsudo systemctl reload nginx', false),

        -- Step 25: Recreate Supabase
        (25, 1, 'Recreate', E'cd "{{SUPABASE_DIRECTORY}}"\nsh run.sh recreate', false),
        (25, 2, 'Verify', E'cd "{{SUPABASE_DIRECTORY}}"\ndocker compose ps', false),

        -- Step 26: Get Frontend Supabase Key
        (26, 1, 'Get Publishable Key', E'grep ''^SUPABASE_PUBLISHABLE_KEY='' \\\n"{{SUPABASE_DIRECTORY}}/.env"', true),

        -- Step 27: Configure Frontend Environment
        (27, 1, 'Edit .env', E'cd "{{APP_DIRECTORY}}"\nnano .env', false),
        (27, 2, 'Env Content', E'VITE_SUPABASE_URL=https://{{SUPABASE_DOMAIN}}\nVITE_SUPABASE_ANON_KEY={{PROJECT_PUBLISHABLE_KEY}}', false),
        (27, 3, 'Protect .env', E'cd "{{APP_DIRECTORY}}"\ngrep -q ''^\\.env$'' .gitignore || echo ''.env'' >> .gitignore', false),

        -- Step 28: Install Frontend Dependencies
        (28, 1, 'npm install', E'cd "{{APP_DIRECTORY}}"\nnpm install', false),

        -- Step 29: Build Frontend
        (29, 1, 'Build', E'cd "{{APP_DIRECTORY}}"\nnpm run build', false),
        (29, 2, 'Verify Build', E'cd "{{APP_DIRECTORY}}"\nls -lah dist', false),
        (29, 3, 'Reload Nginx', 'sudo systemctl reload nginx', false),

        -- Step 30: Final App Verification
        (30, 1, 'curl Frontend', E'curl -I \\\n"https://{{APP_DOMAIN}}"', false),
        (30, 2, 'curl Supabase', E'curl -I \\\n"https://{{SUPABASE_DOMAIN}}/auth/v1/"', false),

        -- Step 31: Verify Project Containers
        (31, 1, 'Compose ps', E'cd "{{SUPABASE_DIRECTORY}}"\ndocker compose ps', false),
        (31, 2, 'Project Containers', E'docker ps \\\n--filter "label=com.docker.compose.project={{COMPOSE_NAME}}"', false),

        -- Step 32: Verify Project Ports
        (32, 1, 'Port Check', E'for PORT in "$API_PORT" "$DB_PORT" "$POOLER_PORT"; do\n    echo "===== PORT ${PORT} ====="\n    sudo ss -lntp | grep ":${PORT} "\ndone', false),

        -- Step 33: Verify Existing Projects Are Unaffected
        (33, 1, 'All Containers', E'docker ps --format \\\n''table {{.Names}}\\t{{.Status}}\\t{{.Ports}}''', false),
        (33, 2, 'Supabase Instances', 'ls -la /opt/supabase-instances/', false),
        (33, 3, 'Nginx Test', 'sudo nginx -t', false)
    ) AS t(step_num, sort_order, title, command_template, is_sensitive)
    WHERE t.step_num = v_step.step_number;

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

-- ============================================================
-- 4. Migrate existing projects to 33-step runbook
-- ============================================================
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT id FROM projects LOOP
    -- Delete old steps 19+ (old runbook had 18 steps; new has 33)
    -- Then delete ALL steps and recreate with new titles
    DELETE FROM project_setup_steps WHERE project_id = p.id;

    -- Recreate with 33 new steps
    INSERT INTO project_setup_steps (project_id, step_number, title, status)
    SELECT p.id, i,
      CASE i
        WHEN 1 THEN 'Check Server Resources'
        WHEN 2 THEN 'Check Assigned Ports'
        WHEN 3 THEN 'Verify DNS'
        WHEN 4 THEN 'Check Project Does Not Already Exist'
        WHEN 5 THEN 'Create Supabase Instance'
        WHEN 6 THEN 'Verify Multi-Project Template'
        WHEN 7 THEN 'Create Project .env'
        WHEN 8 THEN 'Configure Compose Project Name'
        WHEN 9 THEN 'Generate Fresh Supabase Secrets'
        WHEN 10 THEN 'Configure API, DB and Pooler Ports'
        WHEN 11 THEN 'Configure Supabase Studio'
        WHEN 12 THEN 'Configure Supabase Public URLs'
        WHEN 13 THEN 'Keep DB and Pooler Private'
        WHEN 14 THEN 'Validate Docker Compose'
        WHEN 15 THEN 'Pull Supabase Images'
        WHEN 16 THEN 'Start Supabase'
        WHEN 17 THEN 'Test Supabase Locally'
        WHEN 18 THEN 'Get Dashboard Login'
        WHEN 19 THEN 'Clone Fresh Frontend Project'
        WHEN 20 THEN 'Create Frontend Nginx Config'
        WHEN 21 THEN 'Create Supabase Nginx Config'
        WHEN 22 THEN 'Test Nginx'
        WHEN 23 THEN 'Test HTTP Supabase Routing'
        WHEN 24 THEN 'Configure SSL'
        WHEN 25 THEN 'Recreate Supabase'
        WHEN 26 THEN 'Get Frontend Supabase Key'
        WHEN 27 THEN 'Configure Frontend Environment'
        WHEN 28 THEN 'Install Frontend Dependencies'
        WHEN 29 THEN 'Build Frontend'
        WHEN 30 THEN 'Final App Verification'
        WHEN 31 THEN 'Verify Project Containers'
        WHEN 32 THEN 'Verify Project Ports'
        WHEN 33 THEN 'Verify Existing Projects Are Unaffected'
      END,
      'not_started'
    FROM generate_series(1, 33) AS i;

    -- Seed commands for all 33 steps
    PERFORM seed_setup_step_commands(p.id);
  END LOOP;
END $$;