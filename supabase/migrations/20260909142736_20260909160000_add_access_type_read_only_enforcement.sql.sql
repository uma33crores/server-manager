/*
# Add Access Type (Read Only / Write) to Users

## Overview
Adds an "Access Type" field to each user that controls whether they can only
view data (Read Only) or also modify it (Write). The restriction is enforced
at the database level via a trigger on every data table, so it cannot be
bypassed by the UI or by calling SECURITY DEFINER functions directly.

## Changes

### 1. New column on `user_roles`
- `access_type` (text, NOT NULL, default 'write', CHECK in ('read_only','write'))
  Stores the per-user access level. Existing users default to 'write'.

### 2. New SQL function `is_read_only()`
- SECURITY DEFINER, STABLE
- Returns true when the current authenticated user has access_type = 'read_only',
  is active, and is NOT an admin (admins always have write access).

### 3. New trigger function `enforce_not_read_only()`
- SECURITY DEFINER
- Raises exception 'READ_ONLY_ACCESS' if is_read_only() returns true.
- Attached as a BEFORE INSERT OR UPDATE OR DELETE statement-level trigger
  on every table that stores user-editable data:
    servers, projects, config_variables, credentials, commands,
    command_variables, notes, port_allocations, project_setup_steps,
    setup_step_commands

### 4. SECURITY
- The triggers fire after RLS policies pass but before the actual write,
  providing a second layer of defense that works even inside SECURITY
  DEFINER functions (auth.uid() is available in that context).
- Tables with admin-only write policies (user_roles, user_server_access,
  user_project_access) do not need triggers because read-only users are
  never admins, so is_admin() already blocks them.
- audit_logs, login_sessions, and admin_reauth_sessions already deny writes
  by default (no INSERT/UPDATE/DELETE policies or explicit false policies).
*/

-- Step 1: Add access_type column
ALTER TABLE user_roles
  ADD COLUMN IF NOT EXISTS access_type text NOT NULL DEFAULT 'write'
  CHECK (access_type IN ('read_only', 'write'));

-- Step 2: is_read_only() helper
CREATE OR REPLACE FUNCTION is_read_only() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT COALESCE(
    (SELECT access_type = 'read_only' AND role <> 'admin'
     FROM user_roles
     WHERE user_id = auth.uid() AND is_active = true),
    false
  );
$$;

-- Step 3: trigger function
CREATE OR REPLACE FUNCTION enforce_not_read_only() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF is_read_only() THEN
    RAISE EXCEPTION 'READ_ONLY_ACCESS';
  END IF;
  RETURN NULL;
END;
$$;

-- Step 4: attach triggers to all data tables
DROP TRIGGER IF EXISTS enforce_not_read_only ON servers;
CREATE TRIGGER enforce_not_read_only
  BEFORE INSERT OR UPDATE OR DELETE ON servers
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_not_read_only();

DROP TRIGGER IF EXISTS enforce_not_read_only ON projects;
CREATE TRIGGER enforce_not_read_only
  BEFORE INSERT OR UPDATE OR DELETE ON projects
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_not_read_only();

DROP TRIGGER IF EXISTS enforce_not_read_only ON config_variables;
CREATE TRIGGER enforce_not_read_only
  BEFORE INSERT OR UPDATE OR DELETE ON config_variables
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_not_read_only();

DROP TRIGGER IF EXISTS enforce_not_read_only ON credentials;
CREATE TRIGGER enforce_not_read_only
  BEFORE INSERT OR UPDATE OR DELETE ON credentials
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_not_read_only();

DROP TRIGGER IF EXISTS enforce_not_read_only ON commands;
CREATE TRIGGER enforce_not_read_only
  BEFORE INSERT OR UPDATE OR DELETE ON commands
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_not_read_only();

DROP TRIGGER IF EXISTS enforce_not_read_only ON command_variables;
CREATE TRIGGER enforce_not_read_only
  BEFORE INSERT OR UPDATE OR DELETE ON command_variables
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_not_read_only();

DROP TRIGGER IF EXISTS enforce_not_read_only ON notes;
CREATE TRIGGER enforce_not_read_only
  BEFORE INSERT OR UPDATE OR DELETE ON notes
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_not_read_only();

DROP TRIGGER IF EXISTS enforce_not_read_only ON port_allocations;
CREATE TRIGGER enforce_not_read_only
  BEFORE INSERT OR UPDATE OR DELETE ON port_allocations
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_not_read_only();

DROP TRIGGER IF EXISTS enforce_not_read_only ON project_setup_steps;
CREATE TRIGGER enforce_not_read_only
  BEFORE INSERT OR UPDATE OR DELETE ON project_setup_steps
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_not_read_only();

DROP TRIGGER IF EXISTS enforce_not_read_only ON setup_step_commands;
CREATE TRIGGER enforce_not_read_only
  BEFORE INSERT OR UPDATE OR DELETE ON setup_step_commands
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_not_read_only();
