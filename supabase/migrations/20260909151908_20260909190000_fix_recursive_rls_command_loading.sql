/*
# Fix recursive RLS blocking command loading

## Root Cause
The `commands` SELECT policy contains an `EXISTS` subquery on `command_project_assignments`.
That table has its own RLS requiring `has_project_access(project_id)`, which calls
`is_reauth_valid()`, which queries `admin_reauth_sessions` (also RLS-protected).
This nested RLS chain causes the PostgREST query to fail with a 403/error.

## Fix
1. Create a SECURITY DEFINER function `has_assigned_project_access(p_command_id uuid)`
   that checks if the current user can access ANY project assigned to the given command.
   Being SECURITY DEFINER, it bypasses RLS on `command_project_assignments`.
2. Replace the `EXISTS` subquery in the `commands` SELECT policy with a call to this function.
3. Replace the `EXISTS` subquery in the `commands` UPDATE and DELETE policies similarly.
4. Widen `command_project_assignments` SELECT to allow reading when the user can access
   the command's direct project OR the assignment's project, so the nested join in the
   frontend query (`command_project_assignments(project:projects(...))`) resolves.

## Security
- The SECURITY DEFINER function only checks access; it does not expose data.
- All write policies still require `has_project_access`.
- No data is deleted or modified.
*/

-- 1. Helper function: does the current user have access to any project assigned to this command?
-- SECURITY DEFINER bypasses RLS on command_project_assignments, breaking the recursion.
CREATE OR REPLACE FUNCTION public.has_assigned_project_access(p_command_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM command_project_assignments cpa
    WHERE cpa.command_id = p_command_id
      AND has_project_access(cpa.project_id)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_assigned_project_access(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_assigned_project_access(uuid) TO authenticated;

-- 2. Replace commands SELECT policy to use the helper function instead of a recursive EXISTS
DROP POLICY IF EXISTS "commands_scoped_select" ON commands;
CREATE POLICY "commands_scoped_select" ON commands
  FOR SELECT TO authenticated
  USING (
    scope = 'global'
    OR (
      scope = 'server'
      AND server_id IS NOT NULL
      AND has_server_access(server_id)
    )
    OR (
      scope = 'project'
      AND (
        (project_id IS NOT NULL AND has_project_access(project_id))
        OR has_assigned_project_access(id)
      )
    )
  );

-- 3. Replace commands UPDATE policy
DROP POLICY IF EXISTS "commands_scoped_update" ON commands;
CREATE POLICY "commands_scoped_update" ON commands
  FOR UPDATE TO authenticated
  USING (
    (scope = 'global' AND is_admin())
    OR (
      scope = 'server'
      AND server_id IS NOT NULL
      AND has_server_access(server_id)
    )
    OR (
      scope = 'project'
      AND (
        (project_id IS NOT NULL AND has_project_access(project_id))
        OR has_assigned_project_access(id)
      )
    )
  )
  WITH CHECK (
    (scope = 'global' AND is_admin())
    OR (
      scope = 'server'
      AND server_id IS NOT NULL
      AND has_server_access(server_id)
    )
    OR (
      scope = 'project'
      AND project_id IS NOT NULL
      AND has_project_access(project_id)
    )
  );

-- 4. Replace commands DELETE policy
DROP POLICY IF EXISTS "commands_scoped_delete" ON commands;
CREATE POLICY "commands_scoped_delete" ON commands
  FOR DELETE TO authenticated
  USING (
    (scope = 'global' AND is_admin())
    OR (
      scope = 'server'
      AND server_id IS NOT NULL
      AND has_server_access(server_id)
    )
    OR (
      scope = 'project'
      AND (
        (project_id IS NOT NULL AND has_project_access(project_id))
        OR has_assigned_project_access(id)
      )
    )
  );

-- 5. Widen command_project_assignments SELECT so the frontend nested join resolves.
-- Allow reading an assignment row if the user can access the assignment's project
-- OR can access the command's direct project.
DROP POLICY IF EXISTS "authed_select" ON command_project_assignments;
CREATE POLICY "authed_select" ON command_project_assignments
  FOR SELECT TO authenticated
  USING (
    has_project_access(project_id)
    OR EXISTS (
      SELECT 1 FROM commands c
      WHERE c.id = command_project_assignments.command_id
        AND c.scope = 'project'
        AND c.project_id IS NOT NULL
        AND has_project_access(c.project_id)
    )
  );