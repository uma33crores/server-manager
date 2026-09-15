/*
# Admin Authentication & Access Control System

1. Purpose
- Adds admin role and per-user server/project access control
- Replaces blanket "all authenticated users see everything" RLS with scoped policies
- Admins see and manage everything; normal users only see assigned servers/projects
- Public registration is disabled; only admins create users via edge function

2. Modified database objects
- NEW tables: user_roles, user_server_access, user_project_access
- NEW functions: is_admin(), has_server_access(), has_project_access(), get_user_role()
- MODIFIED: RLS policies on servers, projects, port_allocations, project_setup_steps,
  config_variables, commands, command_variables, credentials, notes
- NEW RLS on user_roles, user_server_access, user_project_access

3. Data migration
- Existing auth.users get 'admin' role (backward compatible)
- All existing servers/projects granted to existing users

4. Security
- RLS enforced on all tables
- Admin role bypasses server/project scoping
- Normal users can only see/modify assigned servers and their projects
- user_roles table: users can read their own role; only admins can modify
*/

-- ============================================================
-- 1. USER ROLES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_user_roles_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_user_roles_updated_at ON user_roles;
CREATE TRIGGER set_user_roles_updated_at
BEFORE UPDATE ON user_roles
FOR EACH ROW EXECUTE FUNCTION update_user_roles_updated_at();

-- ============================================================
-- 2. USER SERVER ACCESS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_server_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, server_id)
);

-- ============================================================
-- 3. USER PROJECT ACCESS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_project_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);

-- ============================================================
-- 4. HELPER FUNCTIONS (SECURITY DEFINER for auth.uid() access)
-- ============================================================

-- Check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT true FROM user_roles WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true),
    false
  );
$$;

-- Check if current user has access to a specific server
CREATE OR REPLACE FUNCTION has_server_access(p_server_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT true FROM user_roles WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true),
    false
  ) OR COALESCE(
    (SELECT true FROM user_server_access WHERE user_id = auth.uid() AND server_id = p_server_id),
    false
  );
$$;

-- Check if current user has access to a specific project
CREATE OR REPLACE FUNCTION has_project_access(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT true FROM user_roles WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true),
    false
  ) OR COALESCE(
    (SELECT true FROM user_project_access WHERE user_id = auth.uid() AND project_id = p_project_id),
    false
  ) OR COALESCE(
    (SELECT true FROM user_project_access upa
     JOIN projects p ON p.id = upa.project_id
     JOIN user_server_access usa ON usa.server_id = p.server_id
     WHERE upa.user_id = auth.uid() AND usa.user_id = auth.uid()),
    false
  );
$$;

-- Get current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT role FROM user_roles WHERE user_id = auth.uid() AND is_active = true),
    'none'
  );
$$;

