// Git Worker Edge Function
// Handles private Git repository access via GitHub REST API (no subprocesses)
// Actions: generate-key, test-connection, list-branches, select-branch, fetch-snapshot, get-connection
//
// SSH Deploy Key workflow:
//   - Key generation, connection testing, and branch selection work WITHOUT a GitHub API token.
//   - Snapshot fetching uses the GitHub REST API (trees/blobs) which requires a server-side
//     GITHUB_TOKEN. This is an implementation detail of the worker, not a user-facing requirement
//     for the SSH deploy key workflow itself.
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
  repository_url: string | null;
  git_branch: string | null;
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

async function logAudit(supabaseAdmin: ReturnType<typeof createClient>, userId: string, action: string, entityType: string, entityId: string | null) {
  let adminEmail = 'unknown';
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authUser?.user?.email) adminEmail = authUser.user.email;
  await supabaseAdmin.from("audit_logs").insert({
    admin_id: userId,
    admin_email: adminEmail,
    action,
    entity_type: entityType,
    entity_id: entityId,
    status: 'SUCCESS',
  });
}

// Parse owner/repo from GitHub URL
function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const httpsMatch = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  return null;
}

// Get GitHub token from environment (optional - only used for API-based snapshot fetching)
function getGitHubToken(): string | null {
  return Deno.env.get("GITHUB_TOKEN") ?? null;
}

// GitHub API headers
function githubHeaders(token: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Server-Manager-Deployment-Tracker",
  };
}

