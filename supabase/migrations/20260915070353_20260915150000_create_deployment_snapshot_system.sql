/*
# Deployment Snapshot and Comparison System

1. Purpose
- Replaces SSH-based deployment tracking with snapshot-based comparison
- Administrators upload ZIP snapshots of deployed code; system compares against Git targets
- Generates manual deployment commands (display only, never executed)
- Tracks deployment workflow: upload → compare → plan → commands → record → verify

2. New Tables
- deployment_snapshots: Metadata for each snapshot (environment upload or git target)
- deployment_snapshot_files: File manifest with SHA-256 hashes, sizes, categories
- deployment_comparisons: Comparison result between two snapshots
- deployment_comparison_changes: Per-file changes (added/modified/deleted) from comparison
- deployment_plans: Generated deployment plans from comparison + project config
- deployment_command_steps: Individual manual command steps with risk levels

3. Extended Tables
- deployments: Added source_snapshot_id, target_snapshot_id, comparison_id, plan_id,
  method, verification_state, result, result_notes, app_updated, db_updated,
  functions_updated, build_successful, health_check_successful
- project_deployment_state: Added current_baseline_snapshot_id, current_git_target_snapshot_id,
  current_comparison_id

4. Storage
- Created 'deployment-snapshots' private storage bucket for archive uploads

5. Security
- RLS enabled on all new tables with project-scoped access via has_project_access()
- Storage policies scoped to project_id in path
- Admin-only for destructive operations (archive, set baseline)
*/

-- ============================================================
-- 1. DEPLOYMENT SNAPSHOTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('testing', 'staging', 'production')),
  source_type text NOT NULL CHECK (source_type IN ('environment', 'git_target')),
  label text NOT NULL,
  description text,
  known_git_commit text,
  known_git_branch text,
  deployment_date timestamptz,
  notes text,
  storage_path text,
  file_count integer NOT NULL DEFAULT 0,
  total_size bigint NOT NULL DEFAULT 0,
  verification_state text NOT NULL DEFAULT 'unverified' CHECK (verification_state IN ('unverified', 'admin_confirmed', 'snapshot_verified', 'drift_detected')),
  is_current_baseline boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  git_commit_sha text,
  git_commit_message text,
  git_commit_author text,
  git_commit_date timestamptz,
  git_fetch_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_deployment_snapshots_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_deployment_snapshots_updated_at ON deployment_snapshots;
CREATE TRIGGER set_deployment_snapshots_updated_at
BEFORE UPDATE ON deployment_snapshots
FOR EACH ROW EXECUTE FUNCTION update_deployment_snapshots_updated_at();

-- ============================================================
-- 2. DEPLOYMENT SNAPSHOT FILES TABLE (manifest entries)
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_snapshot_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES deployment_snapshots(id) ON DELETE CASCADE,
  relative_path text NOT NULL,
  file_hash text NOT NULL,
  file_size bigint NOT NULL,
  file_type text NOT NULL DEFAULT 'text',
  category text NOT NULL DEFAULT 'Other',
  area text NOT NULL DEFAULT 'application' CHECK (area IN ('application', 'supabase')),
  UNIQUE (snapshot_id, relative_path)
);

-- ============================================================
-- 3. DEPLOYMENT COMPARISONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_snapshot_id uuid NOT NULL REFERENCES deployment_snapshots(id) ON DELETE CASCADE,
  target_snapshot_id uuid NOT NULL REFERENCES deployment_snapshots(id) ON DELETE CASCADE,
  total_changed integer NOT NULL DEFAULT 0,
  added_count integer NOT NULL DEFAULT 0,
  modified_count integer NOT NULL DEFAULT 0,
  deleted_count integer NOT NULL DEFAULT 0,
  unchanged_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. DEPLOYMENT COMPARISON CHANGES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_comparison_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_id uuid NOT NULL REFERENCES deployment_comparisons(id) ON DELETE CASCADE,
  relative_path text NOT NULL,
  status text NOT NULL CHECK (status IN ('added', 'modified', 'deleted', 'unchanged', 'renamed')),
  category text NOT NULL DEFAULT 'Other',
  area text NOT NULL DEFAULT 'application',
  source_hash text,
  target_hash text,
  source_size bigint,
  target_size bigint,
  is_binary boolean NOT NULL DEFAULT false
);

-- ============================================================
-- 5. DEPLOYMENT PLANS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  comparison_id uuid REFERENCES deployment_comparisons(id) ON DELETE SET NULL,
  plan_data jsonb NOT NULL DEFAULT '[]',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. DEPLOYMENT COMMAND STEPS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS deployment_command_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES deployment_plans(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  title text NOT NULL,
  purpose text,
  command text NOT NULL,
  risk_level text NOT NULL DEFAULT 'read_only' CHECK (risk_level IN ('read_only', 'backup', 'file_change', 'build', 'database_change', 'service_restart', 'verification', 'high_risk')),
  expected_result text,
  rollback_note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped', 'failed')),
  config_used jsonb DEFAULT '{}'
);

