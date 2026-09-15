/*
# Add user re-verification enforcement system

1. Purpose
- Adds `reverification_required` column to `user_roles` table
- When an admin marks a user for re-verification, that user is completely locked
  out of the application until they complete the existing 8-digit OTP flow.
- Backend enforcement: all RLS helper functions (is_admin, has_server_access,
  has_project_access) check the reverification flag and return false when it's set,
  blocking ALL database access (reads and writes) for that user.
- Frontend enforcement: the app detects the flag and forces the user to a
  full-screen OTP verification page with no navigation escape.
- Only OTP-related operations (verify, resend) and logout are allowed while locked.

2. Modified database objects
- `user_roles` table: added `reverification_required boolean NOT NULL DEFAULT false`
- `is_admin()`: returns false if reverification_required is true for the current user
- `has_server_access()`: returns false if reverification_required is true
- `has_project_access()`: returns false if reverification_required is true
- `get_user_role()`: unchanged (still returns role for display purposes)
- NEW function `clear_reverification(p_user_id uuid)`: clears the flag after OTP success
  - SECURITY DEFINER, callable by authenticated (the user clears their own flag)

3. Security
- RLS on user_roles already exists; users can SELECT their own row, admins manage all.
- The reverification_required column is admin-only writable via the existing
  user_roles_admin_update policy (admins call it through the user-management edge function).
- clear_reverification is SECURITY DEFINER so it can UPDATE the row regardless of RLS,
  but it only allows clearing (setting to false), never setting to true.
*/

-- Add reverification_required column to user_roles
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS reverification_required boolean NOT NULL DEFAULT false;

-- Modify is_admin() to return false when reverification is pending
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
  );
$$;

-- Modify has_server_access() to return false when reverification is pending
CREATE OR REPLACE FUNCTION has_server_access(p_server_id uuid)
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
  ) OR (
    COALESCE(
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

-- Modify has_project_access() to return false when reverification is pending
CREATE OR REPLACE FUNCTION has_project_access(p_project_id uuid)
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
  ) OR (
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
  );
$$;

-- Function to clear reverification flag (called after successful OTP)
-- SECURITY DEFINER so the user can clear their own flag (RLS would block UPDATE)
CREATE OR REPLACE FUNCTION clear_reverification(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_roles
  SET reverification_required = false
  WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION clear_reverification TO authenticated;

-- Make sure user_roles SELECT policy lets users see their own reverification_required
-- (existing policy already allows SELECT on own row, so no change needed)
