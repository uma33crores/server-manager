// Deployment Manager Edge Function — Snapshot-based deployment tracking system
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  server_id: string;
  app_directory: string;
  supabase_directory: string;
  compose_name: string;
  project_slot: number;
  api_port: number;
  db_port: number;
  pooler_port: number;
  app_domain: string | null;
  supabase_domain: string | null;
  repository_url: string | null;
  git_branch: string | null;
}

interface ServerRow {
  id: string;
  name: string;
  environment: string;
  public_ip: string | null;
  hostname: string | null;
  ssh_username: string | null;
  ssh_port: number;
  frontend_apps_directory: string;
  nginx_sites_available: string;
  nginx_sites_enabled: string;
}

async function verifyUser(supabaseAdmin: ReturnType<typeof createClient>, authHeader: string | null) {
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user;
}

async function checkProjectAccess(supabaseAdmin: ReturnType<typeof createClient>, userId: string, projectId: string): Promise<boolean> {
  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role, is_active")
    .eq("user_id", userId)
    .maybeSingle();
  if (!roleRow || !roleRow.is_active) return false;
  if (roleRow.role === "admin") return true;
  const { data: access } = await supabaseAdmin
    .from("user_project_access")
    .select("project_id")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  return !!access;
}

async function getProjectWithServer(supabaseAdmin: ReturnType<typeof createClient>, projectId: string): Promise<{ project: ProjectRow; server: ServerRow } | null> {
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select(`
      id, name, slug, server_id, app_directory, supabase_directory, compose_name,
      project_slot, api_port, db_port, pooler_port, app_domain, supabase_domain,
      repository_url, git_branch
    `)
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;
  const { data: server } = await supabaseAdmin
    .from("servers")
    .select("id, name, environment, public_ip, hostname, ssh_username, ssh_port, frontend_apps_directory, nginx_sites_available, nginx_sites_enabled")
    .eq("id", (project as ProjectRow).server_id)
    .maybeSingle();
  if (!server) return null;
  return { project: project as ProjectRow, server: server as ServerRow };
}

async function logAudit(supabaseAdmin: ReturnType<typeof createClient>, userId: string, action: string, entityType: string, entityId: string | null, status: string = 'SUCCESS') {
  const { data: userData } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  let adminEmail = 'unknown';
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authUser?.user?.email) adminEmail = authUser.user.email;

  await supabaseAdmin.from("audit_logs").insert({
    admin_id: userId,
    admin_email: adminEmail,
    action,
    entity_type: entityType,
    entity_id: entityId,
    status,
    changes: userData ? { user_id: userId } : null,
  });
}

// ============================================================
// File classification
// ============================================================
function classifyFile(filePath: string): { category: string; area: string } {
  const lower = filePath.toLowerCase();
  const isSupabase = lower.startsWith("supabase/") || lower.includes("/supabase/");

  if (lower.includes("/migrations/") || lower.startsWith("supabase/migrations/")) return { category: "Database Migration", area: isSupabase ? "supabase" : "application" };
  if (lower.startsWith("supabase/functions/") || lower.includes("/functions/")) return { category: "Edge Function", area: "supabase" };

  const depFiles = ["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "composer.json", "composer.lock", "gemfile", "gemfile.lock", "requirements.txt", "pipfile", "pipfile.lock"];
  if (depFiles.some(f => lower === f || lower.endsWith("/" + f))) return { category: "Dependencies", area: isSupabase ? "supabase" : "application" };

  if (lower.endsWith(".tsx") || lower.endsWith(".jsx") || lower.endsWith(".vue") || lower.endsWith(".svelte") || lower.endsWith(".css") || lower.endsWith(".html") || lower.startsWith("src/")) return { category: "Frontend", area: "application" };
  if (lower.includes("/api/") || lower.includes("/services/") || lower.includes("/lib/") || lower.endsWith(".ts") || lower.endsWith(".js")) return { category: "Backend", area: "application" };
  if (lower.endsWith(".toml") || lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.endsWith(".json") || lower.includes("docker-compose") || lower.includes("vite.config") || lower.includes("nginx") || lower.includes(".env")) return { category: "Configuration", area: isSupabase ? "supabase" : "application" };
  if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".rst")) return { category: "Documentation", area: isSupabase ? "supabase" : "application" };
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".gif") || lower.endsWith(".svg") || lower.endsWith(".webp") || lower.endsWith(".ico")) return { category: "Asset", area: "application" };

  return { category: "Other", area: isSupabase ? "supabase" : "application" };
}

