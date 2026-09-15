/*
# Create login_sessions table for tracking all login session information

1. New Tables
- `login_sessions`
  - `id` (uuid, primary key)
  - `user_id` (uuid, references auth.users, not null)
  - `user_email` (text, not null) — denormalized for display/filtering
  - `user_role` (text, not null) — 'admin' or 'user' at time of session
  - `event_type` (text, not null) — 'LOGIN' or 'LOGOUT'
  - `ip_address` (text, nullable) — client IP from request headers
  - `user_agent` (text, nullable) — browser user agent
  - `session_id` (text, nullable) — Supabase session token identifier (access_token jti claim)
  - `status` (text, not null) — 'SUCCESS' or 'FAILURE'
  - `failure_reason` (text, nullable) — error message if login failed
  - `created_at` (timestamptz, default now())

2. Security
- RLS enabled on `login_sessions`.
- SELECT: admin users can view all login sessions; non-admin users can view only their own sessions.
- INSERT: only via SECURITY DEFINER function `record_login_session` (no direct client inserts).
- No UPDATE or DELETE policies — login sessions are append-only and immutable.

3. Functions
- `record_login_session(p_user_id uuid, p_user_email text, p_user_role text, p_event_type text, p_ip_address text, p_user_agent text, p_session_id text, p_status text, p_failure_reason text)`
  - SECURITY DEFINER, callable by authenticated role.
  - Inserts a new row into `login_sessions`.
  - Used by the session-tracker edge function.

4. Indexes
- `idx_login_sessions_user_id` on `user_id`
- `idx_login_sessions_created_at` on `created_at DESC`
- `idx_login_sessions_event_type` on `event_type`
- `idx_login_sessions_status` on `status`

5. Important Notes
- Login sessions are append-only: no UPDATE or DELETE policies exist.
- The table records both successful and failed login attempts, plus logout events.
- IP address and user agent are captured from the edge function's request headers.
- Never stores passwords, OTP values, tokens, or secrets — only metadata about the session event.
*/

CREATE TABLE IF NOT EXISTS login_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  user_role text NOT NULL DEFAULT 'user',
  event_type text NOT NULL CHECK (event_type IN ('LOGIN', 'LOGOUT')),
  ip_address text,
  user_agent text,
  session_id text,
  status text NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'FAILURE')),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE login_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "login_sessions_admin_select" ON login_sessions;
CREATE POLICY "login_sessions_admin_select"
  ON login_sessions FOR SELECT
  TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS "login_sessions_own_select" ON login_sessions;
CREATE POLICY "login_sessions_own_select"
  ON login_sessions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "login_sessions_insert" ON login_sessions;
CREATE POLICY "login_sessions_insert"
  ON login_sessions FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "login_sessions_update" ON login_sessions;
CREATE POLICY "login_sessions_update"
  ON login_sessions FOR UPDATE
  TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "login_sessions_delete" ON login_sessions;
CREATE POLICY "login_sessions_delete"
  ON login_sessions FOR DELETE
  TO authenticated
  USING (false);

CREATE INDEX IF NOT EXISTS idx_login_sessions_user_id ON login_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_sessions_created_at ON login_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_sessions_event_type ON login_sessions(event_type);
CREATE INDEX IF NOT EXISTS idx_login_sessions_status ON login_sessions(status);

CREATE OR REPLACE FUNCTION record_login_session(
  p_user_id uuid,
  p_user_email text,
  p_user_role text,
  p_event_type text,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_session_id text DEFAULT NULL,
  p_status text DEFAULT 'SUCCESS',
  p_failure_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO login_sessions (
    user_id, user_email, user_role, event_type,
    ip_address, user_agent, session_id, status, failure_reason
  )
  VALUES (
    p_user_id, p_user_email, p_user_role, p_event_type,
    p_ip_address, p_user_agent, p_session_id, p_status, p_failure_reason
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION record_login_session TO authenticated;