-- Get server IDs the current user can access
CREATE OR REPLACE FUNCTION get_accessible_server_ids()
RETURNS TABLE(server_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id FROM servers
  WHERE is_admin()
  UNION
  SELECT server_id FROM user_server_access WHERE user_id = auth.uid()
$$;

-- Get project IDs the current user can access
CREATE OR REPLACE FUNCTION get_accessible_project_ids()
RETURNS TABLE(project_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id FROM projects WHERE is_admin()
  UNION
  SELECT project_id FROM user_project_access WHERE user_id = auth.uid()
  UNION
  SELECT p.id FROM projects p
  JOIN user_server_access usa ON usa.server_id = p.server_id
  WHERE usa.user_id = auth.uid()
$$;

-- ============================================================
-- 5. ENABLE RLS ON NEW TABLES
-- ============================================================
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_server_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_project_access ENABLE ROW LEVEL SECURITY;

-- user_roles: users can read their own role, admins can read all and manage all
DROP POLICY IF EXISTS "user_roles_select_own_or_admin" ON user_roles;
CREATE POLICY "user_roles_select_own_or_admin" ON user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "user_roles_admin_insert" ON user_roles;
CREATE POLICY "user_roles_admin_insert" ON user_roles
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "user_roles_admin_update" ON user_roles;
CREATE POLICY "user_roles_admin_update" ON user_roles
  FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "user_roles_admin_delete" ON user_roles;
CREATE POLICY "user_roles_admin_delete" ON user_roles
  FOR DELETE TO authenticated
  USING (is_admin());

-- user_server_access: users can read their own access, admins manage all
DROP POLICY IF EXISTS "usa_select_own_or_admin" ON user_server_access;
CREATE POLICY "usa_select_own_or_admin" ON user_server_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "usa_admin_insert" ON user_server_access;
CREATE POLICY "usa_admin_insert" ON user_server_access
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "usa_admin_update" ON user_server_access;
CREATE POLICY "usa_admin_update" ON user_server_access
  FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "usa_admin_delete" ON user_server_access;
CREATE POLICY "usa_admin_delete" ON user_server_access
  FOR DELETE TO authenticated
  USING (is_admin());

-- user_project_access: users can read their own access, admins manage all
DROP POLICY IF EXISTS "upa_select_own_or_admin" ON user_project_access;
CREATE POLICY "upa_select_own_or_admin" ON user_project_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "upa_admin_insert" ON user_project_access;
CREATE POLICY "upa_admin_insert" ON user_project_access
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "upa_admin_update" ON user_project_access;
CREATE POLICY "upa_admin_update" ON user_project_access
  FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "upa_admin_delete" ON user_project_access;
CREATE POLICY "upa_admin_delete" ON user_project_access
  FOR DELETE TO authenticated
  USING (is_admin());

-- ============================================================
-- 6. REPLACE RLS ON EXISTING TABLES (scoped by access)
-- ============================================================

-- SERVERS
DROP POLICY IF EXISTS "authed_select" ON servers;
DROP POLICY IF EXISTS "authed_insert" ON servers;
DROP POLICY IF EXISTS "authed_update" ON servers;
DROP POLICY IF EXISTS "authed_delete" ON servers;

CREATE POLICY "servers_scoped_select" ON servers
  FOR SELECT TO authenticated
  USING (has_server_access(id));

CREATE POLICY "servers_admin_insert" ON servers
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "servers_scoped_update" ON servers
  FOR UPDATE TO authenticated
  USING (has_server_access(id)) WITH CHECK (has_server_access(id));

CREATE POLICY "servers_scoped_delete" ON servers
  FOR DELETE TO authenticated
  USING (has_server_access(id));

-- PROJECTS
DROP POLICY IF EXISTS "authed_select" ON projects;
DROP POLICY IF EXISTS "authed_insert" ON projects;
DROP POLICY IF EXISTS "authed_update" ON projects;
DROP POLICY IF EXISTS "authed_delete" ON projects;

CREATE POLICY "projects_scoped_select" ON projects
  FOR SELECT TO authenticated
  USING (has_project_access(id));

CREATE POLICY "projects_admin_insert" ON projects
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "projects_scoped_update" ON projects
  FOR UPDATE TO authenticated
  USING (has_project_access(id)) WITH CHECK (has_project_access(id));

CREATE POLICY "projects_scoped_delete" ON projects
  FOR DELETE TO authenticated
  USING (has_project_access(id));

-- PORT_ALLOCATIONS
DROP POLICY IF EXISTS "authed_select" ON port_allocations;
DROP POLICY IF EXISTS "authed_insert" ON port_allocations;
DROP POLICY IF EXISTS "authed_update" ON port_allocations;
DROP POLICY IF EXISTS "authed_delete" ON port_allocations;

CREATE POLICY "ports_scoped_select" ON port_allocations
  FOR SELECT TO authenticated
  USING (has_server_access(server_id));

CREATE POLICY "ports_admin_insert" ON port_allocations
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "ports_scoped_update" ON port_allocations
  FOR UPDATE TO authenticated
  USING (has_server_access(server_id)) WITH CHECK (has_server_access(server_id));

CREATE POLICY "ports_scoped_delete" ON port_allocations
  FOR DELETE TO authenticated
  USING (has_server_access(server_id));

-- PROJECT_SETUP_STEPS
DROP POLICY IF EXISTS "authed_select" ON project_setup_steps;
DROP POLICY IF EXISTS "authed_insert" ON project_setup_steps;
DROP POLICY IF EXISTS "authed_update" ON project_setup_steps;
DROP POLICY IF EXISTS "authed_delete" ON project_setup_steps;

CREATE POLICY "steps_scoped_select" ON project_setup_steps
  FOR SELECT TO authenticated
  USING (has_project_access(project_id));

CREATE POLICY "steps_scoped_insert" ON project_setup_steps
  FOR INSERT TO authenticated
  WITH CHECK (has_project_access(project_id));

CREATE POLICY "steps_scoped_update" ON project_setup_steps
  FOR UPDATE TO authenticated
  USING (has_project_access(project_id)) WITH CHECK (has_project_access(project_id));

CREATE POLICY "steps_scoped_delete" ON project_setup_steps
  FOR DELETE TO authenticated
  USING (has_project_access(project_id));

-- CONFIG_VARIABLES
DROP POLICY IF EXISTS "authed_select" ON config_variables;
DROP POLICY IF EXISTS "authed_insert" ON config_variables;
DROP POLICY IF EXISTS "authed_update" ON config_variables;
DROP POLICY IF EXISTS "authed_delete" ON config_variables;

CREATE POLICY "config_scoped_select" ON config_variables
  FOR SELECT TO authenticated
  USING (
    scope = 'global' AND is_admin()
    OR scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)
    OR scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id)
  );