function isBinaryFile(filePath: string, fileSize: number): boolean {
  const lower = filePath.toLowerCase();
  const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".otf", ".pdf", ".zip", ".tar", ".gz", ".mp4", ".mp3", ".webm", ".exe", ".dll", ".so", ".bin"];
  if (binaryExts.some(ext => lower.endsWith(ext))) return true;
  return fileSize > 512 * 1024;
}

// ============================================================
// Comparison engine
// ============================================================
async function handleCompareSnapshots(
  supabaseAdmin: ReturnType<typeof createClient>,
  projectId: string,
  userId: string,
  sourceSnapshotId: string,
  targetSnapshotId: string
): Promise<unknown> {
  // Check for existing comparison
  const { data: existing } = await supabaseAdmin
    .from("deployment_comparisons")
    .select("id")
    .eq("source_snapshot_id", sourceSnapshotId)
    .eq("target_snapshot_id", targetSnapshotId)
    .maybeSingle();

  if (existing) {
    return { comparisonId: (existing as { id: string }).id, cached: true };
  }

  // Fetch file manifests
  const { data: sourceFiles } = await supabaseAdmin
    .from("deployment_snapshot_files")
    .select("relative_path, file_hash, file_size, category, area")
    .eq("snapshot_id", sourceSnapshotId);

  const { data: targetFiles } = await supabaseAdmin
    .from("deployment_snapshot_files")
    .select("relative_path, file_hash, file_size, category, area")
    .eq("snapshot_id", targetSnapshotId);

  const sourceMap = new Map<string, { hash: string; size: number; category: string; area: string }>();
  for (const f of (sourceFiles ?? []) as { relative_path: string; file_hash: string; file_size: number; category: string; area: string }[]) {
    sourceMap.set(f.relative_path, { hash: f.file_hash, size: f.file_size, category: f.category, area: f.area });
  }

  const targetMap = new Map<string, { hash: string; size: number; category: string; area: string }>();
  for (const f of (targetFiles ?? []) as { relative_path: string; file_hash: string; file_size: number; category: string; area: string }[]) {
    targetMap.set(f.relative_path, { hash: f.file_hash, size: f.file_size, category: f.category, area: f.area });
  }

  const allPaths = new Set([...sourceMap.keys(), ...targetMap.keys()]);
  const changes: {
    relative_path: string;
    status: string;
    category: string;
    area: string;
    source_hash: string | null;
    target_hash: string | null;
    source_size: number | null;
    target_size: number | null;
    is_binary: boolean;
  }[] = [];

  let added = 0, modified = 0, deleted = 0, unchanged = 0;
  const summary: Record<string, number> = {
    Frontend: 0, Backend: 0, "Database Migration": 0, "Edge Function": 0,
    Dependencies: 0, Configuration: 0, Asset: 0, Documentation: 0, Other: 0,
  };

  for (const path of allPaths) {
    const src = sourceMap.get(path);
    const tgt = targetMap.get(path);
    let status: string;
    let category: string;
    let area: string;

    if (!src && tgt) {
      status = "added";
      category = tgt.category;
      area = tgt.area;
      added++;
      if (category in summary) summary[category]++;
    } else if (src && !tgt) {
      status = "deleted";
      category = src.category;
      area = src.area;
      deleted++;
      if (category in summary) summary[category]++;
    } else if (src && tgt && src.hash !== tgt.hash) {
      status = "modified";
      category = tgt.category;
      area = tgt.area;
      modified++;
      if (category in summary) summary[category]++;
    } else {
      status = "unchanged";
      category = tgt?.category ?? src?.category ?? "Other";
      area = tgt?.area ?? src?.area ?? "application";
      unchanged++;
      continue; // Don't store unchanged files to save space
    }

    changes.push({
      relative_path: path,
      status,
      category,
      area,
      source_hash: src?.hash ?? null,
      target_hash: tgt?.hash ?? null,
      source_size: src?.size ?? null,
      target_size: tgt?.size ?? null,
      is_binary: isBinaryFile(path, (tgt?.size ?? src?.size ?? 0)),
    });
  }

  const totalChanged = added + modified + deleted;

  // Insert comparison
  const { data: comparison, error: compError } = await supabaseAdmin
    .from("deployment_comparisons")
    .insert({
      project_id: projectId,
      source_snapshot_id: sourceSnapshotId,
      target_snapshot_id: targetSnapshotId,
      total_changed: totalChanged,
      added_count: added,
      modified_count: modified,
      deleted_count: deleted,
      unchanged_count: unchanged,
      summary,
      created_by: userId,
    })
    .select("id")
    .single();

  if (compError) throw new Error("Failed to create comparison: " + compError.message);

  // Insert changes in batches
  const comparisonId = (comparison as { id: string }).id;
  const batchSize = 500;
  for (let i = 0; i < changes.length; i += batchSize) {
    const batch = changes.slice(i, i + batchSize).map(c => ({ ...c, comparison_id: comparisonId }));
    await supabaseAdmin
      .from("deployment_comparison_changes")
      .insert(batch);
  }

  // Update project deployment state
  await supabaseAdmin
    .from("project_deployment_state")
    .upsert({
      project_id: projectId,
      current_comparison_id: comparisonId,
      last_checked_at: new Date().toISOString(),
    }, { onConflict: "project_id" });

  await logAudit(supabaseAdmin, userId, "comparison_created", "deployment_comparisons", comparisonId);

  return {
    comparisonId,
    totalChanged,
    added,
    modified,
    deleted,
    unchanged,
    summary,
    cached: false,
  };
}

