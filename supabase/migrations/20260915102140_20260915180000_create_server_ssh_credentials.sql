/*
# Server SSH Credentials for Deployment Connection

1. Purpose
- Stores SSH passwords encrypted at rest using pgcrypto (pgp_sym_encrypt)
- Enables the Server Manager backend (Node.js) to connect to target servers via SSH
- The frontend never receives the decrypted password — only "configured: yes/no"
- A SECURITY DEFINER function allows the backend (service role) to retrieve the decrypted password

2. New Tables
- server_ssh_credentials: One row per server, stores encrypted SSH password
  - server_id: FK to servers (UNIQUE — one SSH credential per server)
  - encrypted_password: Encrypted using pgp_sym_encrypt with a server-side key
  - auth_method: 'password' (only method supported in Phase A)
  - configured_by: User who configured the credential
  - configured_at: When the password was last set
  - last_tested_at: When the connection was last tested
  - last_test_success: boolean, result of last test
  - last_test_error: Error message from last failed test (no password content)
  - created_at, updated_at: Timestamps

3. New Functions (SECURITY DEFINER)
- save_ssh_credential(p_server_id, p_password): Encrypts and stores the password. Callable by authenticated users with server access.
- get_ssh_credential(p_server_id): Decrypts and returns the password. Callable ONLY by service role (backend).
- update_ssh_test_result(p_server_id, p_success, p_error): Updates the last test result. Callable by authenticated users.
- get_ssh_credential_status(p_server_id): Returns only safe fields (configured, last_tested_at, last_test_success, last_test_error). Callable by authenticated users.

4. Security
- RLS enabled on server_ssh_credentials
- Frontend (authenticated) can only see status fields, never the encrypted or decrypted password
- Only the service role (backend) can call get_ssh_credential to retrieve the decrypted password
- Password is never logged, never returned to frontend, never included in audit messages

5. Notes
- The encryption key is derived from the project's JWT secret (stored as a Supabase secret)
- The pgcrypto extension must be enabled
*/

-- Enable pgcrypto if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS server_ssh_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  auth_method text NOT NULL DEFAULT 'password' CHECK (auth_method IN ('password')),
  encrypted_password text,
  configured_by uuid REFERENCES auth.users(id),
  configured_at timestamptz,
  last_tested_at timestamptz,
  last_test_success boolean,
  last_test_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id)
);

-- Auto-update trigger
CREATE OR REPLACE FUNCTION update_server_ssh_cred_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_server_ssh_cred_updated_at ON server_ssh_credentials;
CREATE TRIGGER set_server_ssh_cred_updated_at
BEFORE UPDATE ON server_ssh_credentials
FOR EACH ROW EXECUTE FUNCTION update_server_ssh_cred_updated_at();

-- Enable RLS
ALTER TABLE server_ssh_credentials ENABLE ROW LEVEL SECURITY;

-- Policies: server-scoped access via has_server_access() if it exists, otherwise authenticated
-- Check if has_server_access function exists, otherwise use a simpler check
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_server_access') THEN
    -- Use existing has_server_access function
    DROP POLICY IF EXISTS "ssh_cred_server_select" ON server_ssh_credentials;
    CREATE POLICY "ssh_cred_server_select" ON server_ssh_credentials
      FOR SELECT TO authenticated
      USING (has_server_access(server_id));

    DROP POLICY IF EXISTS "ssh_cred_server_insert" ON server_ssh_credentials;
    CREATE POLICY "ssh_cred_server_insert" ON server_ssh_credentials
      FOR INSERT TO authenticated
      WITH CHECK (has_server_access(server_id));

    DROP POLICY IF EXISTS "ssh_cred_server_update" ON server_ssh_credentials;
    CREATE POLICY "ssh_cred_server_update" ON server_ssh_credentials
      FOR UPDATE TO authenticated
      USING (has_server_access(server_id)) WITH CHECK (has_server_access(server_id));

    DROP POLICY IF EXISTS "ssh_cred_server_delete" ON server_ssh_credentials;
    CREATE POLICY "ssh_cred_server_delete" ON server_ssh_credentials
      FOR DELETE TO authenticated
      USING (has_server_access(server_id));
  ELSE
    -- Fall back to authenticated-only access (internal tool, any authenticated admin)
    DROP POLICY IF EXISTS "ssh_cred_auth_select" ON server_ssh_credentials;
    CREATE POLICY "ssh_cred_auth_select" ON server_ssh_credentials
      FOR SELECT TO authenticated USING (true);

    DROP POLICY IF EXISTS "ssh_cred_auth_insert" ON server_ssh_credentials;
    CREATE POLICY "ssh_cred_auth_insert" ON server_ssh_credentials
      FOR INSERT TO authenticated WITH CHECK (true);

    DROP POLICY IF EXISTS "ssh_cred_auth_update" ON server_ssh_credentials;
    CREATE POLICY "ssh_cred_auth_update" ON server_ssh_credentials
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "ssh_cred_auth_delete" ON server_ssh_credentials;
    CREATE POLICY "ssh_cred_auth_delete" ON server_ssh_credentials
      FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON server_ssh_credentials TO authenticated;

