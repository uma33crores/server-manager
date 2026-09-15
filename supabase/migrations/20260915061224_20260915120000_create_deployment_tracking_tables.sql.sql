/*
# Deployment tracking tables for enhanced Deployments tab

Extends the existing deployments table and adds:
- project_deployment_state — tracks production/git state per project
- deployment_changes — file-level changes per deployment
- deployment_migrations — DB migration status per deployment
- deployment_functions — edge function hash comparison per deployment
- deployment_logs — real-time deployment log lines
- deployment_manifests — deployment manifest snapshots
- git_change_events — records git history rewrite events

All tables use has_project_access() for RLS, matching the existing deployments pattern.
*/

-- Extend deployments table with deployment tracking columns
ALTER TABLE deployments
  ADD COLUMN IF NOT EXISTS deployment_id text,
  ADD COLUMN IF NOT EXISTS environment text DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS previous_commit_sha text,
  ADD COLUMN IF NOT EXISTS target_commit_sha text,
  ADD COLUMN IF NOT EXISTS git_status text,
  ADD COLUMN IF NOT EXISTS started_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS started_by_email text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS migration_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS function_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frontend_changes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backend_changes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dependency_changes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS config_changes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_managed boolean DEFAULT false;

-- Add new statuses to the deployments status check (drop and recreate)
ALTER TABLE deployments DROP CONSTRAINT IF EXISTS deployments_status_check;
ALTER TABLE deployments ADD CONSTRAINT deployments_status_check
  CHECK (status IN ('Active', 'Inactive', 'Failed', 'Pending', 'Maintenance',
    'checking', 'ready', 'deploying', 'success', 'failed', 'cancelled', 'rolled_back'));