// ============================================================
// Deployment plan generator
// ============================================================
async function handleGeneratePlan(
  supabaseAdmin: ReturnType<typeof createClient>,
  projectId: string,
  userId: string,
  comparisonId: string,
): Promise<unknown> {
  const { data: comparison } = await supabaseAdmin
    .from("deployment_comparisons")
    .select("*")
    .eq("id", comparisonId)
    .maybeSingle();
  if (!comparison) return { error: "Comparison not found" };

  const comp = comparison as { summary: Record<string, number>; total_changed: number; added_count: number; modified_count: number; deleted_count: number };

  const { data: changes } = await supabaseAdmin
    .from("deployment_comparison_changes")
    .select("relative_path, status, category, area")
    .eq("comparison_id", comparisonId)
    .in("status", ["added", "modified", "deleted"]);

  const changeList = (changes ?? []) as { relative_path: string; status: string; category: string; area: string }[];

  const hasFrontend = changeList.some(c => c.category === "Frontend");
  const hasBackend = changeList.some(c => c.category === "Backend");
  const hasMigrations = changeList.some(c => c.category === "Database Migration");
  const hasEdgeFunctions = changeList.some(c => c.category === "Edge Function");
  const hasDependencies = changeList.some(c => c.category === "Dependencies");
  const hasConfig = changeList.some(c => c.category === "Configuration");

  const planSteps: {
    step: number;
    title: string;
    purpose: string;
    skip: boolean;
    risk_level: string;
    expected_result: string;
    rollback_note: string;
  }[] = [];

  let step = 1;
  planSteps.push({
    step: step++,
    title: "Verify Server and Project Context",
    purpose: "Confirm you are on the correct server and in the correct project directory.",
    skip: false,
    risk_level: "read_only",
    expected_result: "Server hostname and project directory confirmed.",
    rollback_note: "No changes made — nothing to roll back.",
  });

  planSteps.push({
    step: step++,
    title: "Check Disk Space",
    purpose: "Ensure sufficient disk space for backup and deployment.",
    skip: false,
    risk_level: "read_only",
    expected_result: "At least 20% free disk space available.",
    rollback_note: "No changes made — nothing to roll back.",
  });

  planSteps.push({
    step: step++,
    title: "Create Application Backup",
    purpose: "Create a backup of the current application directory before making changes.",
    skip: false,
    risk_level: "backup",
    expected_result: "Backup archive created in a safe location.",
    rollback_note: "If deployment fails, restore from the backup archive.",
  });

  if (hasDependencies) {
    planSteps.push({
      step: step++,
      title: "Install Dependencies",
      purpose: "Install or update npm/dependency packages as required by the target version.",
      skip: false,
      risk_level: "build",
      expected_result: "Dependencies installed successfully with no errors.",
      rollback_note: "Restore package.json and lock files from backup, then reinstall.",
    });
  } else {
    planSteps.push({
      step: step++,
      title: "Install Dependencies",
      purpose: "No dependency file changes detected.",
      skip: true,
      risk_level: "read_only",
      expected_result: "SKIP — No dependency changes.",
      rollback_note: "N/A",
    });
  }

  if (hasFrontend || hasBackend) {
    planSteps.push({
      step: step++,
      title: "Build Application",
      purpose: "Build the application for production if the project requires a build step.",
      skip: false,
      risk_level: "build",
      expected_result: "Build completes successfully with no errors.",
      rollback_note: "Restore previous build output from backup.",
    });
  } else {
    planSteps.push({
      step: step++,
      title: "Build Application",
      purpose: "No frontend or backend source changes detected.",
      skip: true,
      risk_level: "read_only",
      expected_result: "SKIP — No source changes requiring build.",
      rollback_note: "N/A",
    });
  }

  if (hasMigrations) {
    planSteps.push({
      step: step++,
      title: "Review and Apply Database Migrations",
      purpose: "Review migration files carefully. Apply new migrations only. NEVER modify or re-run existing migrations. If an existing migration was modified, seek expert review.",
      skip: false,
      risk_level: "database_change",
      expected_result: "New migrations applied successfully. Database schema updated.",
      rollback_note: "Do NOT automatically roll back migrations. Consult a database administrator if migration fails.",
    });
  } else {
    planSteps.push({
      step: step++,
      title: "Review and Apply Database Migrations",
      purpose: "No database migration file changes detected.",
      skip: true,
      risk_level: "read_only",
      expected_result: "SKIP — No migration changes.",
      rollback_note: "N/A",
    });
  }

  if (hasEdgeFunctions) {
    planSteps.push({
      step: step++,
      title: "Update Edge Functions",
      purpose: "Copy changed Edge Function files to the Supabase functions directory. Only update functions that changed.",
      skip: false,
      risk_level: "file_change",
      expected_result: "Changed Edge Functions deployed. Functions service reloaded if needed.",
      rollback_note: "Restore previous function files from backup.",
    });
  } else {
    planSteps.push({
      step: step++,
      title: "Update Edge Functions",
      purpose: "No Edge Function changes detected.",
      skip: true,
      risk_level: "read_only",
      expected_result: "SKIP — No Edge Function changes.",
      rollback_note: "N/A",
    });
  }

  planSteps.push({
    step: step++,
    title: "Switch Application Release",
    purpose: "Switch the active release to the new build. Use symlink swap or directory rename depending on your setup.",
    skip: false,
    risk_level: "file_change",
    expected_result: "New application version is live.",
    rollback_note: "Switch symlink back to previous release directory.",
  });

  if (hasConfig) {
    planSteps.push({
      step: step++,
      title: "Reload Service Configuration",
      purpose: "Reload Nginx or relevant services if configuration files changed.",
      skip: false,
      risk_level: "service_restart",
      expected_result: "Service reloaded successfully with valid configuration.",
      rollback_note: "Restore previous configuration and reload service.",
    });
  }

  planSteps.push({
    step: step++,
    title: "Validate Application URL",
    purpose: "Verify the application is responding correctly after deployment.",
    skip: false,
    risk_level: "verification",
    expected_result: "Application URL returns expected response.",
    rollback_note: "If URL check fails, switch back to previous release.",
  });

  planSteps.push({
    step: step++,
    title: "Upload Post-Deployment Snapshot",
    purpose: "Create a new environment snapshot from the server and upload it to Server Manager for verification.",
    skip: false,
    risk_level: "verification",
    expected_result: "Post-deployment snapshot uploaded and compared against Git target.",
    rollback_note: "N/A — This is a verification step.",
  });

  // Save plan
  const { data: plan, error: planError } = await supabaseAdmin
    .from("deployment_plans")
    .insert({
      project_id: projectId,
      comparison_id: comparisonId,
      plan_data: planSteps as unknown as Record<string, unknown>[],
      created_by: userId,
    })
    .select("id")
    .single();

  if (planError) throw new Error("Failed to save plan: " + planError.message);
  const planId = (plan as { id: string }).id;

  await logAudit(supabaseAdmin, userId, "plan_generated", "deployment_plans", planId);

  return { planId, steps: planSteps };
}