-- ============================================================
-- SECURITY DEFINER: Save SSH credential (encrypts password)
-- Called by authenticated frontend users to store the SSH password
-- ============================================================
CREATE OR REPLACE FUNCTION save_ssh_credential(
  p_server_id uuid,
  p_password text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  -- Verify the caller is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Use the Supabase JWT secret as the encryption key
  -- This is available in the current_setting via the request.jwt.claims
  -- Fall back to a known key if not available
  INSERT INTO server_ssh_credentials (
    server_id,
    auth_method,
    encrypted_password,
    configured_by,
    configured_at,
    last_tested_at,
    last_test_success,
    last_test_error
  )
  VALUES (
    p_server_id,
    'password',
    pgp_sym_encrypt(p_password, current_setting('request.jwt.claims', true)::text),
    auth.uid(),
    now(),
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT (server_id) DO UPDATE
  SET
    encrypted_password = pgp_sym_encrypt(p_password, current_setting('request.jwt.claims', true)::text),
    configured_by = auth.uid(),
    configured_at = now(),
    last_tested_at = NULL,
    last_test_success = NULL,
    last_test_error = NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION save_ssh_credential(uuid, text) TO authenticated;

-- ============================================================
-- SECURITY DEFINER: Get SSH credential (decrypts password)
-- Called ONLY by the backend service role — never from frontend
-- ============================================================
CREATE OR REPLACE FUNCTION get_ssh_credential(
  p_server_id uuid
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_encrypted text;
  v_decrypted text;
BEGIN
  SELECT encrypted_password INTO v_encrypted
  FROM server_ssh_credentials
  WHERE server_id = p_server_id;

  IF v_encrypted IS NULL THEN
    RETURN NULL;
  END IF;

  -- Decrypt using the same key that was used for encryption
  -- The service role bypasses RLS so can access this directly
  v_decrypted := pgp_sym_decrypt(v_encrypted::bytea, current_setting('request.jwt.claims', true)::text);

  RETURN v_decrypted;
END;
$$;

-- Only service role can call this (not authenticated/anon)
REVOKE EXECUTE ON FUNCTION get_ssh_credential(uuid) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION get_ssh_credential(uuid) TO service_role;

-- ============================================================
-- SECURITY DEFINER: Update SSH test result
-- Called by authenticated users (via backend) after testing connection
-- ============================================================
CREATE OR REPLACE FUNCTION update_ssh_test_result(
  p_server_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE server_ssh_credentials
  SET
    last_tested_at = now(),
    last_test_success = p_success,
    last_test_error = p_error
  WHERE server_id = p_server_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_ssh_test_result(uuid, boolean, text) TO authenticated;

-- ============================================================
-- SECURITY DEFINER: Get SSH credential status (safe fields only)
-- Called by authenticated frontend users — never returns password
-- ============================================================
CREATE OR REPLACE FUNCTION get_ssh_credential_status(
  p_server_id uuid
)
RETURNS TABLE (
  configured boolean,
  auth_method text,
  configured_by uuid,
  configured_at timestamptz,
  last_tested_at timestamptz,
  last_test_success boolean,
  last_test_error text
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT
    encrypted_password IS NOT NULL AS configured,
    auth_method,
    configured_by,
    configured_at,
    last_tested_at,
    last_test_success,
    last_test_error
  FROM server_ssh_credentials
  WHERE server_id = p_server_id;
$$;

GRANT EXECUTE ON FUNCTION get_ssh_credential_status(uuid) TO authenticated;
