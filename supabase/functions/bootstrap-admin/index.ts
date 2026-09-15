import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { email, password, bootstrap_key } = await req.json();

    const expectedKey = Deno.env.get("BOOTSTRAP_ADMIN_KEY");
    if (!expectedKey) {
      return new Response(JSON.stringify({ error: "Bootstrap is not configured. Set BOOTSTRAP_ADMIN_KEY env var." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (bootstrap_key !== expectedKey) {
      return new Response(JSON.stringify({ error: "Invalid bootstrap key" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!email || !password || password.length < 6) {
      return new Response(JSON.stringify({ error: "Valid email and password (min 6 chars) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if any admin already exists
    const { data: existingAdmins } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1);

    if (existingAdmins && existingAdmins.length > 0) {
      return new Response(JSON.stringify({ error: "An admin account already exists. Use the admin dashboard to manage users." }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create the auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      return new Response(JSON.stringify({ error: authError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = authData.user.id;

    // Assign admin role
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "admin", is_active: true });

    if (roleError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return new Response(JSON.stringify({ error: roleError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Grant access to all existing servers and projects
    const { data: servers } = await supabaseAdmin.from("servers").select("id");
    if (servers && servers.length > 0) {
      await supabaseAdmin
        .from("user_server_access")
        .insert(servers.map((s) => ({ user_id: userId, server_id: s.id })));
    }

    const { data: projects } = await supabaseAdmin.from("projects").select("id");
    if (projects && projects.length > 0) {
      await supabaseAdmin
        .from("user_project_access")
        .insert(projects.map((p) => ({ user_id: userId, project_id: p.id })));
    }

    return new Response(JSON.stringify({ success: true, email }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