// ============================================================
// Manual command generator
// ============================================================
async function handleGenerateCommands(
  supabaseAdmin: ReturnType<typeof createClient>,
  projectId: string,
  userId: string,
  planId: string,
): Promise<unknown> {
  const { data: plan } = await supabaseAdmin
    .from("deployment_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return { error: "Plan not found" };

  const projectData = await getProjectWithServer(supabaseAdmin, projectId);
  if (!projectData) return { error: "Project or server not found" };
  const { project, server } = projectData;

  // Validate required configuration
  const missing: string[] = [];
  if (!project.app_directory) missing.push("Application Directory (app_directory)");
  if (!project.supabase_directory) missing.push("Supabase Directory (supabase_directory)");
  if (!project.compose_name) missing.push("Compose Name (compose_name)");
  if (!project.app_domain) missing.push("Application URL (app_domain)");

  if (missing.length > 0) {
    return {
      error: "Missing required project configuration",
      missing,
      hint: "Configure these fields in the Project settings before generating commands.",
    };
  }

  const appDir = project.app_directory;
  const supabaseDir = project.supabase_directory;
  const composeName = project.compose_name;
  const appDomain = project.app_domain;
  const supabaseDomain = project.supabase_domain;
  const branch = project.git_branch || "main";
  const env = server.environment;

  // Build commands
  const cmdSteps: {
    step_number: number;
    title: string;
    purpose: string | null;
    command: string;
    risk_level: string;
    expected_result: string | null;
    rollback_note: string | null;
    config_used: Record<string, unknown>;
  }[] = [];

  // Step 1: Verify context
  cmdSteps.push({
    step_number: 1,
    title: "Verify Server and Project Context",
    purpose: "Confirm you are on the correct server and in the right directory.",
    command: `hostname && pwd && ls -la ${appDir}`,
    risk_level: "read_only",
    expected_result: "Server hostname and project directory confirmed.",
    rollback_note: "No changes made — nothing to roll back.",
    config_used: { app_directory: appDir, server_name: server.name, environment: env },
  });

  // Step 2: Check disk space
  cmdSteps.push({
    step_number: 2,
    title: "Check Disk Space",
    purpose: "Ensure sufficient disk space for backup and deployment.",
    command: `df -h ${appDir} | tail -1`,
    risk_level: "read_only",
    expected_result: "At least 20% free disk space available.",
    rollback_note: "No changes made — nothing to roll back.",
    config_used: { app_directory: appDir },
  });

  // Step 3: Create backup
  const backupDir = `${appDir}/../backups`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  cmdSteps.push({
    step_number: 3,
    title: "Create Application Backup",
    purpose: "Create a backup of the current application directory.",
    command: `mkdir -p ${backupDir} && tar -czf ${backupDir}/${project.slug}-${timestamp}.tar.gz -C ${appDir} . && echo "Backup created: ${backupDir}/${project.slug}-${timestamp}.tar.gz"`,
    risk_level: "backup",
    expected_result: "Backup archive created successfully.",
    rollback_note: `If deployment fails, restore with: tar -xzf ${backupDir}/${project.slug}-${timestamp}.tar.gz -C ${appDir}`,
    config_used: { app_directory: appDir, backup_directory: backupDir, project_slug: project.slug },
  });

  // Step 4: Install dependencies (if needed)
  cmdSteps.push({
    step_number: 4,
    title: "Install Dependencies",
    purpose: "Install or update npm packages as required by the target version.",
    command: `cd ${appDir} && npm ci`,
    risk_level: "build",
    expected_result: "Dependencies installed successfully.",
    rollback_note: "Restore package.json and package-lock.json from backup, then run npm ci again.",
    config_used: { app_directory: appDir },
  });

  // Step 5: Build application
  cmdSteps.push({
    step_number: 5,
    title: "Build Application",
    purpose: "Build the application for production.",
    command: `cd ${appDir} && npm run build`,
    risk_level: "build",
    expected_result: "Build completes successfully.",
    rollback_note: "Restore previous build output from backup.",
    config_used: { app_directory: appDir },
  });

  // Step 6: Review migrations
  cmdSteps.push({
    step_number: 6,
    title: "Review and Apply Database Migrations",
    purpose: "Review migration files. Apply ONLY new migrations. NEVER modify existing migrations.",
    command: `ls -la ${appDir}/supabase/migrations/ 2>/dev/null || echo "No migrations directory found"`,
    risk_level: "database_change",
    expected_result: "Migration files reviewed. New migrations identified.",
    rollback_note: "Do NOT automatically roll back migrations. Consult a DBA if migration fails.",
    config_used: { app_directory: appDir, supabase_directory: supabaseDir },
  });

  // Step 7: Update edge functions
  cmdSteps.push({
    step_number: 7,
    title: "Update Edge Functions",
    purpose: "Copy changed Edge Function files to the Supabase functions directory.",
    command: `ls -la ${supabaseDir}/volumes/functions/ 2>/dev/null || echo "No functions directory found"`,
    risk_level: "file_change",
    expected_result: "Changed Edge Functions identified and ready to copy.",
    rollback_note: "Restore previous function files from backup.",
    config_used: { supabase_directory: supabaseDir },
  });

  // Step 8: Switch release
  cmdSteps.push({
    step_number: 8,
    title: "Switch Application Release",
    purpose: "Restart the application service or switch the symlink to the new build.",
    command: `cd ${appDir} && pm2 restart ${project.slug} 2>/dev/null || docker compose -f ${supabaseDir}/docker-compose.yml restart frontend 2>/dev/null || echo "Manual service restart required"`,
    risk_level: "service_restart",
    expected_result: "Application service restarted with new build.",
    rollback_note: "Restart with the previous build or restore from backup.",
    config_used: { app_directory: appDir, compose_name: composeName, project_slug: project.slug },
  });

  // Step 9: Reload Nginx if config changed
  cmdSteps.push({
    step_number: 9,
    title: "Reload Service Configuration",
    purpose: "Reload Nginx if configuration files changed.",
    command: `nginx -t && systemctl reload nginx`,
    risk_level: "service_restart",
    expected_result: "Nginx configuration valid and reloaded.",
    rollback_note: "Restore previous Nginx configuration and reload.",
    config_used: { nginx_sites_available: server.nginx_sites_available },
  });

  // Step 10: Validate URLs
  cmdSteps.push({
    step_number: 10,
    title: "Validate Application URL",
    purpose: "Verify the application is responding.",
    command: `curl -sI ${appDomain} | head -5`,
    risk_level: "verification",
    expected_result: "HTTP 200 or expected response from application URL.",
    rollback_note: "If URL check fails, switch back to previous release.",
    config_used: { app_domain: appDomain },
  });

  if (supabaseDomain) {
    cmdSteps.push({
      step_number: 11,
      title: "Validate Supabase URL",
      purpose: "Verify Supabase services are responding.",
      command: `curl -sI ${supabaseDomain} | head -5`,
      risk_level: "verification",
      expected_result: "HTTP 200 or expected response from Supabase URL.",
      rollback_note: "Check Supabase Docker services if URL check fails.",
      config_used: { supabase_domain: supabaseDomain },
    });
  }

  // Step 12: Inspect logs
  cmdSteps.push({
    step_number: supabaseDomain ? 12 : 11,
    title: "Inspect Application Logs",
    purpose: "Check application logs for errors after deployment.",
    command: `cd ${appDir} && tail -50 logs/*.log 2>/dev/null || journalctl -u ${project.slug} --no-pager -n 50 2>/dev/null || echo "Check logs manually"`,
    risk_level: "read_only",
    expected_result: "No errors in recent application logs.",
    rollback_note: "N/A — This is a verification step.",
    config_used: { app_directory: appDir, project_slug: project.slug },
  });

  // Step 13: Create snapshot command
  cmdSteps.push({
    step_number: supabaseDomain ? 13 : 12,
    title: "Create Post-Deployment Snapshot",
    purpose: "Create a snapshot of the deployed files for verification in Server Manager.",
    command: `cd ${appDir} && tar -czf /tmp/${project.slug}-snapshot-${timestamp}.tar.gz --exclude='.git' --exclude='node_modules' --exclude='logs' --exclude='.cache' --exclude='.env.local' --exclude='.env.production' . && echo "Snapshot created: /tmp/${project.slug}-snapshot-${timestamp}.tar.gz"`,
    risk_level: "read_only",
    expected_result: "Snapshot archive created for upload to Server Manager.",
    rollback_note: "N/A — This is a verification step.",
    config_used: { app_directory: appDir, project_slug: project.slug },
  });

  // Insert command steps
  const stepsToInsert = cmdSteps.map(s => ({
    ...s,
    plan_id: planId,
    config_used: s.config_used as unknown as Record<string, unknown>,
  }));

  await supabaseAdmin
    .from("deployment_command_steps")
    .insert(stepsToInsert);

  await logAudit(supabaseAdmin, userId, "commands_generated", "deployment_plans", planId);

  return { planId, steps: cmdSteps };
}

// ============================================================
// Get state
// ============================================================
async function handleGetState(supabaseAdmin: ReturnType<typeof createClient>, projectId: string): Promise<unknown> {
  const { data: state } = await supabaseAdmin
    .from("project_deployment_state")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();

  const { data: snapshots } = await supabaseAdmin
    .from("deployment_snapshots")
    .select("*")
    .eq("project_id", projectId)
    .eq("is_archived", false)
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: comparisons } = await supabaseAdmin
    .from("deployment_comparisons")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: deployments } = await supabaseAdmin
    .from("deployments")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: lastDeployment } = await supabaseAdmin
    .from("deployments")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: gitEvents } = await supabaseAdmin
    .from("git_change_events")
    .select("*")
    .eq("project_id", projectId)
    .is("acknowledged_at", null)
    .order("detected_at", { ascending: false })
    .limit(10);

  const { data: gitConnection } = await supabaseAdmin
    .from("git_connections")
    .select("id, project_id, repository_url, auth_method, connection_status, public_key, key_fingerprint, key_created_at, last_connection_check, connection_error, selected_branch, created_at, updated_at")
    .eq("project_id", projectId)
    .maybeSingle();

  const s = state as { current_baseline_snapshot_id?: string | null; current_git_target_snapshot_id?: string | null; current_comparison_id?: string | null } | null;

  // Get baseline snapshot
  let baselineSnapshot = null;
  if (s?.current_baseline_snapshot_id) {
    const { data } = await supabaseAdmin
      .from("deployment_snapshots")
      .select("*")
      .eq("id", s.current_baseline_snapshot_id)
      .maybeSingle();
    baselineSnapshot = data;
  }

  // Get git target snapshot
  let gitTargetSnapshot = null;
  if (s?.current_git_target_snapshot_id) {
    const { data } = await supabaseAdmin
      .from("deployment_snapshots")
      .select("*")
      .eq("id", s.current_git_target_snapshot_id)
      .maybeSingle();
    gitTargetSnapshot = data;
  }

  // Get current comparison
  let currentComparison = null;
  let comparisonChanges: unknown[] = [];
  if (s?.current_comparison_id) {
    const { data } = await supabaseAdmin
      .from("deployment_comparisons")
      .select("*")
      .eq("id", s.current_comparison_id)
      .maybeSingle();
    currentComparison = data;

    const { data: changes } = await supabaseAdmin
      .from("deployment_comparison_changes")
      .select("*")
      .eq("comparison_id", s.current_comparison_id)
      .order("relative_path", { ascending: true });
    comparisonChanges = changes ?? [];
  }

  return {
    state: s,
    baselineSnapshot,
    gitTargetSnapshot,
    currentComparison,
    comparisonChanges,
    snapshots: snapshots ?? [],
    comparisons: comparisons ?? [],
    deployments: deployments ?? [],
    lastDeployment: lastDeployment ?? null,
    unacknowledgedGitEvents: gitEvents ?? [],
    gitConnection: gitConnection ?? null,
  };
}

