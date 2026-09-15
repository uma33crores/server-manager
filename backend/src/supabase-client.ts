import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';

if (!supabaseUrl) {
  console.error('Missing SUPABASE_URL environment variable');
  console.error('Set SUPABASE_URL in backend/.env or the server environment');
  process.exit(1);
}

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';

if (!anonKey) {
  console.error('Missing SUPABASE_ANON_KEY environment variable');
  console.error('The backend needs the anon key to create user-scoped clients (RLS-enforced).');
  console.error('Set SUPABASE_ANON_KEY in backend/.env or the server environment.');
  process.exit(1);
}

// Log the project hostname (not keys) so we can verify frontend and backend
// point to the same Supabase project
try {
  const hostname = new URL(supabaseUrl).hostname;
  console.log(`Backend Supabase project: ${hostname}`);
} catch {
  console.log(`Backend Supabase URL: ${supabaseUrl}`);
}

if (!serviceRoleKey) {
  console.warn('WARNING: SUPABASE_SERVICE_ROLE_KEY not set.');
  console.warn('Role lookup will use the SECURITY DEFINER function get_user_role_record() instead of direct table access.');
  console.warn('For production, set SUPABASE_SERVICE_ROLE_KEY for full server-side access.');
}

// Admin client: uses the service-role key when available to bypass RLS.
// Falls back to the anon key (with SECURITY DEFINER functions) when not set.
export const supabaseAdmin = createClient(
  supabaseUrl,
  serviceRoleKey || anonKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

export function createUserClient(accessToken: string) {
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
