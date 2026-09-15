/*
# Fix Project Access Control

1. Purpose
- Fix has_project_access() which incorrectly granted access to ALL projects
  on any server the user has access to, regardless of explicit project assignment
- Fix get_accessible_project_ids() which had the same overbroad logic
- Users should ONLY see projects explicitly assigned via user_project_access
- Admins still see all projects (unchanged)

2. Modified database objects
- has_project_access() — removed overbroad third condition
- get_accessible_project_ids() — removed overbroad third UNION branch

3. Security
- Tightens RLS: normal users now only see explicitly assigned projects
- No change to admin access
*/

-- Fix has_project_access: remove the third condition that didn't filter by p_project_id
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
  );
$$;

-- Fix get_accessible_project_ids: remove the overbroad server-based UNION branch
CREATE OR REPLACE FUNCTION get_accessible_project_ids()
RETURNS TABLE(project_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id FROM projects WHERE is_admin()
  UNION
  SELECT project_id FROM user_project_access WHERE user_id = auth.uid()
$$;
