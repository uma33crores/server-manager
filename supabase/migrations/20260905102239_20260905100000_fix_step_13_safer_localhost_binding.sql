/*
# Fix Step 13: Safer localhost binding commands

1. Purpose
- Replace Step 13 commands with safer versions that never use `exit 1` or close the SSH session.
- Use `grep -Fq --` for patterns beginning with `-`.
- Detect if a mapping is already bound to 127.0.0.1.
- Support both common Supabase API gateway mapping formats.
- Print warnings instead of exiting.
- Add a "Validate Docker Compose After Changes" sub-step.
- Keep commands directly copy-pasteable into Bash.

2. Modified database objects
- `seed_setup_step_commands` — updated Step 13 command templates only.

3. Data migration
- Deletes and re-seeds Step 13 commands for all existing projects.

4. Security
- No RLS or permission changes.
*/

-- ============================================================
-- Updated seed_setup_step_commands (only Step 13 changed)
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
        -- Step 0: Initialize Variables
        (0, 1, 'Initialize All Variables', E'PROJECT_NAME="{{PROJECT_NAME}}"\nPROJECT_SLUG="{{PROJECT_SLUG}}"\nAPP_DOMAIN="{{APP_DOMAIN}}"\nSUPABASE_DOMAIN="{{SUPABASE_DOMAIN}}"\n\nAPI_PORT="{{API_PORT}}"\nDB_PORT="{{DB_PORT}}"\nPOOLER_PORT="{{POOLER_PORT}}"\n\nGIT_REPO="{{REPOSITORY_URL}}"\nGIT_BRANCH="{{GIT_BRANCH}}"\n\nAPP_DIR="/var/www/${PROJECT_SLUG}"\nSUPABASE_DIR="/opt/supabase-instances/${PROJECT_SLUG}"', false),

        -- Step 1: Check Server Resources
        (1, 1, 'Disk / Memory / Swap / Docker / Load', E'echo "========== DISK =========="\ndf -h /\n\necho\necho "========== MEMORY =========="\nfree -h\n\necho\necho "========== SWAP =========="\nswapon --show\n\necho\necho "========== DOCKER =========="\ndocker system df\n\necho\necho "========== RUNNING CONTAINERS =========="\ndocker ps\n\necho\necho "========== LOAD =========="\nuptime\n\ndocker stats --no-stream', false),

        -- Step 2: Check Assigned Ports
        (2, 1, 'Port Status Check', E'for PORT in "$API_PORT" "$DB_PORT" "$POOLER_PORT"; do\n    if sudo ss -lnt | grep -q ":${PORT} "; then\n        echo "PORT ${PORT}: IN USE"\n    else\n        echo "PORT ${PORT}: FREE"\n    fi\ndone', false),
        (2, 2, 'lsof API', E'sudo lsof -i :"$API_PORT"', false),
        (2, 3, 'lsof DB', E'sudo lsof -i :"$DB_PORT"', false),
        (2, 4, 'lsof Pooler', E'sudo lsof -i :"$POOLER_PORT"', false),

        -- Step 3: Verify DNS
        (3, 1, 'dig App Domain', E'dig +short "$APP_DOMAIN"', false),
        (3, 2, 'dig Supabase Domain', E'dig +short "$SUPABASE_DOMAIN"', false),
        (3, 3, 'nslookup App', E'nslookup "$APP_DOMAIN"', false),
        (3, 4, 'nslookup Supabase', E'nslookup "$SUPABASE_DOMAIN"', false),

        -- Step 4: Check Project Does Not Already Exist
        (4, 1, 'Check Directories', E'if [ -e "$SUPABASE_DIR" ]; then\n    echo "ERROR: Supabase directory already exists: $SUPABASE_DIR"\n    exit 1\nfi\n\nif [ -e "$APP_DIR" ]; then\n    echo "ERROR: App directory already exists: $APP_DIR"\n    exit 1\nfi', false),

        -- Step 5: Create Supabase Instance
        (5, 1, 'Create and Copy', E'sudo mkdir -p "$SUPABASE_DIR"\n\nsudo cp -rf \\\n/opt/supabase-template/multi-project/. \\\n"$SUPABASE_DIR/"\n\nsudo chown -R "$USER":"$USER" "$SUPABASE_DIR"\n\ncd "$SUPABASE_DIR"', false),
        (5, 2, 'Verify', E'cd "$SUPABASE_DIR"\npwd\nls -la', false),

        -- Step 6: Verify Multi-Project Template
        (6, 1, 'Check container_name', E'cd "$SUPABASE_DIR"\nif grep -q ''^[[:space:]]*container_name:'' docker-compose.yml; then\n    echo "ERROR: Fixed container_name entries found."\n    exit 1\nelse\n    echo "Multi-project template OK"\nfi', false),

        -- Step 7: Create Project .env
        (7, 1, 'Copy .env.example', E'cd "$SUPABASE_DIR"\ncp .env.example .env\nls -la .env', false),

        -- Step 8: Configure Compose Project Name
        (8, 1, 'Set COMPOSE_PROJECT_NAME', E'cd "$SUPABASE_DIR"\nif grep -q ''^COMPOSE_PROJECT_NAME='' .env; then\n    sed -i \\\n    "s/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=${PROJECT_SLUG}/" \\\n    .env\nelse\n    echo "COMPOSE_PROJECT_NAME=${PROJECT_SLUG}" >> .env\nfi', false),
        (8, 2, 'Verify', E'cd "$SUPABASE_DIR"\ngrep ''^COMPOSE_PROJECT_NAME='' .env', false),

        -- Step 9: Generate Fresh Supabase Secrets
        (9, 1, 'Generate Keys', E'cd "$SUPABASE_DIR"\nsh utils/generate-keys.sh', false),
        (9, 2, 'Add Auth Keys', E'cd "$SUPABASE_DIR"\nsh utils/add-new-auth-keys.sh', false),
        (9, 3, 'Verify Secrets (hidden)', E'cd "$SUPABASE_DIR"\ngrep -E \\\n''^(POSTGRES_PASSWORD|JWT_SECRET|SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY|DASHBOARD_PASSWORD)='' \\\n.env | sed ''s/=.*/=[HIDDEN]/''', false),

        -- Step 10: Configure API, DB and Pooler Ports
        (10, 1, 'Set Ports', E'cd "$SUPABASE_DIR"\nsed -i \\\n"s/^API_GW_HTTP_PORT=.*/API_GW_HTTP_PORT=${API_PORT}/" \\\n.env\n\nsed -i \\\n"s/^POSTGRES_PORT=.*/POSTGRES_PORT=${DB_PORT}/" \\\n.env\n\nsed -i \\\n"s/^POOLER_PROXY_PORT_TRANSACTION=.*/POOLER_PROXY_PORT_TRANSACTION=${POOLER_PORT}/" \\\n.env\n\nsed -i \\\n"s/^POOLER_TENANT_ID=.*/POOLER_TENANT_ID=${PROJECT_SLUG}/" \\\n.env', false),
        (10, 2, 'Verify Ports', E'cd "$SUPABASE_DIR"\ngrep -E \\\n''^(API_GW_HTTP_PORT|POSTGRES_PORT|POOLER_PROXY_PORT_TRANSACTION|POOLER_TENANT_ID|COMPOSE_PROJECT_NAME)='' \\\n.env', false),

        -- Step 11: Configure Supabase Studio
        (11, 1, 'Set Studio Project/Org', E'cd "$SUPABASE_DIR"\nsed -i \\\n"s/^STUDIO_DEFAULT_PROJECT=.*/STUDIO_DEFAULT_PROJECT=${PROJECT_NAME}/" \\\n.env\n\nsed -i \\\n"s/^STUDIO_DEFAULT_ORGANIZATION=.*/STUDIO_DEFAULT_ORGANIZATION=${PROJECT_NAME}/" \\\n.env', false),
        (11, 2, 'Verify Studio', E'cd "$SUPABASE_DIR"\ngrep -E \\\n''^(STUDIO_DEFAULT_PROJECT|STUDIO_DEFAULT_ORGANIZATION)='' \\\n.env', false),

        -- Step 12: Configure Supabase Public URLs (HTTP - before SSL)
        (12, 1, 'Set HTTP URLs', E'cd "$SUPABASE_DIR"\nsed -i \\\n"s|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=http://${SUPABASE_DOMAIN}|" \\\n.env\n\nsed -i \\\n"s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=http://${SUPABASE_DOMAIN}/auth/v1|" \\\n.env\n\nsed -i \\\n"s|^SITE_URL=.*|SITE_URL=http://${APP_DOMAIN}|" \\\n.env', false),
        (12, 2, 'Verify URLs', E'cd "$SUPABASE_DIR"\ngrep -E \\\n''^(SUPABASE_PUBLIC_URL|API_EXTERNAL_URL|SITE_URL)='' \\\n.env', false),

        -- Step 13: Keep DB, Pooler and API Private on Localhost (SAFER VERSION - no exit 1)
        (13, 1, 'Bind DB to 127.0.0.1', E'cd "$SUPABASE_DIR"\n\nif grep -Fq -- ''"127.0.0.1:${POSTGRES_PORT}:5432"'' docker-compose.yml; then\n    echo "DB port is already bound to 127.0.0.1"\n\nelif grep -Fq -- ''- ${POSTGRES_PORT}:5432'' docker-compose.yml; then\n    sed -i \\\n    ''s|- ${POSTGRES_PORT}:5432|- "127.0.0.1:${POSTGRES_PORT}:5432"|'' \\\n    docker-compose.yml\n\n    echo "DB port bound to 127.0.0.1"\n\nelse\n    echo "WARNING: Could not find DB port mapping in docker-compose.yml"\n    echo "No DB changes were made."\nfi', false),
        (13, 2, 'Bind Pooler to 127.0.0.1', E'cd "$SUPABASE_DIR"\n\nif grep -Fq -- ''"127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION}:6543"'' docker-compose.yml; then\n    echo "Pooler port is already bound to 127.0.0.1"\n\nelif grep -Fq -- ''- ${POOLER_PROXY_PORT_TRANSACTION}:6543'' docker-compose.yml; then\n    sed -i \\\n    ''s|- ${POOLER_PROXY_PORT_TRANSACTION}:6543|- "127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION}:6543"|'' \\\n    docker-compose.yml\n\n    echo "Pooler port bound to 127.0.0.1"\n\nelse\n    echo "WARNING: Could not find Pooler port mapping in docker-compose.yml"\n    echo "No Pooler changes were made."\nfi', false),
        (13, 3, 'Bind API Gateway to 127.0.0.1', E'cd "$SUPABASE_DIR"\n\nif grep -Fq -- ''"127.0.0.1:${API_GW_HTTP_PORT}:8000"'' docker-compose.yml; then\n    echo "API gateway is already bound to 127.0.0.1"\n\nelif grep -Fq -- ''"127.0.0.1:${API_GW_HTTP_PORT:-${KONG_HTTP_PORT:-8000}}:8000/tcp"'' docker-compose.yml; then\n    echo "API gateway is already bound to 127.0.0.1"\n\nelif grep -Fq -- ''- ${API_GW_HTTP_PORT}:8000'' docker-compose.yml; then\n    sed -i \\\n    ''s|- ${API_GW_HTTP_PORT}:8000|- "127.0.0.1:${API_GW_HTTP_PORT}:8000"|'' \\\n    docker-compose.yml\n\n    echo "API gateway port bound to 127.0.0.1"\n\nelif grep -Fq -- ''- ${API_GW_HTTP_PORT:-${KONG_HTTP_PORT:-8000}}:8000/tcp'' docker-compose.yml; then\n    sed -i \\\n    ''s|- ${API_GW_HTTP_PORT:-${KONG_HTTP_PORT:-8000}}:8000/tcp|- "127.0.0.1:${API_GW_HTTP_PORT:-${KONG_HTTP_PORT:-8000}}:8000/tcp"|'' \\\n    docker-compose.yml\n\n    echo "API gateway port bound to 127.0.0.1"\n\nelse\n    echo "WARNING: Could not find API gateway HTTP mapping."\n    echo "The mapping may use a different format or may already be private."\n    echo "No API gateway changes were made."\nfi', false),
        (13, 4, 'Verify All Bindings', E'cd "$SUPABASE_DIR"\n\necho "========== LOCALHOST BINDINGS =========="\ngrep -n ''127.0.0.1'' docker-compose.yml\n\necho\necho "========== RELEVANT PORT MAPPINGS =========="\ngrep -nF -- ''${POSTGRES_PORT}'' docker-compose.yml\ngrep -nF -- ''${POOLER_PROXY_PORT_TRANSACTION}'' docker-compose.yml\ngrep -n ''8000/tcp\|API_GW_HTTP_PORT'' docker-compose.yml', false),
        (13, 5, 'Validate Docker Compose After Changes', E'cd "$SUPABASE_DIR"\n\ndocker compose config --quiet\n\nif [ $? -eq 0 ]; then\n    echo "Docker Compose configuration is valid"\nelse\n    echo "WARNING: Docker Compose configuration has an error"\nfi', false),

        -- Step 14: Validate Docker Compose
        (14, 1, 'Validate Config', E'cd "$SUPABASE_DIR"\ndocker compose config --quiet', false),
        (14, 2, 'Verify Project Name', E'cd "$SUPABASE_DIR"\ndocker compose config --project-name', false),

        -- Step 15: Pull Supabase Images
        (15, 1, 'Pull', E'cd "$SUPABASE_DIR"\ndocker compose pull', false),

        -- Step 16: Start Supabase
        (16, 1, 'Start', E'cd "$SUPABASE_DIR"\nsh run.sh start', false),
        (16, 2, 'Check Containers', E'cd "$SUPABASE_DIR"\ndocker compose ps', false),
        (16, 3, 'Project Containers', E'docker ps \\\n--filter "label=com.docker.compose.project=${PROJECT_SLUG}"', false),
        (16, 4, 'Logs', E'cd "$SUPABASE_DIR"\ndocker compose logs --tail=100', false),

        -- Step 17: Test Supabase Locally
        (17, 1, 'curl Auth', E'curl -I \\\n"http://127.0.0.1:${API_PORT}/auth/v1/"', false),

        -- Step 18: Get Dashboard Login
        (18, 1, 'Dashboard Credentials', E'grep -E \\\n''^(DASHBOARD_USERNAME|DASHBOARD_PASSWORD)='' \\\n"$SUPABASE_DIR/.env"', true),

        -- Step 19: Clone Fresh Frontend Project
        (19, 1, 'Create App Dir', E'sudo mkdir -p "$APP_DIR"\nsudo chown -R "$USER":"$USER" "$APP_DIR"', false),
        (19, 2, 'Clone', E'git clone \\\n--branch "$GIT_BRANCH" \\\n--single-branch \\\n"$GIT_REPO" \\\n"$APP_DIR"', false),
        (19, 3, 'Verify', E'cd "$APP_DIR"\ngit branch --show-current\ngit status', false),

        -- Step 20: Create Frontend Nginx Config (using sudo tee with heredoc)
        (20, 1, 'Create Config', E'cd "$SUPABASE_DIR"\nsudo tee "/etc/nginx/sites-available/${PROJECT_SLUG}" > /dev/null <<NGINX\nserver {\n    listen 80;\n    listen [::]:80;\n\n    server_name ${APP_DOMAIN};\n\n    root ${APP_DIR}/dist;\n    index index.html;\n\n    location / {\n        try_files \\$uri \\$uri/ /index.html;\n    }\n}\nNGINX', false),
        (20, 2, 'Enable Site', E'sudo ln -sfn \\\n"/etc/nginx/sites-available/${PROJECT_SLUG}" \\\n"/etc/nginx/sites-enabled/${PROJECT_SLUG}"', false),

        -- Step 21: Create Supabase Nginx Config (using sudo tee with heredoc)
        (21, 1, 'Create Config', E'cd "$SUPABASE_DIR"\nsudo tee "/etc/nginx/sites-available/supabase-${PROJECT_SLUG}" > /dev/null <<NGINX\nserver {\n    listen 80;\n    listen [::]:80;\n\n    server_name ${SUPABASE_DOMAIN};\n\n    client_max_body_size 100M;\n\n    location /realtime/v1/ {\n        proxy_pass http://127.0.0.1:${API_PORT};\n\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade \\$http_upgrade;\n        proxy_set_header Connection "upgrade";\n\n        proxy_set_header Host \\$host;\n        proxy_set_header X-Real-IP \\$remote_addr;\n        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto \\$scheme;\n\n        proxy_read_timeout 3600;\n    }\n\n    location / {\n        proxy_pass http://127.0.0.1:${API_PORT};\n\n        proxy_http_version 1.1;\n\n        proxy_set_header Host \\$host;\n        proxy_set_header X-Real-IP \\$remote_addr;\n        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto \\$scheme;\n    }\n}\nNGINX', false),
        (21, 2, 'Enable Site', E'sudo ln -sfn \\\n"/etc/nginx/sites-available/supabase-${PROJECT_SLUG}" \\\n"/etc/nginx/sites-enabled/supabase-${PROJECT_SLUG}"', false),

        -- Step 22: Test Nginx
        (22, 1, 'Test Config', 'sudo nginx -t', false),
        (22, 2, 'Reload', 'sudo systemctl reload nginx', false),
        (22, 3, 'Status', 'sudo systemctl is-active nginx', false),

        -- Step 23: Test HTTP Supabase Routing
        (23, 1, 'curl Supabase HTTP', E'curl -I \\\n"http://${SUPABASE_DOMAIN}/auth/v1/"', false),

        -- Step 24: Configure SSL
        (24, 1, 'Frontend Cert', E'sudo certbot --nginx -d "$APP_DOMAIN"', false),
        (24, 2, 'Supabase Cert', E'sudo certbot --nginx -d "$SUPABASE_DOMAIN"', false),
        (24, 3, 'Verify Certs', 'sudo certbot certificates', false),
        (24, 4, 'Reload Nginx', E'sudo nginx -t\nsudo systemctl reload nginx', false),

        -- Step 25: Recreate Supabase with HTTPS URLs
        (25, 1, 'Set HTTPS URLs', E'cd "$SUPABASE_DIR"\n\nsed -i \\\n"s|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=https://${SUPABASE_DOMAIN}|" \\\n.env\n\nsed -i \\\n"s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=https://${SUPABASE_DOMAIN}/auth/v1|" \\\n.env\n\nsed -i \\\n"s|^SITE_URL=.*|SITE_URL=https://${APP_DOMAIN}|" \\\n.env', false),
        (25, 2, 'Recreate', E'cd "$SUPABASE_DIR"\nsh run.sh recreate', false),
        (25, 3, 'Verify', E'cd "$SUPABASE_DIR"\ndocker compose ps', false),

        -- Step 26: Get Frontend Supabase Key
        (26, 1, 'Extract Publishable Key', E'PROJECT_PUBLISHABLE_KEY="$(grep ''^SUPABASE_PUBLISHABLE_KEY='' "$SUPABASE_DIR/.env" | cut -d= -f2-)"', false),
        (26, 2, 'Verify Key Exists', E'if [ -z "$PROJECT_PUBLISHABLE_KEY" ]; then\n    echo "ERROR: SUPABASE_PUBLISHABLE_KEY not found"\n    exit 1\nelse\n    echo "Supabase publishable key found"\nfi', false),

        -- Step 27: Configure Frontend Environment
        (27, 1, 'Create .env', E'cd "$APP_DIR"\n\ncat > .env <<EOF\nVITE_SUPABASE_URL=https://${SUPABASE_DOMAIN}\nVITE_SUPABASE_ANON_KEY=${PROJECT_PUBLISHABLE_KEY}\nEOF', false),
        (27, 2, 'Protect .env', E'cd "$APP_DIR"\ngrep -q ''^\\.env$'' .gitignore || echo ''.env'' >> .gitignore', false),

        -- Step 28: Install Frontend Dependencies
        (28, 1, 'npm install', E'cd "$APP_DIR"\nnpm install', false),

        -- Step 29: Build Frontend
        (29, 1, 'Build', E'cd "$APP_DIR"\nnpm run build', false),
        (29, 2, 'Verify Build', E'cd "$APP_DIR"\nls -lah dist', false),
        (29, 3, 'Reload Nginx', 'sudo systemctl reload nginx', false),

        -- Step 30: Final App Verification
        (30, 1, 'curl Frontend', E'curl -I "https://${APP_DOMAIN}"', false),
        (30, 2, 'curl Supabase', E'curl -I \\\n"https://${SUPABASE_DOMAIN}/auth/v1/"', false),
        (30, 3, 'Supabase Status', E'cd "$SUPABASE_DIR"\ndocker compose ps', false),
        (30, 4, 'Project Containers', E'docker ps \\\n--filter "label=com.docker.compose.project=${PROJECT_SLUG}"', false),
        (30, 5, 'Nginx Test', 'sudo nginx -t', false),

        -- Step 31: Verify Project Containers
        (31, 1, 'Compose ps', E'cd "$SUPABASE_DIR"\ndocker compose ps', false),
        (31, 2, 'Project Containers', E'docker ps \\\n--filter "label=com.docker.compose.project=${PROJECT_SLUG}"', false),

        -- Step 32: Verify Project Ports
        (32, 1, 'Port Check', E'for PORT in "$API_PORT" "$DB_PORT" "$POOLER_PORT"; do\n    echo "===== PORT ${PORT} ====="\n    sudo ss -lntp | grep ":${PORT} "\ndone', false),

        -- Step 33: Verify Existing Projects Are Unaffected
        (33, 1, 'All Containers', 'docker ps --format ''table {{.Names}}\t{{.Status}}\t{{.Ports}}''', false),
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
-- Re-seed Step 13 commands for all existing projects
-- ============================================================
DO $$
DECLARE
  p RECORD;
  v_step_id uuid;
BEGIN
  FOR p IN SELECT id FROM projects LOOP
    SELECT id INTO v_step_id FROM project_setup_steps
    WHERE project_id = p.id AND step_number = 13;

    IF v_step_id IS NOT NULL THEN
      DELETE FROM setup_step_commands WHERE setup_step_id = v_step_id;
    END IF;
  END LOOP;

  FOR p IN SELECT id FROM projects LOOP
    PERFORM seed_setup_step_commands(p.id);
  END LOOP;
END $$;