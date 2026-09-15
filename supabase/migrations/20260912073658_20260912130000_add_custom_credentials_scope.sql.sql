/*
# Add 'custom' scope to credentials table

1. Modified Tables
   - `credentials`
     - ALTER scope CHECK constraint to allow 'custom' in addition to 'server' and 'project'.
     - Custom credentials are standalone — not tied to any server or project.
     - server_id and project_id remain nullable (both NULL for custom credentials).

2. Security (RLS)
   - Drop and recreate all 4 credential policies to include the 'custom' scope.
   - Custom credentials are visible to all authenticated users (they are shared secrets).
   - Only admins can INSERT, UPDATE, and DELETE custom credentials (is_admin() check).
   - Server and project scoped credentials keep their existing has_server_access/has_project_access checks.

3. Important Notes
   - Existing server and project credentials are unaffected.
   - Custom credentials appear in the Secret Credentials "Overall" tab alongside server/project credentials.
   - The "Customised" tab only shows custom-scoped credentials.
   - Deleting any credential from the Secret Credentials page requires OTP verification (enforced in the frontend).
*/

-- Allow 'custom' as a valid scope
ALTER TABLE credentials DROP CONSTRAINT IF EXISTS credentials_scope_check;
ALTER TABLE credentials ADD CONSTRAINT credentials_scope_check CHECK (scope IN ('server', 'project', 'custom'));

-- Drop existing policies
DROP POLICY IF EXISTS "creds_scoped_select" ON credentials;
DROP POLICY IF EXISTS "creds_scoped_insert" ON credentials;
DROP POLICY IF EXISTS "creds_scoped_update" ON credentials;
DROP POLICY IF EXISTS "creds_scoped_delete" ON credentials;

-- Recreate with custom scope support
CREATE POLICY "creds_scoped_select" ON credentials
  FOR SELECT TO authenticated
  USING (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id)) OR
    (scope = 'custom')
  );

CREATE POLICY "creds_scoped_insert" ON credentials
  FOR INSERT TO authenticated
  WITH CHECK (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id)) OR
    (scope = 'custom' AND is_admin())
  );

CREATE POLICY "creds_scoped_update" ON credentials
  FOR UPDATE TO authenticated
  USING (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id)) OR
    (scope = 'custom' AND is_admin())
  ) WITH CHECK (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id)) OR
    (scope = 'custom' AND is_admin())
  );

CREATE POLICY "creds_scoped_delete" ON credentials
  FOR DELETE TO authenticated
  USING (
    (scope = 'server' AND server_id IS NOT NULL AND has_server_access(server_id)) OR
    (scope = 'project' AND project_id IS NOT NULL AND has_project_access(project_id)) OR
    (scope = 'custom' AND is_admin())
  );