// ============================================================
// Get comparison detail
// ============================================================
async function handleGetComparisonDetail(supabaseAdmin: ReturnType<typeof createClient>, comparisonId: string): Promise<unknown> {
  const { data: comparison } = await supabaseAdmin
    .from("deployment_comparisons")
    .select("*")
    .eq("id", comparisonId)
    .maybeSingle();
  if (!comparison) return { error: "Comparison not found" };

  const { data: changes } = await supabaseAdmin
    .from("deployment_comparison_changes")
    .select("*")
    .eq("comparison_id", comparisonId)
    .order("relative_path", { ascending: true });

  return {
    comparison,
    changes: changes ?? [],
  };
}

// ============================================================
// Set baseline
// ============================================================
async function handleSetBaseline(
  supabaseAdmin: ReturnType<typeof createClient>,
  projectId: string,
  userId: string,
  snapshotId: string,
  verificationType: "admin_confirmed" | "snapshot_verified",
): Promise<unknown> {
  // Clear previous baseline flag
  await supabaseAdmin
    .from("deployment_snapshots")
    .update({ is_current_baseline: false })
    .eq("project_id", projectId)
    .eq("is_current_baseline", true);

  // Set new baseline
  await supabaseAdmin
    .from("deployment_snapshots")
    .update({
      is_current_baseline: true,
      verification_state: verificationType,
    })
    .eq("id", snapshotId);

  // Update state
  await supabaseAdmin
    .from("project_deployment_state")
    .upsert({
      project_id: projectId,
      current_baseline_snapshot_id: snapshotId,
      baseline_initialized: true,
      last_checked_at: new Date().toISOString(),
    }, { onConflict: "project_id" });

  await logAudit(supabaseAdmin, userId, "baseline_changed", "deployment_snapshots", snapshotId);

  return { success: true, snapshotId, verificationType };
}

