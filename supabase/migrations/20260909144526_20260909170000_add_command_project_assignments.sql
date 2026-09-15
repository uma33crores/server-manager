/*
# Add many-to-many command-to-project assignments

## Overview
Allows one command from the central Commands section to be assigned to one or more projects.
Project-created commands continue to work through the existing `commands.project_id` field.
The project command view will combine both relationships and remove duplicates.

## 1. New table
- `command_project_assignments`
- `command_id` references `commands(id)` and is deleted with the command.
- `project_id` references `projects(id)` and is deleted with the project.
- The `(command_id, project_id)` pair is unique so the same command cannot be assigned twice.
- `created_at` records when the assignment was created.

## 2. Security
- Row-level security is enabled.
- Authenticated users may read, create, update, and delete shared assignment rows, matching the existing shared application data model.
- The existing read-only enforcement trigger is attached so read-only users cannot create, change, or remove assignments through the API.

## 3. Compatibility
- Existing `commands.project_id` data is not changed or removed.
- Existing project-scoped commands remain visible.
*/

CREATE TABLE IF NOT EXISTS command_project_assignments (
  command_id uuid NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (command_id, project_id)
);

CREATE INDEX IF NOT EXISTS command_project_assignments_project_idx
  ON command_project_assignments (project_id, command_id);

ALTER TABLE command_project_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authed_select" ON command_project_assignments;
CREATE POLICY "authed_select" ON command_project_assignments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authed_insert" ON command_project_assignments;
CREATE POLICY "authed_insert" ON command_project_assignments
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "authed_update" ON command_project_assignments;
CREATE POLICY "authed_update" ON command_project_assignments
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authed_delete" ON command_project_assignments;
CREATE POLICY "authed_delete" ON command_project_assignments
  FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS enforce_not_read_only ON command_project_assignments;
CREATE TRIGGER enforce_not_read_only
  BEFORE INSERT OR UPDATE OR DELETE ON command_project_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_not_read_only();