-- ============================================================
-- 7. EXTEND DEPLOYMENTS TABLE
-- ============================================================
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS source_snapshot_id uuid REFERENCES deployment_snapshots(id) ON DELETE SET NULL;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS target_snapshot_id uuid REFERENCES deployment_snapshots(id) ON DELETE SET NULL;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS comparison_id uuid REFERENCES deployment_comparisons(id) ON DELETE SET NULL;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES deployment_plans(id) ON DELETE SET NULL;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS method text DEFAULT 'manual_commands' CHECK (method IN ('manual_commands', 'deployment_package', 'admin_confirmed'));
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS verification_state text DEFAULT 'unverified' CHECK (verification_state IN ('unverified', 'admin_confirmed', 'snapshot_verified', 'drift_detected'));
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS result text DEFAULT 'pending' CHECK (result IN ('pending', 'reported_successful', 'partially_successful', 'failed', 'cancelled', 'verified', 'drift_detected'));
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS result_notes text;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS app_updated boolean DEFAULT false;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS db_updated boolean DEFAULT false;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS functions_updated boolean DEFAULT false;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS build_successful boolean;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS health_check_successful boolean;

-- ============================================================
-- 8. EXTEND PROJECT_DEPLOYMENT_STATE TABLE
-- ============================================================
ALTER TABLE project_deployment_state ADD COLUMN IF NOT EXISTS current_baseline_snapshot_id uuid REFERENCES deployment_snapshots(id) ON DELETE SET NULL;
ALTER TABLE project_deployment_state ADD COLUMN IF NOT EXISTS current_git_target_snapshot_id uuid REFERENCES deployment_snapshots(id) ON DELETE SET NULL;
ALTER TABLE project_deployment_state ADD COLUMN IF NOT EXISTS current_comparison_id uuid REFERENCES deployment_comparisons(id) ON DELETE SET NULL;

-- ============================================================
-- 9. CREATE STORAGE BUCKET
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('deployment-snapshots', 'deployment-snapshots', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 10. ENABLE RLS ON NEW TABLES
-- ============================================================
ALTER TABLE deployment_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_snapshot_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_comparison_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_command_steps ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 11. RLS POLICIES ON NEW TABLES
-- ============================================================

-- deployment_snapshots
DROP POLICY IF EXISTS "snapshots_scoped_select" ON deployment_snapshots;
CREATE POLICY "snapshots_scoped_select" ON deployment_snapshots
  FOR SELECT TO authenticated
  USING (has_project_access(project_id));

DROP POLICY IF EXISTS "snapshots_scoped_insert" ON deployment_snapshots;
CREATE POLICY "snapshots_scoped_insert" ON deployment_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "snapshots_scoped_update" ON deployment_snapshots;
CREATE POLICY "snapshots_scoped_update" ON deployment_snapshots
  FOR UPDATE TO authenticated
  USING (has_project_access(project_id)) WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "snapshots_scoped_delete" ON deployment_snapshots;
CREATE POLICY "snapshots_scoped_delete" ON deployment_snapshots
  FOR DELETE TO authenticated
  USING (has_project_access(project_id));

-- deployment_snapshot_files
DROP POLICY IF EXISTS "snap_files_scoped_select" ON deployment_snapshot_files;
CREATE POLICY "snap_files_scoped_select" ON deployment_snapshot_files
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM deployment_snapshots s
      WHERE s.id = snapshot_id AND has_project_access(s.project_id)
    )
  );

DROP POLICY IF EXISTS "snap_files_scoped_insert" ON deployment_snapshot_files;
CREATE POLICY "snap_files_scoped_insert" ON deployment_snapshot_files
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM deployment_snapshots s
      WHERE s.id = snapshot_id AND has_project_access(s.project_id)
    )
  );

DROP POLICY IF EXISTS "snap_files_scoped_delete" ON deployment_snapshot_files;
CREATE POLICY "snap_files_scoped_delete" ON deployment_snapshot_files
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM deployment_snapshots s
      WHERE s.id = snapshot_id AND has_project_access(s.project_id)
    )
  );

-- deployment_comparisons
DROP POLICY IF EXISTS "comparisons_scoped_select" ON deployment_comparisons;
CREATE POLICY "comparisons_scoped_select" ON deployment_comparisons
  FOR SELECT TO authenticated
  USING (has_project_access(project_id));

DROP POLICY IF EXISTS "comparisons_scoped_insert" ON deployment_comparisons;
CREATE POLICY "comparisons_scoped_insert" ON deployment_comparisons
  FOR INSERT TO authenticated
  WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "comparisons_scoped_delete" ON deployment_comparisons;
CREATE POLICY "comparisons_scoped_delete" ON deployment_comparisons
  FOR DELETE TO authenticated
  USING (has_project_access(project_id));

