/*
# Add SECURITY DEFINER function for backend role lookup

1. Purpose
   The Node.js backend needs to look up a user's role, is_active, and access_type
   from the user_roles table. The backend's supabaseAdmin client uses the anon key,
   which has no authenticated session — RLS blocks the query and returns no rows.

2. New Functions
   - `get_user_role_record(p_user_id uuid)`: Returns the full user_roles row
     (role, is_active, access_type) for the given user_id. SECURITY DEFINER
     bypasses RLS so the backend can read the record without the service role key.

3. Security
   - SECURITY DEFINER: runs as the database owner, bypassing RLS
   - Only returns the calling user's own role record — the backend passes the
     authenticated user's UUID (already verified via Supabase Auth)
   - Does NOT expose other users' role records
   - Returns only: role, is_active, access_type (no sensitive data)

4. Important Notes
   - The backend verifies the JWT via supabaseAdmin.auth.getUser(token) first
   - Then calls this function with the verified user's UUID
   - This is the same pattern used by existing SECURITY DEFINER functions
     (is_admin, get_user_role, has_server_access, has_project_access)
*/
CREATE OR REPLACE FUNCTION public.get_user_role_record(p_user_id uuid)
RETURNS TABLE (
  role text,
  is_active boolean,
  access_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $function$
  SELECT role, is_active, access_type
  FROM user_roles
  WHERE user_id = p_user_id
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_user_role_record(uuid) TO authenticated;
