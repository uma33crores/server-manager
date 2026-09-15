/*
# Fix command visibility and assignment access policies

## Overview
Commands were present in the database but could appear empty or fail to save because the scoped policies only understood the legacy `commands.project_id` relationship. This migration makes the policies understand both direct project ownership and the `command_project_assignments` many-to-many relationship.

## 1. Modified table policies
- `commands` SELECT now allows a command when the user can access its direct project or any project assigned through `command_project_assignments`.
- `commands` INSERT, UPDATE, and DELETE keep the existing project-access requirement for direct project commands.
- Global command access remains admin-controlled for writes and shared for reads, matching the existing application behavior.
- `command_project_assignments` SELECT, INSERT, UPDATE, and DELETE now require access to the referenced project instead of allowing every authenticated user.

## 2. Security
- All policies remain scoped to authenticated users.
- Assignment access uses the existing `has_project_access(project_id)` authorization function.
- No command or assignment data is deleted or modified.

## 3. Compatibility
- Existing commands using `commands.project_id` continue to work.
- Existing assignment rows continue to work.
- The unique primary key on assignments still prevents duplicate command/project pairs.
*/

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
        OR EXISTS (
          SELECT 1
          FROM command_project_assignments cpa
          WHERE cpa.command_id = commands.id
            AND has_project_access(cpa.project_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS "commands_scoped_insert" ON commands;
CREATE POLICY "commands_scoped_insert" ON commands
  FOR INSERT TO authenticated
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
        OR EXISTS (
          SELECT 1
          FROM command_project_assignments cpa
          WHERE cpa.command_id = commands.id
            AND has_project_access(cpa.project_id)
        )
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
        OR EXISTS (
          SELECT 1
          FROM command_project_assignments cpa
          WHERE cpa.command_id = commands.id
            AND has_project_access(cpa.project_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS "authed_select" ON command_project_assignments;
CREATE POLICY "authed_select" ON command_project_assignments
  FOR SELECT TO authenticated
  USING (has_project_access(project_id));

DROP POLICY IF EXISTS "authed_insert" ON command_project_assignments;
CREATE POLICY "authed_insert" ON command_project_assignments
  FOR INSERT TO authenticated
  WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "authed_update" ON command_project_assignments;
CREATE POLICY "authed_update" ON command_project_assignments
  FOR UPDATE TO authenticated
  USING (has_project_access(project_id))
  WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "authed_delete" ON command_project_assignments;
CREATE POLICY "authed_delete" ON command_project_assignments
  FOR DELETE TO authenticated
  USING (has_project_access(project_id));