/*
# Extend admin_update_project to support all project fields

## Overview
The existing function only handled 7 fields (name, app_domain, supabase_domain,
repository_url, git_branch, status, notes). This rewrite adds support for:
slug, server_id, app_directory, supabase_directory, compose_name,
project_slot, api_port, db_port, pooler_port.

## Approach
Instead of hardcoding each field, we use a dynamic approach:
- Build the SET clause from the JSONB keys
- Cast integer fields (project_slot, api_port, db_port, pooler_port) properly
- Validate that the project exists
- Keep the same auth/reauth checks (is_admin, check_admin_reauth)
- Audit log all changes

## Security
- SECURITY DEFINER, admin-only, reauth required (unchanged)
- No data deleted or recreated
*/

CREATE OR REPLACE FUNCTION public.admin_update_project(p_project_id uuid, p_updates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb;
  v_set_clause text := '';
  v_has_changes boolean := false;
  v_key text;
  v_value text;
  v_int_fields text[] := ARRAY['project_slot', 'api_port', 'db_port', 'pooler_port'];
  v_text_fields text[] := ARRAY[
    'name', 'slug', 'server_id', 'app_domain', 'supabase_domain',
    'app_directory', 'supabase_directory', 'compose_name',
    'repository_url', 'git_branch', 'status', 'notes'
  ];
  v_all_fields text[] := v_int_fields || v_text_fields;
  v_field_type text;
BEGIN
  IF NOT is_admin() THEN
    PERFORM write_audit_log('PROJECT_UPDATED', 'PROJECT', p_project_id::text, NULL, 'FAILURE', 'Not admin');
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF NOT check_admin_reauth() THEN
    PERFORM write_audit_log('PROJECT_UPDATED', 'PROJECT', p_project_id::text, NULL, 'FAILURE', 'OTP_VERIFICATION_REQUIRED');
    RAISE EXCEPTION 'OTP_VERIFICATION_REQUIRED';
  END IF;

  SELECT to_jsonb(p) INTO v_old FROM projects p WHERE p.id = p_project_id;
  IF v_old IS NULL THEN
    PERFORM write_audit_log('PROJECT_UPDATED', 'PROJECT', p_project_id::text, NULL, 'FAILURE', 'Project not found');
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  FOREACH v_key IN ARRAY v_all_fields LOOP
    IF p_updates ? v_key THEN
      v_value := p_updates->>v_key;
      v_field_type := CASE WHEN v_key = ANY(v_int_fields) THEN 'int' ELSE 'text' END;

      IF v_field_type = 'int' THEN
        v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END
          || format('%I = %s', v_key, CASE WHEN v_value = '' OR v_value IS NULL THEN 'NULL' ELSE v_value END);
      ELSE
        v_set_clause := CASE WHEN v_has_changes THEN v_set_clause || ', ' ELSE v_set_clause END
          || format('%I = %L', v_key, NULLIF(v_value, ''));
      END IF;
      v_has_changes := true;
    END IF;
  END LOOP;

  IF NOT v_has_changes THEN
    RETURN jsonb_build_object('updated', false, 'message', 'No valid fields to update');
  END IF;

  EXECUTE format('UPDATE projects SET %s, updated_at = now() WHERE id = $1 RETURNING to_jsonb(projects)', v_set_clause)
  INTO v_new USING p_project_id;

  v_changes := '{}'::jsonb;
  FOREACH v_key IN ARRAY v_all_fields LOOP
    IF p_updates ? v_key THEN
      v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('old', v_old->v_key, 'new', p_updates->v_key));
    END IF;
  END LOOP;

  PERFORM write_audit_log('PROJECT_UPDATED', 'PROJECT', p_project_id::text, v_changes);

  RETURN jsonb_build_object('updated', true, 'record', v_new);
END;
$function$;