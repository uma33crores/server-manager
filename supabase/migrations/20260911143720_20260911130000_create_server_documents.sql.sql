/*
# Create server_documents table and storage bucket

1. New Tables
   - `server_documents`
     - `id` (uuid, primary key)
     - `server_id` (uuid, FK to servers.id ON DELETE CASCADE)
     - `title` (text, not null)
     - `description` (text, nullable)
     - `file_path` (text, not null — path in the storage bucket)
     - `file_name` (text, not null — original file name)
     - `file_size` (bigint, nullable — file size in bytes)
     - `file_type` (text, nullable — MIME type)
     - `created_at` (timestamptz, default now())
     - `updated_at` (timestamptz, default now())

2. Storage
   - Create a private storage bucket `server-documents` (50 MB file size limit, text/plain allowed MIME types).

3. Security (RLS)
   - Enable RLS on `server_documents`.
   - Four policies scoped to `authenticated` using `has_server_access(server_id)`:
     SELECT, INSERT, UPDATE, DELETE — same pattern as `notes` and `credentials`.
   - Storage policies on `server-documents` bucket:
     SELECT/INSERT/UPDATE/DELETE for `authenticated` users.
     Paths are namespaced per server: `{server_id}/{filename}`.

4. Important Notes
   - The table links documents to servers via `server_id` FK.
   - File content lives in Supabase Storage bucket `server-documents`; the DB row stores metadata + path reference.
   - Only authenticated users with server access (via `has_server_access`) can manage documents.
   - When a server is deleted, CASCADE removes its document rows; storage objects should be cleaned up separately.
*/

CREATE TABLE IF NOT EXISTS server_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_size bigint,
  file_type text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE server_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "docs_scoped_select" ON server_documents;
CREATE POLICY "docs_scoped_select"
ON server_documents FOR SELECT
TO authenticated
USING (has_server_access(server_id));

DROP POLICY IF EXISTS "docs_scoped_insert" ON server_documents;
CREATE POLICY "docs_scoped_insert"
ON server_documents FOR INSERT
TO authenticated
WITH CHECK (has_server_access(server_id));

DROP POLICY IF EXISTS "docs_scoped_update" ON server_documents;
CREATE POLICY "docs_scoped_update"
ON server_documents FOR UPDATE
TO authenticated
USING (has_server_access(server_id))
WITH CHECK (has_server_access(server_id));

DROP POLICY IF EXISTS "docs_scoped_delete" ON server_documents;
CREATE POLICY "docs_scoped_delete"
ON server_documents FOR DELETE
TO authenticated
USING (has_server_access(server_id));

-- Storage bucket for document files
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'server-documents',
  'server-documents',
  false,
  52428800,
  ARRAY['text/plain', 'text/markdown', 'application/octet-stream', 'text/csv', 'application/json', 'text/xml', 'text/html', 'text/css', 'text/javascript', 'application/javascript', 'text/x-shellscript', 'application/x-sh', 'text/yaml', 'application/x-yaml', 'text/x-yaml']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: allow authenticated users to manage objects in server-documents bucket
DROP POLICY IF EXISTS "server_docs_storage_select" ON storage.objects;
CREATE POLICY "server_docs_storage_select"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'server-documents');

DROP POLICY IF EXISTS "server_docs_storage_insert" ON storage.objects;
CREATE POLICY "server_docs_storage_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'server-documents');

DROP POLICY IF EXISTS "server_docs_storage_update" ON storage.objects;
CREATE POLICY "server_docs_storage_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'server-documents')
WITH CHECK (bucket_id = 'server-documents');

DROP POLICY IF EXISTS "server_docs_storage_delete" ON storage.objects;
CREATE POLICY "server_docs_storage_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'server-documents');

-- Index for querying documents by server
CREATE INDEX IF NOT EXISTS idx_server_documents_server_id ON server_documents(server_id);
