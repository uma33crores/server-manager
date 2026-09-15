/*
# Universal 60-minute re-verification enforcement

1. Purpose
- Replace admin-only re-verification with universal re-verification for ALL users
- Every authenticated user must re-verify via OTP every 60 minutes
- Backend enforcement: RLS helper functions check reauth expiry
- record_own_reauth() lets any user record their own reauth timestamp (SECURITY DEFINER)

2. Modified database objects
- is_admin(): now also returns false if reauth expired
- has_server_access(): now also returns false if reauth expired
- has_project_access(): now also returns false if reauth expired
- NEW function record_own_reauth(): SECURITY DEFINER, callable by authenticated,
  inserts/updates the user's reauth timestamp in admin_reauth_sessions

3. Notes
- admin_reauth_sessions table is repurposed for all users (not just admins)
- The column admin_id references auth.users(id) — works for any user
- check_admin_reauth() already checks the 1-hour window
*/

-- Let any authenticated user record their own reauth timestamp
CREATE OR REPLACE FUNCTION record_own_reauth()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO admin_reauth_sessions (admin_id, reauthenticated_at)
  VALUES (auth.uid(), now())
  ON CONFLICT (admin_id)
  DO UPDATE SET reauthenticated_at = now(), updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION record_own_reauth TO authenticated;

-- Create a generic check function for reauth validity (not admin-specific)
CREATE OR REPLACE FUNCTION is_reauth_valid()
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

GRANT EXECUTE ON FUNCTION is_reauth_valid TO authenticated;

-- Modify is_admin() to also check reauth
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT true FROM user_roles
     WHERE user_id = auth.uid()
     AND role = 'admin'
     AND is_active = true
     AND reverification_required = false),
    false
  ) AND is_reauth_valid();
 
$$;

-- Modify has_server_access() to also check reauth
CREATE OR REPLACE FUNCTION has_server_access(p_server_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT is_reauth_valid() AND (
    COALESCE(
      (SELECT true FROM user_roles
       WHERE user_id = auth.uid()
       AND role = 'admin'
       AND is_active = true
       AND reverification_required = false),
      false
    )
    OR COALESCE(
      (SELECT true FROM user_roles
       WHERE user_id = auth.uid()
       AND is_active = true
       AND reverification_required = false),
      false
    )
    AND COALESCE(
      (SELECT true FROM user_server_access WHERE user_id = auth.uid() AND server_id = p_server_id),
      false
    )
  );
$$;

-- Modify has_project_access() to also check reauth
CREATE OR REPLACE FUNCTION has_project_access(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT is_reauth_valid() AND (
    COALESCE(
      (SELECT true FROM user_roles
       WHERE user_id = auth.uid()
       AND role = 'admin'
       AND is_active = true
       AND reverification_required = false),
      false
    )
    OR (
      COALESCE(
        (SELECT true FROM user_roles
         WHERE user_id = auth.uid()
         AND is_active = true
         AND reverification_required = false),
        false
      )
      AND COALESCE(
        (SELECT true FROM user_project_access WHERE user_id = auth.uid() AND project_id = p_project_id),
        false
      )
    )
  );
$$;