// ============================================================
// Set Git Target (from uploaded ZIP — SSH-only, no GITHUB_TOKEN)
// ============================================================
async function handleSetGitTarget(
  supabaseAdmin: ReturnType<typeof createClient>,
  projectId: string,
  userId: string,
  snapshotId: string,
  commitSha: string | null,
  branch: string | null,
  historyRewritten: boolean,
): Promise<unknown> {
  const { data: prevState } = await supabaseAdmin
    .from("project_deployment_state")
    .select("current_remote_commit_sha")
    .eq("project_id", projectId)
    .maybeSingle();

  const prevGitSha = (prevState as { current_remote_commit_sha?: string | null })?.current_remote_commit_sha ?? null;

  await supabaseAdmin
    .from("project_deployment_state")
    .upsert({
      project_id: projectId,
      current_git_target_snapshot_id: snapshotId,
      current_remote_commit_sha: commitSha,
      previous_remote_commit_sha: prevGitSha,
      git_status: historyRewritten ? "HISTORY_REWRITE" : "SYNCED",
      last_checked_at: new Date().toISOString(),
    }, { onConflict: "project_id" });

  if (historyRewritten && commitSha) {
    await supabaseAdmin.from("git_change_events").insert({
      project_id: projectId,
      branch: branch ?? "unknown",
      old_sha: prevGitSha,
      new_sha: commitSha,
      event_type: "rewrite",
    });
  }

  if (branch) {
    await supabaseAdmin
      .from("git_connections")
      .update({ selected_branch: branch })
      .eq("project_id", projectId);
  }

  await logAudit(supabaseAdmin, userId, "git_target_set", "deployment_snapshots", snapshotId);

  return { success: true, snapshotId, commitSha, branch, historyRewritten };
}