CREATE POLICY "config_scoped_insert" ON config_variables
  FOR INSERT TO authenticated
  WITH CHECK (
    scope = 'global' AND is_admin()
    OR scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)
    OR scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id)
  );

CREATE POLICY "config_scoped_update" ON config_variables
  FOR UPDATE TO authenticated
  USING (
    scope = 'global' AND is_admin()
    OR scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)
    OR scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id)
  ) WITH CHECK (
    scope = 'global' AND is_admin()
    OR scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)
    OR scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id)
  );

CREATE POLICY "config_scoped_delete" ON config_variables
  FOR DELETE TO authenticated
  USING (
    scope = 'global' AND is_admin()
    OR scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)
    OR scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id)
  );

-- COMMANDS
DROP POLICY IF EXISTS "authed_select" ON commands;
DROP POLICY IF EXISTS "authed_insert" ON commands;
DROP POLICY IF EXISTS "authed_update" ON commands;
DROP POLICY IF EXISTS "authed_delete" ON commands;

CREATE POLICY "commands_scoped_select" ON commands
  FOR SELECT TO authenticated
  USING (
    scope = 'global' OR
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  );

CREATE POLICY "commands_scoped_insert" ON commands
  FOR INSERT TO authenticated
  WITH CHECK (
    scope = 'global' AND is_admin() OR
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  );

CREATE POLICY "commands_scoped_update" ON commands
  FOR UPDATE TO authenticated
  USING (
    scope = 'global' AND is_admin() OR
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  ) WITH CHECK (
    scope = 'global' AND is_admin() OR
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  );

CREATE POLICY "commands_scoped_delete" ON commands
  FOR DELETE TO authenticated
  USING (
    scope = 'global' AND is_admin() OR
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  );

-- COMMAND_VARIABLES
DROP POLICY IF EXISTS "authed_select" ON command_variables;
DROP POLICY IF EXISTS "authed_insert" ON command_variables;
DROP POLICY IF EXISTS "authed_update" ON command_variables;
DROP POLICY IF EXISTS "authed_delete" ON command_variables;

CREATE POLICY "cmd_vars_scoped_select" ON command_variables
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM commands c
      WHERE c.id = command_id AND (
        c.scope = 'global' OR
        (c.scope = 'server' AND c.server_id IS NOT NULL AND has_server_access(c.server_id)) OR
        (c.scope = 'project' AND c.project_id IS NOT NULL AND has_project_access(c.project_id))
      )
    )
  );

CREATE POLICY "cmd_vars_scoped_insert" ON command_variables
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM commands c
      WHERE c.id = command_id AND (
        c.scope = 'global' AND is_admin() OR
        (c.scope = 'server' AND c.server_id IS NOT NULL AND has_server_access(c.server_id)) OR
        (c.scope = 'project' AND c.project_id IS NOT NULL AND has_project_access(c.project_id))
      )
    )
  );

CREATE POLICY "cmd_vars_scoped_update" ON command_variables
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM commands c
      WHERE c.id = command_id AND (
        c.scope = 'global' AND is_admin() OR
        (c.scope = 'server' AND c.server_id IS NOT NULL AND has_server_access(c.server_id)) OR
        (c.scope = 'project' AND c.project_id IS NOT NULL AND has_project_access(c.project_id))
      )
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM commands c
      WHERE c.id = command_id AND (
        c.scope = 'global' AND is_admin() OR
        (c.scope = 'server' AND c.server_id IS NOT NULL AND has_server_access(c.server_id)) OR
        (c.scope = 'project' AND c.project_id IS NOT NULL AND has_project_access(c.project_id))
      )
    )
  );