-- deployment_comparison_changes
DROP POLICY IF EXISTS "comp_changes_scoped_select" ON deployment_comparison_changes;
CREATE POLICY "comp_changes_scoped_select" ON deployment_comparison_changes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM deployment_comparisons c
      WHERE c.id = comparison_id AND has_project_access(c.project_id)
    )
  );

DROP POLICY IF EXISTS "comp_changes_scoped_insert" ON deployment_comparison_changes;
CREATE POLICY "comp_changes_scoped_insert" ON deployment_comparison_changes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM deployment_comparisons c
      WHERE c.id = comparison_id AND has_project_access(c.project_id)
    )
  );

DROP POLICY IF EXISTS "comp_changes_scoped_delete" ON deployment_comparison_changes;
CREATE POLICY "comp_changes_scoped_delete" ON deployment_comparison_changes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM deployment_comparisons c
      WHERE c.id = comparison_id AND has_project_access(c.project_id)
    )
  );

-- deployment_plans
DROP POLICY IF EXISTS "plans_scoped_select" ON deployment_plans;
CREATE POLICY "plans_scoped_select" ON deployment_plans
  FOR SELECT TO authenticated
  USING (has_project_access(project_id));

DROP POLICY IF EXISTS "plans_scoped_insert" ON deployment_plans;
CREATE POLICY "plans_scoped_insert" ON deployment_plans
  FOR INSERT TO authenticated
  WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "plans_scoped_delete" ON deployment_plans;
CREATE POLICY "plans_scoped_delete" ON deployment_plans
  FOR DELETE TO authenticated
  USING (has_project_access(project_id));

-- deployment_command_steps
DROP POLICY IF EXISTS "cmd_steps_scoped_select" ON deployment_command_steps;
CREATE POLICY "cmd_steps_scoped_select" ON deployment_command_steps
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM deployment_plans p
      WHERE p.id = plan_id AND has_project_access(p.project_id)
    )
  );

DROP POLICY IF EXISTS "cmd_steps_scoped_insert" ON deployment_command_steps;
CREATE POLICY "cmd_steps_scoped_insert" ON deployment_command_steps
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM deployment_plans p
      WHERE p.id = plan_id AND has_project_access(p.project_id)
    )
  );

DROP POLICY IF EXISTS "cmd_steps_scoped_update" ON deployment_command_steps;
CREATE POLICY "cmd_steps_scoped_update" ON deployment_command_steps
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM deployment_plans p
      WHERE p.id = plan_id AND has_project_access(p.project_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM deployment_plans p
      WHERE p.id = plan_id AND has_project_access(p.project_id)
    )
  );

DROP POLICY IF EXISTS "cmd_steps_scoped_delete" ON deployment_command_steps;
CREATE POLICY "cmd_steps_scoped_delete" ON deployment_command_steps
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM deployment_plans p
      WHERE p.id = plan_id AND has_project_access(p.project_id)
    )
  );

-- ============================================================
-- 12. STORAGE RLS POLICIES
-- ============================================================
DROP POLICY IF EXISTS "snapshots_storage_read" ON storage.objects;
CREATE POLICY "snapshots_storage_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'deployment-snapshots' AND
    has_project_access(split_part(name, '/', 1)::uuid)
  );

DROP POLICY IF EXISTS "snapshots_storage_upload" ON storage.objects;
CREATE POLICY "snapshots_storage_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'deployment-snapshots' AND
    has_project_access(split_part(name, '/', 1)::uuid)
  );

DROP POLICY IF EXISTS "snapshots_storage_delete" ON storage.objects;
CREATE POLICY "snapshots_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'deployment-snapshots' AND
    has_project_access(split_part(name, '/', 1)::uuid)
  );

-- ============================================================
-- 13. GRANT PERMISSIONS
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON deployment_snapshots TO authenticated;
GRANT SELECT, INSERT, DELETE ON deployment_snapshot_files TO authenticated;
GRANT SELECT, INSERT, DELETE ON deployment_comparisons TO authenticated;
GRANT SELECT, INSERT, DELETE ON deployment_comparison_changes TO authenticated;
GRANT SELECT, INSERT, DELETE ON deployment_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON deployment_command_steps TO authenticated;

-- ============================================================
-- 14. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_snapshots_project ON deployment_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_baseline ON deployment_snapshots(project_id, is_current_baseline) WHERE is_current_baseline = true;
CREATE INDEX IF NOT EXISTS idx_snap_files_snapshot ON deployment_snapshot_files(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snap_files_hash ON deployment_snapshot_files(file_hash);
CREATE INDEX IF NOT EXISTS idx_comparisons_project ON deployment_comparisons(project_id);
CREATE INDEX IF NOT EXISTS idx_comp_changes_comparison ON deployment_comparison_changes(comparison_id);
CREATE INDEX IF NOT EXISTS idx_plans_project ON deployment_plans(project_id);
CREATE INDEX IF NOT EXISTS idx_cmd_steps_plan ON deployment_command_steps(plan_id);