// ============================================================
// Acknowledge git event
// ============================================================
async function handleAcknowledgeGitEvent(supabaseAdmin: ReturnType<typeof createClient>, userId: string, eventId: string): Promise<unknown> {
  const { error } = await supabaseAdmin
    .from("git_change_events")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: userId })
    .eq("id", eventId);
  if (error) return { error: error.message };
  return { acknowledged: true };
}

// ============================================================
// Main handler
// ============================================================
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authHeader = req.headers.get("Authorization");
  const user = await verifyUser(supabaseAdmin, authHeader);
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "get-state";
    let projectId = url.searchParams.get("projectId");

    if (!projectId && req.method === "POST") {
      const body = await req.json() as Record<string, unknown>;
      projectId = (body.projectId as string) || projectId;
    }

    if (!projectId && action !== "get-comparison-detail" && action !== "acknowledge-git-event") {
      return jsonError("Missing projectId");
    }

    if (projectId) {
      const hasAccess = await checkProjectAccess(supabaseAdmin, user.id, projectId);
      if (!hasAccess) {
        return jsonError("Unauthorized: no project access", 403);
      }
    }

    switch (action) {
      case "get-state":
        return jsonResponse(await handleGetState(supabaseAdmin, projectId!));

      case "get-comparison-detail": {
        const compId = url.searchParams.get("comparisonId");
        if (!compId) return jsonError("Missing comparisonId");
        return jsonResponse(await handleGetComparisonDetail(supabaseAdmin, compId));
      }

      case "acknowledge-git-event": {
        const eventId = url.searchParams.get("eventId");
        if (!eventId) return jsonError("Missing eventId");
        return jsonResponse(await handleAcknowledgeGitEvent(supabaseAdmin, user.id, eventId));
      }

      case "compare-snapshots": {
        const body = await req.json() as Record<string, unknown>;
        const sourceSnapshotId = body.sourceSnapshotId as string;
        const targetSnapshotId = body.targetSnapshotId as string;
        if (!sourceSnapshotId || !targetSnapshotId) return jsonError("Missing sourceSnapshotId or targetSnapshotId");
        return jsonResponse(await handleCompareSnapshots(supabaseAdmin, projectId!, user.id, sourceSnapshotId, targetSnapshotId));
      }

      case "generate-plan": {
        const body = await req.json() as Record<string, unknown>;
        const comparisonId = body.comparisonId as string;
        if (!comparisonId) return jsonError("Missing comparisonId");
        return jsonResponse(await handleGeneratePlan(supabaseAdmin, projectId!, user.id, comparisonId));
      }

      case "generate-commands": {
        const body = await req.json() as Record<string, unknown>;
        const planId = body.planId as string;
        if (!planId) return jsonError("Missing planId");
        return jsonResponse(await handleGenerateCommands(supabaseAdmin, projectId!, user.id, planId));
      }

      case "set-baseline": {
        const body = await req.json() as Record<string, unknown>;
        const snapshotId = body.snapshotId as string;
        const verificationType = (body.verificationType as "admin_confirmed" | "snapshot_verified") || "admin_confirmed";
        if (!snapshotId) return jsonError("Missing snapshotId");
        return jsonResponse(await handleSetBaseline(supabaseAdmin, projectId!, user.id, snapshotId, verificationType));
      }

      case "set-git-target": {
        const body = await req.json() as Record<string, unknown>;
        const snapshotId = body.snapshotId as string;
        const commitSha = (body.commitSha as string | null) ?? null;
        const branch = (body.branch as string | null) ?? null;
        const historyRewritten = body.historyRewritten === true;
        if (!snapshotId) return jsonError("Missing snapshotId");
        return jsonResponse(await handleSetGitTarget(supabaseAdmin, projectId!, user.id, snapshotId, commitSha, branch, historyRewritten));
      }

      default:
        return jsonError("Unknown action: " + action, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(message, 500);
  }
});
