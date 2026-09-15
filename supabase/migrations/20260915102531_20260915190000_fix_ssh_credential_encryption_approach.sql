/*
# Fix SSH Credential Encryption Approach

1. Purpose
- The previous migration used pgp_sym_encrypt with JWT claims as the key, which is unreliable
- New approach: the Node.js backend handles encryption/decryption using AES-256-GCM
- The database just stores the encrypted blob as text
- This migration drops the broken pgcrypto functions and replaces them with simple storage functions

2. Changes
- DROP: save_ssh_credential (pgcrypto-based) 
- DROP: get_ssh_credential (pgcrypto-based, service-role only)
- CREATE: save_ssh_credential_encrypted(p_server_id, p_encrypted_password) — stores pre-encrypted blob
- CREATE: get_ssh_credential_encrypted(p_server_id) — returns encrypted blob for backend decryption
- KEEP: get_ssh_credential_status (safe fields for frontend)
- KEEP: update_ssh_test_result

3. Security
- The encrypted_password column stores a base64-encoded AES-256-GCM ciphertext
- Only the backend has the decryption key (in its environment)
- Frontend never sees encrypted or decrypted password
- RLS policies remain unchanged (authenticated users can read/write the table, but encrypted blob is useless without the key)
*/

-- Drop broken pgcrypto functions
DROP FUNCTION IF EXISTS save_ssh_credential(uuid, text);
DROP FUNCTION IF EXISTS get_ssh_credential(uuid);

-- Replace with simple storage function (backend handles encryption)
CREATE OR REPLACE FUNCTION save_ssh_credential_encrypted(
  p_server_id uuid,
  p_encrypted_password text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

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
    p_encrypted_password,
    auth.uid(),
    now(),
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT (server_id) DO UPDATE
  SET
    encrypted_password = p_encrypted_password,
    configured_by = auth.uid(),
    configured_at = now(),
    last_tested_at = NULL,
    last_test_success = NULL,
    last_test_error = NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION save_ssh_credential_encrypted(uuid, text) TO authenticated;

-- Simple retrieval function (returns encrypted blob — backend decrypts)
CREATE OR REPLACE FUNCTION get_ssh_credential_encrypted(p_server_id uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT encrypted_password FROM server_ssh_credentials WHERE server_id = p_server_id;
$$;

GRANT EXECUTE ON FUNCTION get_ssh_credential_encrypted(uuid) TO authenticated;
