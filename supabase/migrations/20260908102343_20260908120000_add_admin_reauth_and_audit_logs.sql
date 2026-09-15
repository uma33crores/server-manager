-- ============================================================
-- Admin Re-Verification & Audit Log System
-- ============================================================

-- 1. AUDIT LOGS TABLE (append-only)
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  admin_email text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  changes jsonb,
  ip_address text,
  user_agent text,
  request_id text,
  status text NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'FAILURE')),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_admin_select" ON audit_logs;
CREATE POLICY "audit_logs_admin_select" ON audit_logs
  FOR SELECT TO authenticated
  USING (is_admin());

CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_admin_id ON audit_logs (admin_id);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);
CREATE INDEX idx_audit_logs_entity_type ON audit_logs (entity_type);
CREATE INDEX idx_audit_logs_status ON audit_logs (status);

GRANT SELECT ON audit_logs TO authenticated;

-- 2. ADMIN REAUTH SESSIONS TABLE
CREATE TABLE IF NOT EXISTS admin_reauth_sessions (
  admin_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reauthenticated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_reauth_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reauth_select_own" ON admin_reauth_sessions;
CREATE POLICY "reauth_select_own" ON admin_reauth_sessions
  FOR SELECT TO authenticated
  USING (admin_id = auth.uid());

GRANT SELECT ON admin_reauth_sessions TO authenticated;

-- 3. CHECK IF ADMIN HAS VALID REAUTH (within 1 hour)
CREATE OR REPLACE FUNCTION check_admin_reauth()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_reauth_sessions
    WHERE admin_id = auth.uid()
    AND reauthenticated_at > now() - interval '1 hour'
  );
$$;

