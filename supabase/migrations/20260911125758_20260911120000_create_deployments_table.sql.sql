/*
# Create project deployments table

1. New Tables
- `deployments` — stores deployment records linked to a project.
  - `id` (uuid, primary key)
  - `project_id` (uuid, foreign key to projects, ON DELETE CASCADE)
  - `url` (text, the deployment URL)
  - `status` (text, deployment status: e.g. Active, Inactive, Failed, Pending)
  - `notes` (text, optional notes about the deployment)
  - `created_at` (timestamptz, default now())
  - `updated_at` (timestamptz, default now())

2. Security
- Enable RLS on `deployments`.
- 4 separate policies (SELECT/INSERT/UPDATE/DELETE) scoped to `authenticated` using `has_project_access(project_id)`.

3. Indexes
- Index on `project_id` for efficient lookups.

4. Important Notes
- Uses existing `has_project_access()` function for access control.
- Cascade delete: removing a project removes its deployments.
- `updated_at` auto-updates via trigger (reuses existing `update_updated_at()` function).
*/

CREATE TABLE IF NOT EXISTS deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Active',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);

ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deployments_select" ON deployments;
CREATE POLICY "deployments_select" ON deployments FOR SELECT
  TO authenticated USING (has_project_access(project_id));

DROP POLICY IF EXISTS "deployments_insert" ON deployments;
CREATE POLICY "deployments_insert" ON deployments FOR INSERT
  TO authenticated WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "deployments_update" ON deployments;
CREATE POLICY "deployments_update" ON deployments FOR UPDATE
  TO authenticated USING (has_project_access(project_id)) WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "deployments_delete" ON deployments;
CREATE POLICY "deployments_delete" ON deployments FOR DELETE
  TO authenticated USING (has_project_access(project_id));

DROP TRIGGER IF EXISTS deployments_updated_at ON deployments;
CREATE TRIGGER deployments_updated_at
  BEFORE UPDATE ON deployments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();