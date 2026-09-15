import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface UserPayload {
  email: string;
  password?: string;
  role?: "admin" | "user";
  access_type?: "read_only" | "write";
  is_active?: boolean;
  server_ids?: string[];
  project_ids?: string[];
  reverification_required?: boolean;
}

async function verifyAdmin(supabaseAdmin: ReturnType<typeof createClient>, authHeader: string | null) {
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;

  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role, is_active")
    .eq("user_id", user.id)
    .single();

  if (!roleRow || roleRow.role !== "admin" || !roleRow.is_active) return null;
  return user;
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
  const adminUser = await verifyAdmin(supabaseAdmin, authHeader);
  if (!adminUser) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || req.headers.get("X-Action");

    if (req.method === "GET") {
      return await handleList(supabaseAdmin);
    }

    const body: UserPayload = await req.json();

    if (req.method === "POST") {
      return await handleCreate(supabaseAdmin, body);
    }

    if (req.method === "PUT") {
      const userId = url.searchParams.get("userId") || (body as Record<string, unknown>).userId as string | null;
      if (!userId) {
        return jsonError("Missing userId");
      }
      return await handleUpdate(supabaseAdmin, userId, body);
    }

    if (req.method === "DELETE") {
      const userId = url.searchParams.get("userId") || (body as Record<string, unknown>).userId as string | null;
      if (!userId) {
        return jsonError("Missing userId");
      }
      return await handleDelete(supabaseAdmin, userId);
    }

    return jsonError("Method not allowed", 405);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Unknown error", 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleList(supabaseAdmin: ReturnType<typeof createClient>) {
  const { data: roles, error: rolesError } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role, access_type, is_active, reverification_required, created_at, updated_at");

  if (rolesError) return jsonError(rolesError.message, 500);

  const userIds = (roles ?? []).map((r) => r.user_id);
  if (userIds.length === 0) {
    return jsonResponse({ users: [] });
  }

  const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
  const userMap = new Map((authUsers?.users ?? []).map((u) => [u.id, u]));

  const { data: serverAccess } = await supabaseAdmin
    .from("user_server_access")
    .select("user_id, server_id")
    .in("user_id", userIds);

  const { data: projectAccess } = await supabaseAdmin
    .from("user_project_access")
    .select("user_id, project_id")
    .in("user_id", userIds);

  const serverMap = new Map<string, string[]>();
  for (const s of serverAccess ?? []) {
    if (!serverMap.has(s.user_id)) serverMap.set(s.user_id, []);
    serverMap.get(s.user_id)!.push(s.server_id);
  }

  const projectMap = new Map<string, string[]>();
  for (const p of projectAccess ?? []) {
    if (!projectMap.has(p.user_id)) projectMap.set(p.user_id, []);
    projectMap.get(p.user_id)!.push(p.project_id);
  }

  const users = (roles ?? []).map((r) => {
    const authUser = userMap.get(r.user_id);
    return {
      id: r.user_id,
      email: authUser?.email ?? "",
      role: r.role,
      is_active: r.is_active,
      reverification_required: r.reverification_required ?? false,
      access_type: (r as Record<string, unknown>).access_type ?? "write",
      created_at: r.created_at,
      server_ids: serverMap.get(r.user_id) ?? [],
      project_ids: projectMap.get(r.user_id) ?? [],
    };
  });

  return jsonResponse({ users });
}

async function handleCreate(supabaseAdmin: ReturnType<typeof createClient>, body: UserPayload) {
  if (!body.email || !body.password) {
    return jsonError("Email and password are required");
  }
  if (body.password.length < 6) {
    return jsonError("Password must be at least 6 characters");
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
  });

  if (authError) return jsonError(authError.message);
  const userId = authData.user.id;

  const { error: roleError } = await supabaseAdmin
    .from("user_roles")
    .insert({
      user_id: userId,
      role: body.role ?? "user",
      access_type: body.access_type ?? "write",
      is_active: body.is_active ?? true,
    });

  if (roleError) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return jsonError(roleError.message);
  }

  if (body.server_ids && body.server_ids.length > 0) {
    const rows = body.server_ids.map((sid) => ({ user_id: userId, server_id: sid }));
    await supabaseAdmin.from("user_server_access").insert(rows);
  }

  if (body.project_ids && body.project_ids.length > 0) {
    const rows = body.project_ids.map((pid) => ({ user_id: userId, project_id: pid }));
    await supabaseAdmin.from("user_project_access").insert(rows);
  }

  return jsonResponse({ id: userId, email: body.email, role: body.role ?? "user" });
}

async function handleUpdate(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  body: UserPayload
) {
  if (body.password) {
    if (body.password.length < 6) {
      return jsonError("Password must be at least 6 characters");
    }
    const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: body.password,
    });
    if (pwError) return jsonError(pwError.message);
  }

  if (body.role !== undefined || body.is_active !== undefined || body.reverification_required !== undefined || body.access_type !== undefined) {
    const updates: Record<string, unknown> = {};
    if (body.role !== undefined) updates.role = body.role;
    if (body.is_active !== undefined) updates.is_active = body.is_active;
    if (body.reverification_required !== undefined) updates.reverification_required = body.reverification_required;
    if (body.access_type !== undefined) updates.access_type = body.access_type;
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .update(updates)
      .eq("user_id", userId);
    if (roleError) return jsonError(roleError.message);
  }

  if (body.server_ids !== undefined) {
    await supabaseAdmin.from("user_server_access").delete().eq("user_id", userId);
    if (body.server_ids.length > 0) {
      const rows = body.server_ids.map((sid) => ({ user_id: userId, server_id: sid }));
      await supabaseAdmin.from("user_server_access").insert(rows);
    }
  }

  if (body.project_ids !== undefined) {
    await supabaseAdmin.from("user_project_access").delete().eq("user_id", userId);
    if (body.project_ids.length > 0) {
      const rows = body.project_ids.map((pid) => ({ user_id: userId, project_id: pid }));
      await supabaseAdmin.from("user_project_access").insert(rows);
    }
  }

  return jsonResponse({ success: true });
}

async function handleDelete(supabaseAdmin: ReturnType<typeof createClient>, userId: string) {
  await supabaseAdmin.from("user_server_access").delete().eq("user_id", userId);
  await supabaseAdmin.from("user_project_access").delete().eq("user_id", userId);
  await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteError) return jsonError(deleteError.message);
  return jsonResponse({ success: true });
}