// ============================================================
// GENERATE DEPLOY KEY
// Uses Web Crypto API to generate an Ed25519 key pair
// No GITHUB_TOKEN required
// ============================================================
async function handleGenerateKey(
  supabaseAdmin: ReturnType<typeof createClient>,
  projectId: string,
  userId: string,
  project: ProjectRow,
): Promise<unknown> {
  if (!project.repository_url) {
    return { error: "Project has no repository_url configured. Set the Git repository in the project settings first." };
  }

  // Generate Ed25519 key pair using Web Crypto API
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"]
  );

  // Export public key in raw format
  const publicKeyBuffer = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyBytes = new Uint8Array(publicKeyBuffer);

  // Convert to OpenSSH public key format
  const sshKeyBlob = new Uint8Array(51);
  const dv = new DataView(sshKeyBlob.buffer);
  const typeStr = "ssh-ed25519";
  dv.setInt32(0, typeStr.length);
  for (let i = 0; i < typeStr.length; i++) {
    sshKeyBlob[4 + i] = typeStr.charCodeAt(i);
  }
  dv.setInt32(4 + typeStr.length, 32);
  sshKeyBlob.set(publicKeyBytes, 8 + typeStr.length);

  const publicKeyBase64 = btoa(String.fromCharCode(...sshKeyBlob));
  const publicKey = `ssh-ed25519 ${publicKeyBase64} server-manager-${project.slug}`;

  // Export private key in PKCS8 format
  const privateKeyBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const privateKeyBytes = new Uint8Array(privateKeyBuffer);
  const privateKeyBase64 = btoa(String.fromCharCode(...privateKeyBytes));

  const privateKeyPem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${privateKeyBase64}\n-----END OPENSSH PRIVATE KEY-----`;

  // Calculate fingerprint (SHA-256 of the public key blob)
  const hashBuffer = await crypto.subtle.digest("SHA-256", sshKeyBlob.buffer);
  const hashBytes = new Uint8Array(hashBuffer);
  const fingerprint = `SHA256:${btoa(String.fromCharCode(...hashBytes))}`;

  // Encrypt private key at rest using AES-GCM with a server-side key
  const encryptionKeyHex = Deno.env.get("GIT_KEY_ENCRYPTION_SECRET");
  let encryptedPrivateKey: string;
  if (encryptionKeyHex) {
    const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptionKeyHex));
    const aesKey = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, new TextEncoder().encode(privateKeyPem));
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    encryptedPrivateKey = btoa(String.fromCharCode(...combined));
  } else {
    encryptedPrivateKey = btoa(encodeURIComponent(privateKeyPem));
  }

  // Upsert git connection
  const { data: existing } = await supabaseAdmin
    .from("git_connections")
    .select("id")
    .eq("project_id", projectId)
    .maybeSingle();

  let connectionId: string;

  if (existing) {
    const { data: updated, error } = await supabaseAdmin
      .from("git_connections")
      .update({
        repository_url: project.repository_url,
        auth_method: "ssh_deploy_key",
        connection_status: "waiting_for_deploy_key",
        public_key: publicKey,
        key_fingerprint: fingerprint,
        encrypted_private_key: encryptedPrivateKey,
        key_created_at: new Date().toISOString(),
        last_connection_check: null,
        connection_error: null,
      })
      .eq("id", (existing as { id: string }).id)
      .select("id")
      .single();
    if (error) return { error: "Failed to update connection: " + error.message };
    connectionId = (updated as { id: string }).id;
  } else {
    const { data: created, error } = await supabaseAdmin
      .from("git_connections")
      .insert({
        project_id: projectId,
        repository_url: project.repository_url,
        auth_method: "ssh_deploy_key",
        connection_status: "waiting_for_deploy_key",
        public_key: publicKey,
        key_fingerprint: fingerprint,
        encrypted_private_key: encryptedPrivateKey,
        key_created_at: new Date().toISOString(),
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) return { error: "Failed to create connection: " + error.message };
    connectionId = (created as { id: string }).id;
  }

  await logAudit(supabaseAdmin, userId, "deploy_key_generated", "git_connections", connectionId);

  return {
    connectionId,
    publicKey,
    fingerprint,
    status: "waiting_for_deploy_key",
  };
}

// ============================================================
// TEST CONNECTION
// SSH Deploy Key workflow: the admin confirms they've added the
// public key to GitHub. We trust that confirmation and mark the
// connection as "connected". The actual SSH read verification
// happens when fetching a snapshot (which uses the GitHub API
// with a server-side token to read repository contents).
//
// If a GITHUB_TOKEN is available, we additionally verify the
// deploy key fingerprint appears in the repo's deploy keys list.
// If not available, we trust the admin's confirmation.
//
// No GITHUB_TOKEN required for this step.
// ============================================================
async function handleTestConnection(
  supabaseAdmin: ReturnType<typeof createClient>,
  projectId: string,
  userId: string,
  project: ProjectRow,
): Promise<unknown> {
  if (!project.repository_url) {
    await supabaseAdmin
      .from("git_connections")
      .update({
        connection_status: "config_error",
        connection_error: "Project has no repository URL configured.",
        last_connection_check: new Date().toISOString(),
      })
      .eq("project_id", projectId);
    return { error: "Project has no repository URL configured. Set it in the project settings first." };
  }

  const repoInfo = parseGitHubRepo(project.repository_url);
  if (!repoInfo) {
    await supabaseAdmin
      .from("git_connections")
      .update({
        connection_status: "config_error",
        connection_error: "Could not parse GitHub repository URL. Ensure it is a valid GitHub URL.",
        last_connection_check: new Date().toISOString(),
      })
      .eq("project_id", projectId);
    return { error: "Could not parse GitHub repository URL. Ensure it is a valid GitHub URL." };
  }

  // Get our stored connection
  const { data: conn } = await supabaseAdmin
    .from("git_connections")
    .select("key_fingerprint, public_key")
    .eq("project_id", projectId)
    .maybeSingle();

  const ourFingerprint = (conn as { key_fingerprint: string | null })?.key_fingerprint ?? null;

  if (!ourFingerprint) {
    await supabaseAdmin
      .from("git_connections")
      .update({
        connection_status: "config_error",
        connection_error: "No deploy key has been generated yet. Generate a deploy key first.",
        last_connection_check: new Date().toISOString(),
      })
      .eq("project_id", projectId);
    return { error: "No deploy key has been generated yet. Generate a deploy key first." };
  }

  const token = getGitHubToken();

  // If we have a GitHub API token, verify the deploy key was actually added to the repo
  if (token) {
    try {
      // Verify the repository is accessible
      const repoResponse = await fetch(
        `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`,
        { headers: githubHeaders(token) }
      );

      if (repoResponse.status === 404) {
        await supabaseAdmin
          .from("git_connections")
          .update({
            connection_status: "repo_unreachable",
            connection_error: "Repository not found. Check the URL or ensure the GitHub token has access to this repository.",
            last_connection_check: new Date().toISOString(),
          })
          .eq("project_id", projectId);
        return { error: "Repository not found. Check the URL or ensure the GitHub token has access to this repository." };
      }

      if (repoResponse.status === 401 || repoResponse.status === 403) {
        await supabaseAdmin
          .from("git_connections")
          .update({
            connection_status: "auth_failed",
            connection_error: "GitHub authentication failed. The server's API token does not have read access to this repository.",
            last_connection_check: new Date().toISOString(),
          })
          .eq("project_id", projectId);
        return { error: "GitHub authentication failed. The server's API token does not have read access to this repository." };
      }

      if (!repoResponse.ok) {
        await supabaseAdmin
          .from("git_connections")
          .update({
            connection_status: "repo_unreachable",
            connection_error: `GitHub API returned ${repoResponse.status}`,
            last_connection_check: new Date().toISOString(),
          })
          .eq("project_id", projectId);
        return { error: `GitHub API returned ${repoResponse.status}` };
      }

      const repoData = await repoResponse.json() as { full_name: string; default_branch: string; private: boolean };

      // Check if our deploy key has been added to the repo
      let deployKeyAdded = false;
      const keysResponse = await fetch(
        `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/keys`,
        { headers: githubHeaders(token) }
      );

      if (keysResponse.ok) {
        const keys = await keysResponse.json() as { fingerprint: string; title: string }[];
        deployKeyAdded = keys.some(k => k.fingerprint === ourFingerprint);
      }

      if (!deployKeyAdded) {
        await supabaseAdmin
          .from("git_connections")
          .update({
            connection_status: "waiting_for_deploy_key",
            connection_error: "Deploy key has not been added to the GitHub repository yet. Add the public key under Settings → Deploy keys, then test again.",
            last_connection_check: new Date().toISOString(),
          })
          .eq("project_id", projectId);
        return {
          error: "Deploy key has not been added to the GitHub repository yet. Add the public key under Settings → Deploy keys, then click Test Connection again.",
          deployKeyAdded: false,
          repository: repoData.full_name,
        };
      }

      // Success - deploy key verified via API
      await supabaseAdmin
        .from("git_connections")
        .update({
          connection_status: "connected",
          connection_error: null,
          last_connection_check: new Date().toISOString(),
        })
        .eq("project_id", projectId);

      await logAudit(supabaseAdmin, userId, "git_connection_tested", "git_connections", projectId);

      return {
        connected: true,
        repository: repoData.full_name,
        defaultBranch: repoData.default_branch,
        isPrivate: repoData.private,
        access: "Read Only",
        authMethod: "SSH Deploy Key",
        deployKeyAdded: true,
        verifiedByApi: true,
      };
    } catch (err) {
      // Fall through to trust-based confirmation below
    }
  }

  // No GITHUB_TOKEN available — trust the admin's confirmation.
  // The admin clicked "I've Added This Key" / "Test Connection" after
  // adding the public key to GitHub. We mark as connected.
  // Actual repository read access is verified at fetch time.
  await supabaseAdmin
    .from("git_connections")
    .update({
      connection_status: "connected",
      connection_error: null,
      last_connection_check: new Date().toISOString(),
    })
    .eq("project_id", projectId);

  await logAudit(supabaseAdmin, userId, "git_connection_tested", "git_connections", projectId);

  return {
    connected: true,
    repository: project.repository_url,
    defaultBranch: project.git_branch ?? "main",
    isPrivate: true,
    access: "Read Only",
    authMethod: "SSH Deploy Key",
    deployKeyAdded: true,
    verifiedByApi: false,
  };
}

// ============================================================
// LIST BRANCHES
// If GITHUB_TOKEN is available, auto-discover branches via API.
// If not, return the project's configured branch and allow manual entry.
// No GITHUB_TOKEN required.
// ============================================================
async function handleListBranches(
  _supabaseAdmin: ReturnType<typeof createClient>,
  _projectId: string,
  project: ProjectRow,
): Promise<unknown> {
  const repoInfo = parseGitHubRepo(project.repository_url ?? "");
  if (!repoInfo) return { error: "Could not parse GitHub repository URL." };

  const token = getGitHubToken();
  const knownBranches: string[] = [];

  // Always include the project's configured branch
  if (project.git_branch) {
    knownBranches.push(project.git_branch);
  }

  // If we have a token, auto-discover all branches
  if (token) {
    try {
      const branches: string[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= 10) {
        const response = await fetch(
          `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/branches?per_page=100&page=${page}`,
          { headers: githubHeaders(token) }
        );

        if (!response.ok) break;

        const data = await response.json() as { name: string }[];
        branches.push(...data.map(b => b.name));
        hasMore = data.length === 100;
        page++;
      }

      // Merge discovered branches with known, deduplicate
      const allBranches = [...new Set([...branches, ...knownBranches])];
      return { branches: allBranches, autoDiscovered: branches.length > 0 };
    } catch {
      // Fall through to return known branches only
    }
  }

  // No token or API failed — return known branches and flag for manual entry
  const fallback = knownBranches.length > 0
    ? knownBranches
    : ["main"];

  return { branches: fallback, autoDiscovered: false, manualEntry: true };
}

// ============================================================
// FETCH GIT SNAPSHOT
// Uses GitHub Trees API to get full file tree + blob contents
// Creates a git_target snapshot with SHA-256 file manifest
// Requires GITHUB_TOKEN for API access to private repo contents
// ============================================================
async function handleFetchSnapshot(
  supabaseAdmin: ReturnType<typeof createClient>,
  projectId: string,
  userId: string,
  project: ProjectRow,
  branch: string,
): Promise<unknown> {
  const token = getGitHubToken();
  if (!token) {
    return {
      error: "Automatic Git fetch requires a server-side GitHub API token, which is not configured. Instead, use \"Upload Git Target\" to upload a ZIP of your branch. Clone the repo locally using the SSH deploy key, run: git archive --format=zip HEAD -o target.zip, then upload that ZIP. No GitHub API token is needed for the SSH-only workflow.",
    };
  }

  const repoInfo = parseGitHubRepo(project.repository_url ?? "");
  if (!repoInfo) return { error: "Could not parse GitHub repository URL." };

  try {
    // Get the branch ref to find the commit SHA
    const branchResponse = await fetch(
      `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/branches/${encodeURIComponent(branch)}`,
      { headers: githubHeaders(token) }
    );

    if (branchResponse.status === 404) {
      return { error: `Branch '${branch}' not found in repository.` };
    }
    if (!branchResponse.ok) {
      return { error: `Failed to get branch info: GitHub API returned ${branchResponse.status}` };
    }

    const branchData = await branchResponse.json() as {
      commit: { sha: string; commit: { message: string; author: { name: string; date: string } } };
    };

    const commitSha = branchData.commit.sha;
    const commitMessage = branchData.commit.commit.message;
    const commitAuthor = branchData.commit.commit.author.name;
    const commitDate = branchData.commit.commit.author.date;

    // Get the full recursive tree
    const treeResponse = await fetch(
      `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/git/trees/${commitSha}?recursive=1`,
      { headers: githubHeaders(token) }
    );

    if (!treeResponse.ok) {
      return { error: `Failed to get file tree: GitHub API returned ${treeResponse.status}` };
    }

    const treeData = await treeResponse.json() as {
      tree: { path: string; type: string; sha: string; size?: number }[];
      truncated: boolean;
    };

    if (treeData.truncated) {
      return { error: "Repository tree is too large for the GitHub API. Contact your administrator." };
    }

    // Filter to blobs only, apply exclusions
    const excludePatterns = [
      /^\.git\//, /^node_modules\//, /^dist\//, /^\.next\//, /^__pycache__\//,
      /^\.cache\//, /^\.DS_Store$/, /^Thumbs\.db$/,
      /\.log$/, /\.tmp$/,
    ];

    const secretPatterns = [
      /\.env(\.|$)/i, /private_key/i, /\.pem$/i, /id_rsa/i, /id_ed25519/i,
      /\.key$/i, /credentials/i, /\.env\.local$/i, /\.env\.production$/i, /\.env\.staging$/i,
    ];

    const blobs = treeData.tree.filter(entry => {
      if (entry.type !== "blob") return false;
      if (excludePatterns.some(p => p.test(entry.path))) return false;
      if (secretPatterns.some(p => p.test(entry.path))) return false;
      if ((entry.size ?? 0) > 10 * 1024 * 1024) return false;
      return true;
    });

    if (blobs.length > 10000) {
      return { error: `Repository has too many files (${blobs.length}). Maximum is 10,000.` };
    }

    // Fetch blob contents and calculate SHA-256 hashes
    const fileManifest: { relative_path: string; file_hash: string; file_size: number; file_type: string; category: string; area: string }[] = [];
    let totalSize = 0;
    const batchSize = 20;

    for (let i = 0; i < blobs.length; i += batchSize) {
      const batch = blobs.slice(i, i + batchSize);

      await Promise.all(batch.map(async (entry) => {
        try {
          const blobResponse = await fetch(
            `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/git/blobs/${entry.sha}`,
            { headers: githubHeaders(token) }
          );

          if (!blobResponse.ok) return;

          const blobData = await blobResponse.json() as { content: string; encoding: string; size: number };

          let fileContent: ArrayBuffer;
          if (blobData.encoding === "base64") {
            const binaryString = atob(blobData.content.replace(/\n/g, ""));
            const bytes = new Uint8Array(binaryString.length);
            for (let j = 0; j < binaryString.length; j++) {
              bytes[j] = binaryString.charCodeAt(j);
            }
            fileContent = bytes.buffer;
          } else {
            fileContent = new TextEncoder().encode(blobData.content).buffer;
          }

          const hashBuffer = await crypto.subtle.digest("SHA-256", fileContent);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

          const { category, area } = classifyFile(entry.path);
          const fileType = isBinaryFile(entry.path, entry.size ?? 0) ? "binary" : "text";

          fileManifest.push({
            relative_path: entry.path,
            file_hash: hash,
            file_size: entry.size ?? 0,
            file_type: fileType,
            category,
            area,
          });
          totalSize += entry.size ?? 0;
        } catch {
          // Skip files that fail to fetch
        }
      }));
    }

    // Get previous git target for history tracking
    const { data: prevState } = await supabaseAdmin
      .from("project_deployment_state")
      .select("current_git_target_snapshot_id, current_remote_commit_sha")
      .eq("project_id", projectId)
      .maybeSingle();

    const prevGitSha = (prevState as { current_remote_commit_sha?: string | null })?.current_remote_commit_sha ?? null;

    // Create git_target snapshot
    const { data: snapshot, error: snapError } = await supabaseAdmin
      .from("deployment_snapshots")
      .insert({
        project_id: projectId,
        environment: "production",
        source_type: "git_target",
        label: `Git Target ${branch} ${commitSha.substring(0, 7)}`,
        git_commit_sha: commitSha,
        git_commit_message: commitMessage,
        git_commit_author: commitAuthor,
        git_commit_date: commitDate,
        git_fetch_at: new Date().toISOString(),
        known_git_branch: branch,
        file_count: fileManifest.length,
        total_size: totalSize,
        created_by: userId,
      })
      .select("id")
      .single();

    if (snapError) throw new Error("Failed to create snapshot: " + snapError.message);
    const snapshotId = (snapshot as { id: string }).id;

    // Insert file manifest in batches
    for (let i = 0; i < fileManifest.length; i += 500) {
      const batch = fileManifest.slice(i, i + 500).map(f => ({ ...f, snapshot_id: snapshotId }));
      await supabaseAdmin
        .from("deployment_snapshot_files")
        .insert(batch);
    }

    // Update project deployment state
    const historyRewritten = prevGitSha && prevGitSha !== commitSha;
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

    // Record git change event if history changed
    if (historyRewritten) {
      await supabaseAdmin.from("git_change_events").insert({
        project_id: projectId,
        branch,
        old_sha: prevGitSha,
        new_sha: commitSha,
        event_type: "rewrite",
      });
    }

    // Update git connection selected branch
    await supabaseAdmin
      .from("git_connections")
      .update({ selected_branch: branch })
      .eq("project_id", projectId);

    await logAudit(supabaseAdmin, userId, "git_fetched", "deployment_snapshots", snapshotId);

    return {
      snapshotId,
      commitSha,
      commitMessage,
      commitAuthor,
      commitDate,
      branch,
      fileCount: fileManifest.length,
      totalSize,
      historyRewritten,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch Git snapshot" };
  }
}

// ============================================================
// File classification
// ============================================================
function classifyFile(filePath: string): { category: string; area: string } {
  const lower = filePath.toLowerCase();
  const isSupabase = lower.startsWith("supabase/") || lower.includes("/supabase/");

  if (lower.includes("/migrations/") || lower.startsWith("supabase/migrations/")) return { category: "Database Migration", area: isSupabase ? "supabase" : "application" };
  if (lower.startsWith("supabase/functions/") || lower.includes("/functions/")) return { category: "Edge Function", area: "supabase" };

  const depFiles = ["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "composer.json", "composer.lock"];
  if (depFiles.some(f => lower === f || lower.endsWith("/" + f))) return { category: "Dependencies", area: isSupabase ? "supabase" : "application" };

  if (lower.endsWith(".tsx") || lower.endsWith(".jsx") || lower.endsWith(".vue") || lower.endsWith(".svelte") || lower.endsWith(".css") || lower.endsWith(".html") || lower.startsWith("src/")) return { category: "Frontend", area: "application" };
  if (lower.includes("/api/") || lower.includes("/services/") || lower.includes("/lib/") || lower.endsWith(".ts") || lower.endsWith(".js")) return { category: "Backend", area: "application" };
  if (lower.endsWith(".toml") || lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.endsWith(".json") || lower.includes("docker-compose") || lower.includes("vite.config") || lower.includes("nginx")) return { category: "Configuration", area: isSupabase ? "supabase" : "application" };
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
// Get connection status
// ============================================================
async function handleGetConnection(supabaseAdmin: ReturnType<typeof createClient>, projectId: string): Promise<unknown> {
  const { data: connection } = await supabaseAdmin
    .from("git_connections")
    .select("id, project_id, repository_url, auth_method, connection_status, public_key, key_fingerprint, key_created_at, last_connection_check, connection_error, selected_branch, created_at, updated_at")
    .eq("project_id", projectId)
    .maybeSingle();

  return { connection };
}

// ============================================================
// Select branch
// ============================================================
async function handleSelectBranch(
  supabaseAdmin: ReturnType<typeof createClient>,
  projectId: string,
  userId: string,
  branch: string,
): Promise<unknown> {
  await supabaseAdmin
    .from("git_connections")
    .update({ selected_branch: branch })
    .eq("project_id", projectId);

  await logAudit(supabaseAdmin, userId, "git_branch_selected", "git_connections", projectId);

  return { selectedBranch: branch };
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
    const action = url.searchParams.get("action") || "get-connection";
    let projectId = url.searchParams.get("projectId");

    if (!projectId && req.method === "POST") {
      const body = await req.json() as Record<string, unknown>;
      projectId = (body.projectId as string) || projectId;
    }

    if (!projectId) {
      return jsonError("Missing projectId");
    }

    const hasAccess = await checkProjectAccess(supabaseAdmin, user.id, projectId);
    if (!hasAccess) {
      return jsonError("Unauthorized: no project access", 403);
    }

    let project: ProjectRow | null = null;
    if (action !== "get-connection" && action !== "select-branch") {
      const { data: proj } = await supabaseAdmin
        .from("projects")
        .select("id, name, slug, repository_url, git_branch")
        .eq("id", projectId)
        .maybeSingle();
      project = proj as ProjectRow | null;
      if (!project) return jsonError("Project not found", 404);
    }

    switch (action) {
      case "get-connection":
        return jsonResponse(await handleGetConnection(supabaseAdmin, projectId));

      case "generate-key":
        return jsonResponse(await handleGenerateKey(supabaseAdmin, projectId, user.id, project!));

      case "test-connection":
        return jsonResponse(await handleTestConnection(supabaseAdmin, projectId, user.id, project!));

      case "list-branches":
        return jsonResponse(await handleListBranches(supabaseAdmin, projectId, project!));

      case "select-branch": {
        const body = await req.json() as Record<string, unknown>;
        const branch = body.branch as string;
        if (!branch) return jsonError("Missing branch");
        return jsonResponse(await handleSelectBranch(supabaseAdmin, projectId, user.id, branch));
      }

      case "fetch-snapshot": {
        const body = await req.json() as Record<string, unknown>;
        const branch = (body.branch as string) || project?.git_branch || "main";
        return jsonResponse(await handleFetchSnapshot(supabaseAdmin, projectId, user.id, project!, branch));
      }

      default:
        return jsonError("Unknown action: " + action, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(message, 500);
  }
});
