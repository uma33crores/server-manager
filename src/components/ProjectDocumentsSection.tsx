import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { ProjectDocument } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  FileText,
  Upload,
  Download,
  Trash2,
  Eye,
  AlertCircle,
  X,
  Loader2,
} from 'lucide-react';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['.txt'];
const ACCEPTED_MIME = 'text/plain';

type Props = {
  projectId: string;
};

export default function ProjectDocumentsSection({ projectId }: Props) {
  const { isReadOnly } = useAuth();
  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectDocument | null>(null);
  const [viewingDoc, setViewingDoc] = useState<ProjectDocument | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('project_documents')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (queryError) {
      setError(queryError.message);
    }
    setDocs((data as ProjectDocument[]) ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  function validateFile(file: File): string | null {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return `Only .txt files are allowed. "${file.name}" is not a .txt file.`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File "${file.name}" exceeds the 5 MB size limit.`;
    }
    return null;
  }

  async function handleUpload(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      for (const file of fileArray) {
        const validationError = validateFile(file);
        if (validationError) throw new Error(validationError);

        const storedFileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${file.name}`;
        const filePath = `${projectId}/${storedFileName}`;

        const { error: uploadError } = await supabase.storage
          .from('project-documents')
          .upload(filePath, file, { contentType: ACCEPTED_MIME });

        if (uploadError) throw new Error(`Upload failed for ${file.name}: ${uploadError.message}`);

        const { error: insertError } = await supabase
          .from('project_documents')
          .insert({
            project_id: projectId,
            original_file_name: file.name,
            stored_file_name: storedFileName,
            file_path: filePath,
            file_size: file.size,
            mime_type: ACCEPTED_MIME,
          });

        if (insertError) {
          await supabase.storage.from('project-documents').remove([filePath]);
          throw new Error(insertError.message);
        }
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: ProjectDocument) {
    const { data, error: dlError } = await supabase.storage
      .from('project-documents')
      .createSignedUrl(doc.file_path, 3600);

    if (dlError || !data) {
      setError(`Download failed: ${dlError?.message ?? 'Unknown error'}`);
      return;
    }

    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = doc.original_file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleView(doc: ProjectDocument) {
    setViewingDoc(doc);
    setContentLoading(true);
    setFileContent(null);

    try {
      const { data, error: dlError } = await supabase.storage
        .from('project-documents')
        .createSignedUrl(doc.file_path, 3600);

      if (dlError || !data) {
        throw new Error(dlError?.message ?? 'Failed to get download URL');
      }

      const response = await fetch(data.signedUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      setFileContent(text);
    } catch (err) {
      setFileContent(null);
      setError(err instanceof Error ? `Failed to load file: ${err.message}` : 'Failed to load file');
    } finally {
      setContentLoading(false);
    }
  }

  async function handleDelete(doc: ProjectDocument) {
    setConfirmDelete(null);
    await supabase.storage.from('project-documents').remove([doc.file_path]);
    await supabase.from('project_documents').delete().eq('id', doc.id);
    await load();
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (isReadOnly) return;
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  }

  return (
    <div>
      {error && (
        <div className="alert-error mb-4">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Upload area */}
      {!isReadOnly && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors mb-4 ${
            dragOver
              ? 'border-sky-500 bg-sky-500/5'
              : 'border-border hover:border-border-hover'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,text/plain"
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
            className="hidden"
          />
          <Upload className="w-7 h-7 text-text-faint mx-auto mb-2" />
          <p className="text-sm text-text-secondary font-medium">
            {uploading ? 'Uploading...' : 'Drag & drop .txt files here or click to browse'}
          </p>
          <p className="text-xs text-text-faint mt-1">Only .txt files (max 5 MB)</p>
        </div>
      )}

      {/* Documents table */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-text-faint animate-spin" />
          <span className="text-text-muted text-sm ml-2">Loading documents...</span>
        </div>
      ) : docs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><FileText className="w-7 h-7" /></div>
          <p className="text-text-muted text-sm">No documents uploaded yet</p>
          <p className="text-text-faint text-xs mt-0.5">Upload .txt files to attach to this project</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>File Name</th>
                <th>Size</th>
                <th>Uploaded By</th>
                <th>Uploaded At</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-text-faint flex-shrink-0" />
                      <span className="text-sm text-text-primary truncate">{doc.original_file_name}</span>
                    </div>
                  </td>
                  <td className="text-sm text-text-muted">{formatSize(doc.file_size)}</td>
                  <td className="text-sm text-text-muted">
                    {doc.uploaded_by ? (
                      <span className="font-mono text-xs">{doc.uploaded_by.slice(0, 8)}...</span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                  <td className="text-sm text-text-muted">{new Date(doc.created_at).toLocaleString()}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleView(doc)}
                        className="p-1.5 rounded-lg text-text-muted hover:text-sky-500 hover:bg-surface-hover transition-colors"
                        title="View"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDownload(doc)}
                        className="p-1.5 rounded-lg text-text-muted hover:text-sky-500 hover:bg-surface-hover transition-colors"
                        title="Download"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      {!isReadOnly && (
                        <button
                          onClick={() => setConfirmDelete(doc)}
                          className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-surface-hover transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Text File Viewer Modal */}
      <Modal
        open={!!viewingDoc}
        onClose={() => { setViewingDoc(null); setFileContent(null); }}
        title={viewingDoc?.original_file_name ?? 'View Document'}
        size="lg"
      >
        {viewingDoc && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 pb-4 border-b border-border">
              <div>
                <p className="text-xs text-text-faint mb-1">File Name</p>
                <p className="text-sm text-text-primary truncate">{viewingDoc.original_file_name}</p>
              </div>
              <div>
                <p className="text-xs text-text-faint mb-1">File Size</p>
                <p className="text-sm text-text-primary">{formatSize(viewingDoc.file_size)}</p>
              </div>
              <div>
                <p className="text-xs text-text-faint mb-1">Uploaded Date</p>
                <p className="text-sm text-text-primary">{new Date(viewingDoc.created_at).toLocaleString()}</p>
              </div>
            </div>

            <div>
              <p className="text-xs text-text-faint mb-2">Text Content</p>
              {contentLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-text-faint animate-spin" />
                  <span className="text-text-muted text-sm ml-2">Loading file content...</span>
                </div>
              ) : fileContent !== null ? (
                <pre className="code-block max-h-[400px] overflow-auto whitespace-pre text-sm leading-relaxed">
                  {fileContent}
                </pre>
              ) : (
                <div className="alert-error justify-center">
                  <AlertCircle className="w-4 h-4" />
                  Failed to load file content
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Document"
        message="Are you sure you want to delete this document? The file will be permanently removed."
        itemName={confirmDelete?.original_file_name}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
