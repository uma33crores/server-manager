/*
# Create project_documents table and storage bucket

1. New Tables
   - `project_documents`
     - `id` (uuid, primary key)
     - `project_id` (uuid, FK to projects.id ON DELETE CASCADE)
     - `original_file_name` (text, not null — the original file name as uploaded by the user)
     - `stored_file_name` (text, not null — the unique generated file name in storage)
     - `file_path` (text, not null — full path in the storage bucket: {project_id}/{stored_file_name})
     - `file_size` (bigint, not null — file size in bytes, max 5 MB)
     - `mime_type` (text, not null — must be text/plain)
     - `uploaded_by` (uuid, FK to auth.users(id) ON DELETE SET NULL — who uploaded the file)
     - `created_at` (timestamptz, default now())
     - `updated_at` (timestamptz, default now())

2. Storage
   - Create a private storage bucket `project-documents` (5 MB file size limit, only text/plain MIME type allowed).
   - Files are stored under paths like `{project_id}/{timestamp}-{random}.{ext}` — namespaced per project, never in public/executable directories.

3. Security (RLS)
   - Enable RLS on `project_documents`.
   - Four policies scoped to `authenticated` using `has_project_access(project_id)`:
     SELECT, INSERT, UPDATE, DELETE — same pattern as `server_documents`.
   - Storage policies on `project-documents` bucket:
     SELECT/INSERT/UPDATE/DELETE for `authenticated` users only.

4. Constraints
   - CHECK constraint: file_size <= 5242880 (5 MB)
   - CHECK constraint: mime_type = 'text/plain'
   - uploaded_by defaults to auth.uid() so inserts that omit it still satisfy the INSERT policy.

5. Important Notes
   - Only .txt files are accepted. The storage bucket enforces text/plain MIME type.
   - Frontend validates file extension and size before upload; the storage bucket provides backend enforcement.
   - When a project is deleted, CASCADE removes its document rows; storage objects should be cleaned up separately.
   - uploaded_by is SET NULL on user deletion so document metadata is preserved.
*/

CREATE TABLE IF NOT EXISTS project_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_file_name text NOT NULL,
  stored_file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint NOT NULL,
  mime_type text NOT NULL DEFAULT 'text/plain',
  uploaded_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT project_documents_file_size_check CHECK (file_size <= 5242880),
  CONSTRAINT project_documents_mime_type_check CHECK (mime_type = 'text/plain')
);

ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proj_docs_scoped_select" ON project_documents;
CREATE POLICY "proj_docs_scoped_select"
ON project_documents FOR SELECT
TO authenticated
USING (has_project_access(project_id));

DROP POLICY IF EXISTS "proj_docs_scoped_insert" ON project_documents;
CREATE POLICY "proj_docs_scoped_insert"
ON project_documents FOR INSERT
TO authenticated
WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "proj_docs_scoped_update" ON project_documents;
CREATE POLICY "proj_docs_scoped_update"
ON project_documents FOR UPDATE
TO authenticated
USING (has_project_access(project_id))
WITH CHECK (has_project_access(project_id));

DROP POLICY IF EXISTS "proj_docs_scoped_delete" ON project_documents;
CREATE POLICY "proj_docs_scoped_delete"
ON project_documents FOR DELETE
TO authenticated
USING (has_project_access(project_id));

-- Private storage bucket for project document files (5 MB limit, text/plain only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-documents',
  'project-documents',
  false,
  5242880,
  ARRAY['text/plain']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: allow authenticated users to manage objects in project-documents bucket
DROP POLICY IF EXISTS "proj_docs_storage_select" ON storage.objects;
CREATE POLICY "proj_docs_storage_select"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'project-documents');

DROP POLICY IF EXISTS "proj_docs_storage_insert" ON storage.objects;
CREATE POLICY "proj_docs_storage_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'project-documents');

DROP POLICY IF EXISTS "proj_docs_storage_update" ON storage.objects;
CREATE POLICY "proj_docs_storage_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'project-documents')
WITH CHECK (bucket_id = 'project-documents');

DROP POLICY IF EXISTS "proj_docs_storage_delete" ON storage.objects;
CREATE POLICY "proj_docs_storage_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'project-documents');

-- Index for querying documents by project
CREATE INDEX IF NOT EXISTS idx_project_documents_project_id ON project_documents(project_id);

-- Index for querying documents by uploader
CREATE INDEX IF NOT EXISTS idx_project_documents_uploaded_by ON project_documents(uploaded_by);