-- ============================================================
-- project_deployment_state
-- ============================================================
CREATE TABLE IF NOT EXISTS project_deployment_state (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  production_commit_sha text,
  production_branch text,
  last_deployed_commit_sha text,
  last_seen_remote_commit_sha text,
  previous_remote_commit_sha text,
  current_remote_commit_sha text,
  git_status text DEFAULT 'UNKNOWN',
  working_tree_clean boolean DEFAULT true,
  baseline_initialized boolean DEFAULT false,
  last_checked_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE project_deployment_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pds_select" ON project_deployment_state;
CREATE POLICY "pds_select" ON project_deployment_state FOR SELECT
  TO authenticated USING (has_project_access(project_id));

DROP POLICY IF EXISTS "pds_insert" ON project_deployment_state;
CREATE POLICY "pds_insert" ON project_deployment_state FOR INSERT
  TO authenticated WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "pds_update" ON project_deployment_state;
CREATE POLICY "pds_update" ON project_deployment_state FOR UPDATE
  TO authenticated USING (has_project_access(project_id)) WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "pds_delete" ON project_deployment_state;
CREATE POLICY "pds_delete" ON project_deployment_state FOR DELETE
  TO authenticated USING (has_project_access(project_id));

CREATE TRIGGER pds_updated_at
  BEFORE UPDATE ON project_deployment_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- deployment_changes
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid REFERENCES deployments(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category text NOT NULL,
  file_path text NOT NULL,
  change_action text NOT NULL,
  old_hash text,
  new_hash text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployment_changes_deployment_id ON deployment_changes(deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployment_changes_project_id ON deployment_changes(project_id);

ALTER TABLE deployment_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dc_select" ON deployment_changes;
CREATE POLICY "dc_select" ON deployment_changes FOR SELECT
  TO authenticated USING (has_project_access(project_id));

DROP POLICY IF EXISTS "dc_insert" ON deployment_changes;
CREATE POLICY "dc_insert" ON deployment_changes FOR INSERT
  TO authenticated WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "dc_update" ON deployment_changes;
CREATE POLICY "dc_update" ON deployment_changes FOR UPDATE
  TO authenticated USING (has_project_access(project_id)) WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "dc_delete" ON deployment_changes;
CREATE POLICY "dc_delete" ON deployment_changes FOR DELETE
  TO authenticated USING (has_project_access(project_id));

-- ============================================================
-- deployment_migrations
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid REFERENCES deployments(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  migration_name text NOT NULL,
  migration_hash text,
  status text DEFAULT 'pending',
  applied_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployment_migrations_deployment_id ON deployment_migrations(deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployment_migrations_project_id ON deployment_migrations(project_id);

ALTER TABLE deployment_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dm_select" ON deployment_migrations;
CREATE POLICY "dm_select" ON deployment_migrations FOR SELECT
  TO authenticated USING (has_project_access(project_id));

DROP POLICY IF EXISTS "dm_insert" ON deployment_migrations;
CREATE POLICY "dm_insert" ON deployment_migrations FOR INSERT
  TO authenticated WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "dm_update" ON deployment_migrations;
CREATE POLICY "dm_update" ON deployment_migrations FOR UPDATE
  TO authenticated USING (has_project_access(project_id)) WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "dm_delete" ON deployment_migrations;
CREATE POLICY "dm_delete" ON deployment_migrations FOR DELETE
  TO authenticated USING (has_project_access(project_id));

-- ============================================================
-- deployment_functions
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_functions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid REFERENCES deployments(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  function_name text NOT NULL,
  production_hash text,
  target_hash text,
  status text DEFAULT 'no_change',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployment_functions_deployment_id ON deployment_functions(deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployment_functions_project_id ON deployment_functions(project_id);

ALTER TABLE deployment_functions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "df_select" ON deployment_functions;
CREATE POLICY "df_select" ON deployment_functions FOR SELECT
  TO authenticated USING (has_project_access(project_id));

DROP POLICY IF EXISTS "df_insert" ON deployment_functions;
CREATE POLICY "df_insert" ON deployment_functions FOR INSERT
  TO authenticated WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "df_update" ON deployment_functions;
CREATE POLICY "df_update" ON deployment_functions FOR UPDATE
  TO authenticated USING (has_project_access(project_id)) WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "df_delete" ON deployment_functions;
CREATE POLICY "df_delete" ON deployment_functions FOR DELETE
  TO authenticated USING (has_project_access(project_id));

-- ============================================================
-- deployment_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid REFERENCES deployments(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  log_level text DEFAULT 'info',
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployment_logs_deployment_id ON deployment_logs(deployment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deployment_logs_project_id ON deployment_logs(project_id);

ALTER TABLE deployment_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dl_select" ON deployment_logs;
CREATE POLICY "dl_select" ON deployment_logs FOR SELECT
  TO authenticated USING (has_project_access(project_id));

DROP POLICY IF EXISTS "dl_insert" ON deployment_logs;
CREATE POLICY "dl_insert" ON deployment_logs FOR INSERT
  TO authenticated WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "dl_delete" ON deployment_logs;
CREATE POLICY "dl_delete" ON deployment_logs FOR DELETE
  TO authenticated USING (has_project_access(project_id));

-- ============================================================
-- deployment_manifests
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid REFERENCES deployments(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  commit_sha text,
  branch text,
  manifest_json jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployment_manifests_project_id ON deployment_manifests(project_id, created_at DESC);

ALTER TABLE deployment_manifests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dman_select" ON deployment_manifests;
CREATE POLICY "dman_select" ON deployment_manifests FOR SELECT
  TO authenticated USING (has_project_access(project_id));

DROP POLICY IF EXISTS "dman_insert" ON deployment_manifests;
CREATE POLICY "dman_insert" ON deployment_manifests FOR INSERT
  TO authenticated WITH CHECK (has_project_access(project_id));

-- ============================================================
-- git_change_events
-- ============================================================
CREATE TABLE IF NOT EXISTS git_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch text,
  old_sha text,
  new_sha text,
  event_type text NOT NULL,
  detected_at timestamptz DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_git_change_events_project_id ON git_change_events(project_id, detected_at DESC);

ALTER TABLE git_change_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gce_select" ON git_change_events;
CREATE POLICY "gce_select" ON git_change_events FOR SELECT
  TO authenticated USING (has_project_access(project_id));

DROP POLICY IF EXISTS "gce_insert" ON git_change_events;
CREATE POLICY "gce_insert" ON git_change_events FOR INSERT
  TO authenticated WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "gce_update" ON git_change_events;
CREATE POLICY "gce_update" ON git_change_events FOR UPDATE
  TO authenticated USING (has_project_access(project_id)) WITH CHECK (has_project_access(project_id));