CREATE POLICY "cmd_vars_scoped_delete" ON command_variables
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM commands c
      WHERE c.id = command_id AND (
        c.scope = 'global' AND is_admin() OR
        (c.scope = 'server' AND c.server_id IS NOT NULL AND has_server_access(c.server_id)) OR
        (c.scope = 'project' AND c.project_id IS NOT NULL AND has_project_access(c.project_id))
      )
    )
  );

-- CREDENTIALS
DROP POLICY IF EXISTS "authed_select" ON credentials;
DROP POLICY IF EXISTS "authed_insert" ON credentials;
DROP POLICY IF EXISTS "authed_update" ON credentials;
DROP POLICY IF EXISTS "authed_delete" ON credentials;

CREATE POLICY "creds_scoped_select" ON credentials
  FOR SELECT TO authenticated
  USING (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  );

CREATE POLICY "creds_scoped_insert" ON credentials
  FOR INSERT TO authenticated
  WITH CHECK (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  );

CREATE POLICY "creds_scoped_update" ON credentials
  FOR UPDATE TO authenticated
  USING (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  ) WITH CHECK (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  );

CREATE POLICY "creds_scoped_delete" ON credentials
  FOR DELETE TO authenticated
  USING (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  );

-- NOTES
DROP POLICY IF EXISTS "authed_select" ON notes;
DROP POLICY IF EXISTS "authed_insert" ON notes;
DROP POLICY IF EXISTS "authed_update" ON notes;
DROP POLICY IF EXISTS "authed_delete" ON notes;

CREATE POLICY "notes_scoped_select" ON notes
  FOR SELECT TO authenticated
  USING (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  );

CREATE POLICY "notes_scoped_insert" ON notes
  FOR INSERT TO authenticated
  WITH CHECK (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  );

CREATE POLICY "notes_scoped_update" ON notes
  FOR UPDATE TO authenticated
  USING (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  ) WITH CHECK (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  );

CREATE POLICY "notes_scoped_delete" ON notes
  FOR DELETE TO authenticated
  USING (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id))
  );

-- SETUP_STEP_COMMANDS
ALTER TABLE setup_step_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authed_select" ON setup_step_commands;
DROP POLICY IF EXISTS "authed_insert" ON setup_step_commands;
DROP POLICY IF EXISTS "authed_update" ON setup_step_commands;
DROP POLICY IF EXISTS "authed_delete" ON setup_step_commands;

CREATE POLICY "ssc_scoped_select" ON setup_step_commands
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_setup_steps pss
      WHERE pss.id = setup_step_id AND has_project_access(pss.project_id)
    )
  );

CREATE POLICY "ssc_scoped_insert" ON setup_step_commands
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_setup_steps pss
      WHERE pss.id = setup_step_id AND has_project_access(pss.project_id)
    )
  );

CREATE POLICY "ssc_scoped_update" ON setup_step_commands
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_setup_steps pss
      WHERE pss.id = setup_step_id AND has_project_access(pss.project_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_setup_steps pss
      WHERE pss.id = setup_step_id AND has_project_access(pss.project_id)
    )
  );

CREATE POLICY "ssc_scoped_delete" ON setup_step_commands
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_setup_steps pss
      WHERE pss.id = setup_step_id AND has_project_access(pss.project_id)
    )
  );

-- ============================================================
-- 7. GRANT PERMISSIONS ON NEW TABLES
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_server_access TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_project_access TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON setup_step_commands TO authenticated;

-- ============================================================
-- 8. DATA MIGRATION: Make existing users admins
-- ============================================================
DO $$
DECLARE
  u RECORD;
BEGIN
  FOR u IN SELECT id FROM auth.users LOOP
    INSERT INTO user_roles (user_id, role, is_active)
    VALUES (u.id, 'admin', true)
    ON CONFLICT (user_id) DO NOTHING;

    -- Grant access to all existing servers
    INSERT INTO user_server_access (user_id, server_id)
    SELECT u.id, s.id FROM servers s
    ON CONFLICT (user_id, server_id) DO NOTHING;

    -- Grant access to all existing projects
    INSERT INTO user_project_access (user_id, project_id)
    SELECT u.id, p.id FROM projects p
    ON CONFLICT (user_id, project_id) DO NOTHING;
  END LOOP;
END $$;