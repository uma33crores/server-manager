import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export type Server = {
  id: string;
  name: string;
  environment: 'testing' | 'staging' | 'production';
  provider: string | null;
  public_ip: string | null;
  hostname: string | null;
  ssh_username: string | null;
  ssh_port: number;
  operating_system: string | null;
  region: string | null;
  ram: string | null;
  disk: string | null;
  supabase_template_directory: string;
  supabase_instances_directory: string;
  frontend_apps_directory: string;
  nginx_sites_available: string;
  nginx_sites_enabled: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  server_id: string;
  app_domain: string | null;
  supabase_domain: string | null;
  app_directory: string;
  supabase_directory: string;
  compose_name: string;
  project_slot: number;
  api_port: number;
  db_port: number;
  pooler_port: number;
  repository_url: string | null;
  git_branch: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  server?: { id: string; name: string; environment: string } | null;
};

export type ProjectWithServer = Project;

export type PortAllocation = {
  id: string;
  server_id: string;
  project_slot: number;
  api_port: number;
  db_port: number;
  pooler_port: number;
  status: 'available' | 'reserved' | 'assigned';
  project_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PortAllocationWithProject = PortAllocation & {
  project: { id: string; name: string; slug: string } | null;
};

export type ProjectSetupStep = {
  id: string;
  project_id: string;
  step_number: number;
  title: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked';
  command: string | null;
  notes: string | null;
  command_output: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SetupStepCommand = {
  id: string;
  setup_step_id: string;
  title: string;
  command_template: string;
  sort_order: number;
  is_sensitive: boolean;
  is_custom: boolean;
  created_at: string;
  updated_at: string;
};

export type ProjectSetupStepWithCommands = ProjectSetupStep & {
  setup_step_commands: SetupStepCommand[];
};

export type ConfigVariable = {
  id: string;
  scope: 'global' | 'server' | 'project';
  server_id: string | null;
  project_id: string | null;
  key: string;
  value: string;
  is_sensitive: boolean;
  description: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ConfigVariableWithRelations = ConfigVariable & {
  server: { id: string; name: string } | null;
  project: { id: string; name: string; slug: string } | null;
};

export type Command = {
  id: string;
  name: string;
  category: string | null;
  scope: 'global' | 'server' | 'project';
  server_id: string | null;
  project_id: string | null;
  command: string;
  description: string | null;
  notes: string | null;
  is_sensitive: boolean;
  created_at: string;
  updated_at: string;
};

export type CommandProjectAssignment = {
  command_id: string;
  project_id: string;
  created_at: string;
  project: { id: string; name: string; slug: string } | null;
};

export type CommandWithRelations = Command & {
  server: { id: string; name: string } | null;
  project: { id: string; name: string; slug: string } | null;
  command_variables: CommandVariable[];
  command_project_assignments: CommandProjectAssignment[];
};

export type CommandVariable = {
  id: string;
  command_id: string;
  key: string;
  value: string;
  is_sensitive: boolean;
  created_at: string;
  updated_at: string;
};

export type Credential = {
  id: string;
  scope: 'server' | 'project' | 'custom';
  server_id: string | null;
  project_id: string | null;
  type: string;
  name: string;
  value: string;
  is_sensitive: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CredentialWithRelations = Credential & {
  server: { id: string; name: string } | null;
  project: { id: string; name: string; slug: string } | null;
};

export type Note = {
  id: string;
  scope: 'server' | 'project';
  server_id: string | null;
  project_id: string | null;
  content: string;
  created_at: string;
  updated_at: string;
};

export type UserRole = {
  user_id: string;
  role: 'admin' | 'user';
  access_type: 'read_only' | 'write';
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ManagedUser = {
  id: string;
  email: string;
  role: 'admin' | 'user';
  access_type: 'read_only' | 'write';
  is_active: boolean;
  reverification_required: boolean;
  created_at: string;
  server_ids: string[];
  project_ids: string[];
};

export type AuditLog = {
  id: string;
  admin_id: string;
  admin_email: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  status: 'SUCCESS' | 'FAILURE';
  failure_reason: string | null;
  created_at: string;
};

export type Deployment = {
  id: string;
  project_id: string;
  url: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deployment_id?: string | null;
  environment?: string | null;
  previous_commit_sha?: string | null;
  target_commit_sha?: string | null;
  git_status?: string | null;
  started_by?: string | null;
  started_by_email?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  migration_count?: number | null;
  function_count?: number | null;
  frontend_changes?: number | null;
  backend_changes?: number | null;
  dependency_changes?: number | null;
  config_changes?: number | null;
  is_managed?: boolean | null;
  source_snapshot_id?: string | null;
  target_snapshot_id?: string | null;
  comparison_id?: string | null;
  plan_id?: string | null;
  method?: 'manual_commands' | 'deployment_package' | 'admin_confirmed' | null;
  verification_state?: 'unverified' | 'admin_confirmed' | 'snapshot_verified' | 'drift_detected' | null;
  result?: 'pending' | 'reported_successful' | 'partially_successful' | 'failed' | 'cancelled' | 'verified' | 'drift_detected' | null;
  result_notes?: string | null;
  app_updated?: boolean | null;
  db_updated?: boolean | null;
  functions_updated?: boolean | null;
  build_successful?: boolean | null;
  health_check_successful?: boolean | null;
};

export type ProjectDeploymentState = {
  project_id: string;
  production_commit_sha: string | null;
  production_branch: string | null;
  last_deployed_commit_sha: string | null;
  last_seen_remote_commit_sha: string | null;
  previous_remote_commit_sha: string | null;
  current_remote_commit_sha: string | null;
  git_status: string;
  working_tree_clean: boolean;
  baseline_initialized: boolean;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
  current_baseline_snapshot_id?: string | null;
  current_git_target_snapshot_id?: string | null;
  current_comparison_id?: string | null;
};

export type DeploymentSnapshot = {
  id: string;
  project_id: string;
  environment: 'testing' | 'staging' | 'production';
  source_type: 'environment' | 'git_target';
  label: string;
  description: string | null;
  known_git_commit: string | null;
  known_git_branch: string | null;
  deployment_date: string | null;
  notes: string | null;
  storage_path: string | null;
  file_count: number;
  total_size: number;
  verification_state: 'unverified' | 'admin_confirmed' | 'snapshot_verified' | 'drift_detected';
  is_current_baseline: boolean;
  is_archived: boolean;
  git_commit_sha: string | null;
  git_commit_message: string | null;
  git_commit_author: string | null;
  git_commit_date: string | null;
  git_fetch_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DeploymentSnapshotFile = {
  id: string;
  snapshot_id: string;
  relative_path: string;
  file_hash: string;
  file_size: number;
  file_type: string;
  category: string;
  area: 'application' | 'supabase';
};

export type DeploymentComparison = {
  id: string;
  project_id: string;
  source_snapshot_id: string;
  target_snapshot_id: string;
  total_changed: number;
  added_count: number;
  modified_count: number;
  deleted_count: number;
  unchanged_count: number;
  summary: Record<string, number>;
  created_by: string | null;
  created_at: string;
};

export type DeploymentComparisonChange = {
  id: string;
  comparison_id: string;
  relative_path: string;
  status: 'added' | 'modified' | 'deleted' | 'unchanged' | 'renamed';
  category: string;
  area: 'application' | 'supabase';
  source_hash: string | null;
  target_hash: string | null;
  source_size: number | null;
  target_size: number | null;
  is_binary: boolean;
};

export type DeploymentPlan = {
  id: string;
  project_id: string;
  comparison_id: string | null;
  plan_data: Record<string, unknown>[];
  created_by: string | null;
  created_at: string;
};

export type DeploymentCommandStep = {
  id: string;
  plan_id: string;
  step_number: number;
  title: string;
  purpose: string | null;
  command: string;
  risk_level: 'read_only' | 'backup' | 'file_change' | 'build' | 'database_change' | 'service_restart' | 'verification' | 'high_risk';
  expected_result: string | null;
  rollback_note: string | null;
  status: 'pending' | 'completed' | 'skipped' | 'failed';
  config_used: Record<string, unknown>;
};

export type DeploymentChange = {
  id: string;
  deployment_id: string | null;
  project_id: string;
  category: string;
  file_path: string;
  change_action: string;
  old_hash: string | null;
  new_hash: string | null;
  status: string;
  created_at: string;
};

export type DeploymentMigration = {
  id: string;
  deployment_id: string | null;
  project_id: string;
  migration_name: string;
  migration_hash: string | null;
  status: string;
  applied_at: string | null;
  created_at: string;
};

export type DeploymentFunction = {
  id: string;
  deployment_id: string | null;
  project_id: string;
  function_name: string;
  production_hash: string | null;
  target_hash: string | null;
  status: string;
  created_at: string;
};

export type DeploymentLog = {
  id: string;
  deployment_id: string | null;
  project_id: string;
  log_level: string;
  message: string;
  created_at: string;
};

export type GitChangeEvent = {
  id: string;
  project_id: string;
  branch: string | null;
  old_sha: string | null;
  new_sha: string | null;
  event_type: string;
  detected_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
};

export type ServerDocument = {
  id: string;
  server_id: string;
  title: string;
  description: string | null;
  file_path: string;
  file_name: string;
  file_size: number | null;
  file_type: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectDocument = {
  id: string;
  project_id: string;
  original_file_name: string;
  stored_file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type GitConnection = {
  id: string;
  project_id: string;
  repository_url: string;
  auth_method: 'ssh_deploy_key';
  connection_status: 'not_configured' | 'waiting_for_deploy_key' | 'connected' | 'auth_failed' | 'repo_unreachable' | 'config_error';
  public_key: string | null;
  key_fingerprint: string | null;
  key_created_at: string | null;
  last_connection_check: string | null;
  connection_error: string | null;
  selected_branch: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LoginSession = {
  id: string;
  user_id: string;
  user_email: string;
  user_role: string;
  event_type: 'LOGIN' | 'LOGOUT';
  ip_address: string | null;
  user_agent: string | null;
  session_id: string | null;
  status: 'SUCCESS' | 'FAILURE';
  failure_reason: string | null;
  created_at: string;
};
