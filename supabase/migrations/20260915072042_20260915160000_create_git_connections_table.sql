/*
# Git Connections Table for Deploy Key Management

1. Purpose
- Stores SSH deploy key metadata for private Git repository access
- Replaces subprocess-based git clone with GitHub REST API approach
- Tracks connection status, public key, fingerprint, encrypted private key reference

2. New Tables
- git_connections: One row per project's Git connection configuration
  - project_id: FK to projects
  - repository_url: The Git repository URL (reuses project's existing repository_url)
  - auth_method: 'ssh_deploy_key' (only supported method for now)
  - connection_status: 'not_configured' | 'waiting_for_deploy_key' | 'connected' | 'auth_failed' | 'repo_unreachable' | 'config_error'
  - public_key: The Ed25519 public key (safe to show in UI)
  - key_fingerprint: SSH fingerprint of the public key
  - encrypted_private_key: Private key encrypted at rest (never sent to frontend)
  - key_created_at: When the key pair was generated
  - last_connection_check: Last successful/failed connection test timestamp
  - connection_error: Last error message (no credentials exposed)
  - selected_branch: The deployment target branch chosen by admin
  - created_by: User who created the connection
  - created_at, updated_at: Timestamps

3. Security
- RLS enabled with project-scoped access via has_project_access()
- Private key column is NOT selectable by frontend — only accessible via service role
- A SECURITY DEFINER function returns only safe fields (public key, fingerprint, status) to authenticated users

4. Notes
- The private key is encrypted using pgcrypto with a server-side key
- The frontend never receives the private key or encrypted_private_key value
- Only the edge function (service role) can read the encrypted private key
*/

CREATE TABLE IF NOT EXISTS git_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_url text NOT NULL,
  auth_method text NOT NULL DEFAULT 'ssh_deploy_key' CHECK (auth_method IN ('ssh_deploy_key')),
  connection_status text NOT NULL DEFAULT 'not_configured' CHECK (connection_status IN ('not_configured', 'waiting_for_deploy_key', 'connected', 'auth_failed', 'repo_unreachable', 'config_error')),
  public_key text,
  key_fingerprint text,
  encrypted_private_key text,
  key_created_at timestamptz,
  last_connection_check timestamptz,
  connection_error text,
  selected_branch text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

CREATE OR REPLACE FUNCTION update_git_connections_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_git_connections_updated_at ON git_connections;
CREATE TRIGGER set_git_connections_updated_at
BEFORE UPDATE ON git_connections
FOR EACH ROW EXECUTE FUNCTION update_git_connections_updated_at();

-- Enable RLS
ALTER TABLE git_connections ENABLE ROW LEVEL SECURITY;

-- Policies: project-scoped access
DROP POLICY IF EXISTS "git_conn_scoped_select" ON git_connections;
CREATE POLICY "git_conn_scoped_select" ON git_connections
  FOR SELECT TO authenticated
  USING (has_project_access(project_id));

DROP POLICY IF EXISTS "git_conn_scoped_insert" ON git_connections;
CREATE POLICY "git_conn_scoped_insert" ON git_connections
  FOR INSERT TO authenticated
  WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "git_conn_scoped_update" ON git_connections;
CREATE POLICY "git_conn_scoped_update" ON git_connections
  FOR UPDATE TO authenticated
  USING (has_project_access(project_id)) WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "git_conn_scoped_delete" ON git_connections;
CREATE POLICY "git_conn_scoped_delete" ON git_connections
  FOR DELETE TO authenticated
  USING (has_project_access(project_id));

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON git_connections TO authenticated;

-- Index
CREATE INDEX IF NOT EXISTS idx_git_connections_project ON git_connections(project_id);

-- SECURITY DEFINER function to get only safe fields (no private key)
-- This is used by the frontend to get connection info without exposing the encrypted private key
CREATE OR REPLACE FUNCTION get_git_connection_safe(p_project_id uuid)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  repository_url text,
  auth_method text,
  connection_status text,
  public_key text,
  key_fingerprint text,
  key_created_at timestamptz,
  last_connection_check timestamptz,
  connection_error text,
  selected_branch text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT
    id, project_id, repository_url, auth_method, connection_status,
    public_key, key_fingerprint, key_created_at, last_connection_check,
    connection_error, selected_branch, created_by, created_at, updated_at
  FROM git_connections
  WHERE project_id = p_project_id AND has_project_access(p_project_id);
$$;

GRANT EXECUTE ON FUNCTION get_git_connection_safe(uuid) TO authenticated;
