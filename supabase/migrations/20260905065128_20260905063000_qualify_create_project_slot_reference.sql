/*
# Fix ambiguous project slot references in create_project

1. Purpose
- Fixes the PostgreSQL error `column reference "project_slot" is ambiguous` raised when the Review Project flow creates a project.
- The existing function returns a column named `project_slot`. In PL/pgSQL, that return column is an output variable, so unqualified references to the database column with the same name are ambiguous.

2. Modified database object
- Replaces the existing `create_project` function with the same signature, return shape, defaults, security mode, and project-creation logic.
- Qualifies the `port_allocations.project_slot` references with the table alias `pa` in the available-slot lookup and the assignment update.

3. Behavior preservation
- Keeps automatic slug generation, port calculation, project insertion, port assignment, setup-step creation, and returned values unchanged.
- Does not alter any tables, columns, policies, existing project rows, or the application UI.

4. Security
- Preserves the existing `SECURITY DEFINER` setting.
- No RLS policies or permissions are changed.
*/

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