-- 4. RECORD ADMIN REAUTH (called by edge function after OTP verified)
CREATE OR REPLACE FUNCTION record_admin_reauth(p_admin_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO admin_reauth_sessions (admin_id, reauthenticated_at)
  VALUES (p_admin_id, now())
  ON CONFLICT (admin_id)
  DO UPDATE SET reauthenticated_at = now(), updated_at = now();
END;
$$;

-- 5. INTERNAL: WRITE AUDIT LOG
CREATE OR REPLACE FUNCTION write_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_changes jsonb,
  p_status text DEFAULT 'SUCCESS',
  p_failure_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_email text;
BEGIN
  SELECT email INTO v_admin_email FROM auth.users WHERE id = auth.uid();
  IF v_admin_email IS NULL THEN
    v_admin_email := 'unknown';
  END IF;

  INSERT INTO audit_logs (
    admin_id, admin_email, action, entity_type, entity_id,
    changes, status, failure_reason
  ) VALUES (
    auth.uid(), v_admin_email, p_action, p_entity_type, p_entity_id,
    p_changes, p_status, p_failure_reason
  );
END;
$$;

-- 6. PROTECTED: UPDATE SERVER
CREATE OR REPLACE FUNCTION admin_update_server(
  p_server_id uuid,
  p_updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb;
  v_field text;
  v_set_clause text := '';
  v_has_changes boolean := false;
BEGIN
  IF NOT is_admin() THEN
    PERFORM write_audit_log('SERVER_UPDATED', 'SERVER', p_server_id::text, NULL, 'FAILURE', 'Not admin');
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF NOT check_admin_reauth() THEN
    PERFORM write_audit_log('SERVER_UPDATED', 'SERVER', p_server_id::text, NULL, 'FAILURE', 'OTP_VERIFICATION_REQUIRED');
    RAISE EXCEPTION 'OTP_VERIFICATION_REQUIRED';
  END IF;

  SELECT to_jsonb(s) INTO v_old FROM servers s WHERE s.id = p_server_id;
  IF v_old IS NULL THEN
    PERFORM write_audit_log('SERVER_UPDATED', 'SERVER', p_server_id::text, NULL, 'FAILURE', 'Server not found');
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF p_updates ? 'name' THEN
    v_set_clause := v_set_clause || format('name = %L', p_updates->>'name');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'provider' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('provider = %L', p_updates->>'provider');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'public_ip' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('public_ip = %L', p_updates->>'public_ip');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'hostname' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('hostname = %L', p_updates->>'hostname');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'ssh_username' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('ssh_username = %L', p_updates->>'ssh_username');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'ssh_port' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('ssh_port = %L', p_updates->>'ssh_port');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'operating_system' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('operating_system = %L', p_updates->>'operating_system');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'region' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('region = %L', p_updates->>'region');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'ram' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('ram = %L', p_updates->>'ram');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'disk' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('disk = %L', p_updates->>'disk');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'supabase_template_directory' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('supabase_template_directory = %L', p_updates->>'supabase_template_directory');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'supabase_instances_directory' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('supabase_instances_directory = %L', p_updates->>'supabase_instances_directory');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'frontend_apps_directory' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('frontend_apps_directory = %L', p_updates->>'frontend_apps_directory');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'nginx_sites_available' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('nginx_sites_available = %L', p_updates->>'nginx_sites_available');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'nginx_sites_enabled' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('nginx_sites_enabled = %L', p_updates->>'nginx_sites_enabled');
    v_has_changes := true;
  END IF;
  IF p_updates ? 'notes' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('notes = %L', p_updates->>'notes');
    v_has_changes := true;
  END IF;

  IF NOT v_has_changes THEN
    RETURN jsonb_build_object('updated', false, 'message', 'No valid fields to update');
  END IF;

  EXECUTE format('UPDATE servers SET %s, updated_at = now() WHERE id = $1 RETURNING to_jsonb(servers)', v_set_clause)
    INTO v_new USING p_server_id;

  v_changes := '{}'::jsonb;
  IF p_updates ? 'name' THEN v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', v_old->'name', 'new', p_updates->'name')); END IF;
  IF p_updates ? 'provider' THEN v_changes := v_changes || jsonb_build_object('provider', jsonb_build_object('old', v_old->'provider', 'new', p_updates->'provider')); END IF;
  IF p_updates ? 'public_ip' THEN v_changes := v_changes || jsonb_build_object('public_ip', jsonb_build_object('old', v_old->'public_ip', 'new', p_updates->'public_ip')); END IF;
  IF p_updates ? 'hostname' THEN v_changes := v_changes || jsonb_build_object('hostname', jsonb_build_object('old', v_old->'hostname', 'new', p_updates->'hostname')); END IF;
  IF p_updates ? 'ssh_username' THEN v_changes := v_changes || jsonb_build_object('ssh_username', jsonb_build_object('old', v_old->'ssh_username', 'new', p_updates->'ssh_username')); END IF;
  IF p_updates ? 'ssh_port' THEN v_changes := v_changes || jsonb_build_object('ssh_port', jsonb_build_object('old', v_old->'ssh_port', 'new', p_updates->'ssh_port')); END IF;
  IF p_updates ? 'operating_system' THEN v_changes := v_changes || jsonb_build_object('operating_system', jsonb_build_object('old', v_old->'operating_system', 'new', p_updates->'operating_system')); END IF;
  IF p_updates ? 'region' THEN v_changes := v_changes || jsonb_build_object('region', jsonb_build_object('old', v_old->'region', 'new', p_updates->'region')); END IF;
  IF p_updates ? 'ram' THEN v_changes := v_changes || jsonb_build_object('ram', jsonb_build_object('old', v_old->'ram', 'new', p_updates->'ram')); END IF;
  IF p_updates ? 'disk' THEN v_changes := v_changes || jsonb_build_object('disk', jsonb_build_object('old', v_old->'disk', 'new', p_updates->'disk')); END IF;
  IF p_updates ? 'supabase_template_directory' THEN v_changes := v_changes || jsonb_build_object('supabase_template_directory', jsonb_build_object('old', v_old->'supabase_template_directory', 'new', p_updates->'supabase_template_directory')); END IF;
  IF p_updates ? 'supabase_instances_directory' THEN v_changes := v_changes || jsonb_build_object('supabase_instances_directory', jsonb_build_object('old', v_old->'supabase_instances_directory', 'new', p_updates->'supabase_instances_directory')); END IF;
  IF p_updates ? 'frontend_apps_directory' THEN v_changes := v_changes || jsonb_build_object('frontend_apps_directory', jsonb_build_object('old', v_old->'frontend_apps_directory', 'new', p_updates->'frontend_apps_directory')); END IF;
  IF p_updates ? 'nginx_sites_available' THEN v_changes := v_changes || jsonb_build_object('nginx_sites_available', jsonb_build_object('old', v_old->'nginx_sites_available', 'new', p_updates->'nginx_sites_available')); END IF;
  IF p_updates ? 'nginx_sites_enabled' THEN v_changes := v_changes || jsonb_build_object('nginx_sites_enabled', jsonb_build_object('old', v_old->'nginx_sites_enabled', 'new', p_updates->'nginx_sites_enabled')); END IF;
  IF p_updates ? 'notes' THEN v_changes := v_changes || jsonb_build_object('notes', jsonb_build_object('old', v_old->'notes', 'new', p_updates->'notes')); END IF;

  PERFORM write_audit_log('SERVER_UPDATED', 'SERVER', p_server_id::text, v_changes);

  RETURN jsonb_build_object('updated', true, 'record', v_new);
END;
$$;

-- 7. PROTECTED: UPDATE PROJECT
CREATE OR REPLACE FUNCTION admin_update_project(
  p_project_id uuid,
  p_updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb;
  v_set_clause text := '';
  v_has_changes boolean := false;
BEGIN
  IF NOT is_admin() THEN
    PERFORM write_audit_log('PROJECT_UPDATED', 'PROJECT', p_project_id::text, NULL, 'FAILURE', 'Not admin');
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF NOT check_admin_reauth() THEN
    PERFORM write_audit_log('PROJECT_UPDATED', 'PROJECT', p_project_id::text, NULL, 'FAILURE', 'OTP_VERIFICATION_REQUIRED');
    RAISE EXCEPTION 'OTP_VERIFICATION_REQUIRED';
  END IF;

  SELECT to_jsonb(p) INTO v_old FROM projects p WHERE p.id = p_project_id;
  IF v_old IS NULL THEN
    PERFORM write_audit_log('PROJECT_UPDATED', 'PROJECT', p_project_id::text, NULL, 'FAILURE', 'Project not found');
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF p_updates ? 'name' THEN
    v_set_clause := format('name = %L', p_updates->>'name'); v_has_changes := true;
  END IF;
  IF p_updates ? 'app_domain' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('app_domain = %L', p_updates->>'app_domain'); v_has_changes := true;
  END IF;
  IF p_updates ? 'supabase_domain' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('supabase_domain = %L', p_updates->>'supabase_domain'); v_has_changes := true;
  END IF;
  IF p_updates ? 'repository_url' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('repository_url = %L', p_updates->>'repository_url'); v_has_changes := true;
  END IF;
  IF p_updates ? 'git_branch' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('git_branch = %L', p_updates->>'git_branch'); v_has_changes := true;
  END IF;
  IF p_updates ? 'status' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('status = %L', p_updates->>'status'); v_has_changes := true;
  END IF;
  IF p_updates ? 'notes' THEN
    v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END || format('notes = %L', p_updates->>'notes'); v_has_changes := true;
  END IF;

  IF NOT v_has_changes THEN
    RETURN jsonb_build_object('updated', false, 'message', 'No valid fields to update');
  END IF;

  EXECUTE format('UPDATE projects SET %s, updated_at = now() WHERE id = $1 RETURNING to_jsonb(projects)', v_set_clause)
    INTO v_new USING p_project_id;

  v_changes := '{}'::jsonb;
  IF p_updates ? 'name' THEN v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', v_old->'name', 'new', p_updates->'name')); END IF;
  IF p_updates ? 'app_domain' THEN v_changes := v_changes || jsonb_build_object('app_domain', jsonb_build_object('old', v_old->'app_domain', 'new', p_updates->'app_domain')); END IF;
  IF p_updates ? 'supabase_domain' THEN v_changes := v_changes || jsonb_build_object('supabase_domain', jsonb_build_object('old', v_old->'supabase_domain', 'new', p_updates->'supabase_domain')); END IF;
  IF p_updates ? 'repository_url' THEN v_changes := v_changes || jsonb_build_object('repository_url', jsonb_build_object('old', v_old->'repository_url', 'new', p_updates->'repository_url')); END IF;
  IF p_updates ? 'git_branch' THEN v_changes := v_changes || jsonb_build_object('git_branch', jsonb_build_object('old', v_old->'git_branch', 'new', p_updates->'git_branch')); END IF;
  IF p_updates ? 'status' THEN v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('old', v_old->'status', 'new', p_updates->'status')); END IF;
  IF p_updates ? 'notes' THEN v_changes := v_changes || jsonb_build_object('notes', jsonb_build_object('old', v_old->'notes', 'new', p_updates->'notes')); END IF;

  PERFORM write_audit_log('PROJECT_UPDATED', 'PROJECT', p_project_id::text, v_changes);

  RETURN jsonb_build_object('updated', true, 'record', v_new);
END;
$$;

-- 8. PROTECTED: DELETE SERVER
CREATE OR REPLACE FUNCTION admin_delete_server(p_server_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old jsonb;
BEGIN
  IF NOT is_admin() THEN
    PERFORM write_audit_log('SERVER_DELETED', 'SERVER', p_server_id::text, NULL, 'FAILURE', 'Not admin');
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF NOT check_admin_reauth() THEN
    PERFORM write_audit_log('SERVER_DELETED', 'SERVER', p_server_id::text, NULL, 'FAILURE', 'OTP_VERIFICATION_REQUIRED');
    RAISE EXCEPTION 'OTP_VERIFICATION_REQUIRED';
  END IF;

  SELECT to_jsonb(s) INTO v_old FROM servers s WHERE s.id = p_server_id;
  IF v_old IS NULL THEN
    PERFORM write_audit_log('SERVER_DELETED', 'SERVER', p_server_id::text, NULL, 'FAILURE', 'Server not found');
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  DELETE FROM servers WHERE id = p_server_id;
  PERFORM write_audit_log('SERVER_DELETED', 'SERVER', p_server_id::text, jsonb_build_object('old', v_old));
  RETURN jsonb_build_object('deleted', true);
END;
$$;

-- 9. PROTECTED: DELETE PROJECT
CREATE OR REPLACE FUNCTION admin_delete_project(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old jsonb;
BEGIN
  IF NOT is_admin() THEN
    PERFORM write_audit_log('PROJECT_DELETED', 'PROJECT', p_project_id::text, NULL, 'FAILURE', 'Not admin');
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF NOT check_admin_reauth() THEN
    PERFORM write_audit_log('PROJECT_DELETED', 'PROJECT', p_project_id::text, NULL, 'FAILURE', 'OTP_VERIFICATION_REQUIRED');
    RAISE EXCEPTION 'OTP_VERIFICATION_REQUIRED';
  END IF;

  SELECT to_jsonb(p) INTO v_old FROM projects p WHERE p.id = p_project_id;
  IF v_old IS NULL THEN
    PERFORM write_audit_log('PROJECT_DELETED', 'PROJECT', p_project_id::text, NULL, 'FAILURE', 'Project not found');
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  DELETE FROM projects WHERE id = p_project_id;
  PERFORM write_audit_log('PROJECT_DELETED', 'PROJECT', p_project_id::text, jsonb_build_object('old', v_old));
  RETURN jsonb_build_object('deleted', true);
END;
$$;

-- 10. Lock down direct UPDATE/DELETE on servers and projects to admin-only
DROP POLICY IF EXISTS "servers_scoped_update" ON servers;
CREATE POLICY "servers_admin_update" ON servers
  FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "servers_scoped_delete" ON servers;
CREATE POLICY "servers_admin_delete" ON servers
  FOR DELETE TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS "projects_scoped_update" ON projects;
CREATE POLICY "projects_admin_update" ON projects
  FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "projects_scoped_delete" ON projects;
CREATE POLICY "projects_admin_delete" ON projects
  FOR DELETE TO authenticated
  USING (is_admin());
