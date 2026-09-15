import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { ServerDocument } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  FileText,
  Upload,
  Download,
  Trash2,
  Pencil,
  AlertCircle,
  X,
  Plus,
} from 'lucide-react';

type Props = {
  serverId: string;
};

export default function DocumentsSection({ serverId }: Props) {
  const { isReadOnly } = useAuth();
  const [docs, setDocs] = useState<ServerDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editDoc, setEditDoc] = useState<ServerDocument | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ServerDocument | null>(null);
  const [formData, setFormData] = useState({ title: '', description: '' });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('server_documents')
      .select('*')
      .eq('server_id', serverId)
      .order('created_at', { ascending: false });
    if (queryError) {
      setError(queryError.message);
    }
    setDocs((data as ServerDocument[]) ?? []);
    setLoading(false);
  }, [serverId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      for (const file of fileArray) {
        const filePath = `${serverId}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('server-documents')
          .upload(filePath, file);

        if (uploadError) throw new Error(`Upload failed for ${file.name}: ${uploadError.message}`);

        const { error: insertError } = await supabase
          .from('server_documents')
          .insert({
            server_id: serverId,
            title: file.name.replace(/\.[^.]+$/, ''),
            description: null,
            file_path: filePath,
            file_name: file.name,
            file_size: file.size,
            file_type: file.type || 'text/plain',
          });

        if (insertError) {
          await supabase.storage.from('server-documents').remove([filePath]);
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

  async function handleDownload(doc: ServerDocument) {
    const { data, error: dlError } = await supabase.storage
      .from('server-documents')
      .createSignedUrl(doc.file_path, 3600);

    if (dlError || !data) {
      setError(`Download failed: ${dlError?.message ?? 'Unknown error'}`);
      return;
    }

    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = doc.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleView(doc: ServerDocument) {
    const { data, error: dlError } = await supabase.storage
      .from('server-documents')
      .createSignedUrl(doc.file_path, 3600);

    if (dlError || !data) {
      setError(`Failed to open file: ${dlError?.message ?? 'Unknown error'}`);
      return;
    }

    window.open(data.signedUrl, '_blank');
  }

  function openAdd() {
    setFormData({ title: '', description: '' });
    setSelectedFile(null);
    setError(null);
    setShowAdd(true);
  }

  function openEdit(doc: ServerDocument) {
    setEditDoc(doc);
    setFormData({ title: doc.title, description: doc.description ?? '' });
    setSelectedFile(null);
    setError(null);
    setShowAdd(true);
  }

  async function handleSaveDoc() {
    setError(null);

    if (editDoc) {
      const updates: Record<string, string> = {};
      if (formData.title !== editDoc.title) updates.title = formData.title;
      if (formData.description !== (editDoc.description ?? '')) updates.description = formData.description;

      if (selectedFile) {
        const newPath = `${serverId}/${Date.now()}-${selectedFile.name}`;
        const { error: uploadError } = await supabase.storage
          .from('server-documents')
          .upload(newPath, selectedFile);
        if (uploadError) {
          setError(`Upload failed: ${uploadError.message}`);
          return;
        }
        await supabase.storage.from('server-documents').remove([editDoc.file_path]);
        updates.file_path = newPath;
        updates.file_name = selectedFile.name;
        updates.file_size = String(selectedFile.size);
        updates.file_type = selectedFile.type || 'text/plain';
      }

      if (Object.keys(updates).length === 0) {
        setShowAdd(false);
        setEditDoc(null);
        return;
      }

      const { error: updateError } = await supabase
        .from('server_documents')
        .update(updates)
        .eq('id', editDoc.id);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setShowAdd(false);
      setEditDoc(null);
      await load();
    } else {
      if (!selectedFile) {
        setError('Please select a file');
        return;
      }
      if (!formData.title.trim()) {
        setError('Title is required');
        return;
      }

      const filePath = `${serverId}/${Date.now()}-${selectedFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from('server-documents')
        .upload(filePath, selectedFile);

      if (uploadError) {
        setError(`Upload failed: ${uploadError.message}`);
        return;
      }

      const { error: insertError } = await supabase
        .from('server_documents')
        .insert({
          server_id: serverId,
          title: formData.title,
          description: formData.description || null,
          file_path: filePath,
          file_name: selectedFile.name,
          file_size: selectedFile.size,
          file_type: selectedFile.type || 'text/plain',
        });

      if (insertError) {
        await supabase.storage.from('server-documents').remove([filePath]);
        setError(insertError.message);
        return;
      }

      setShowAdd(false);
      await load();
    }
  }

  async function handleDelete(doc: ServerDocument) {
    setConfirmDelete(null);
    await supabase.storage.from('server-documents').remove([doc.file_path]);
    await supabase.from('server_documents').delete().eq('id', doc.id);
    await load();
  }

  function formatSize(bytes: number | null): string {
    if (!bytes) return '-';
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
    <div className="card p-5 mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-primary">Documents ({docs.length})</h2>
        {!isReadOnly && (
          <button
            onClick={openAdd}
            className="btn-primary btn-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Document
          </button>
        )}
      </div>

      {error && (
        <div className="alert-error mb-4">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Drag & drop zone */}
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
            accept=".txt,.md,.csv,.json,.xml,.html,.css,.js,.sh,.yaml,.yml,.log,.conf,.cfg,.ini,.env,text/*"
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
            className="hidden"
          />
          <Upload className="w-7 h-7 text-text-faint mx-auto mb-2" />
          <p className="text-sm text-text-secondary font-medium">
            {uploading ? 'Uploading...' : 'Drag & drop files here or click to browse'}
          </p>
          <p className="text-xs text-text-faint mt-1">Supports .txt, .md, .csv, .json, .sh, .yaml and other text files (max 50 MB)</p>
        </div>
      )}

      {loading ? (
        <p className="text-text-muted text-sm">Loading documents...</p>
      ) : docs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-surface-hover text-text-faint mb-3">
            <FileText className="w-6 h-6" />
          </div>
          <p className="text-text-muted text-sm">No documents yet</p>
          <p className="text-text-faint text-xs mt-0.5">Upload .txt or text files to attach to this server</p>
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-border-hover transition-colors group"
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-surface-hover flex-shrink-0">
                <FileText className="w-5 h-5 text-text-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-text-primary truncate">{doc.title}</h3>
                {doc.description && (
                  <p className="text-xs text-text-muted mt-0.5 truncate">{doc.description}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5 text-xs text-text-faint">
                  <span className="font-mono">{doc.file_name}</span>
                  <span>{formatSize(doc.file_size)}</span>
                  <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => handleView(doc)}
                  className="p-1.5 rounded-lg text-text-muted hover:text-sky-500 hover:bg-surface-hover transition-colors"
                  title="View"
                >
                  <FileText className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDownload(doc)}
                  className="p-1.5 rounded-lg text-text-muted hover:text-sky-500 hover:bg-surface-hover transition-colors"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
                {!isReadOnly && (
                  <>
                    <button
                      onClick={() => openEdit(doc)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(doc)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-surface-hover transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      <Modal
        open={showAdd}
        onClose={() => { setShowAdd(false); setEditDoc(null); }}
        title={editDoc ? 'Edit Document' : 'Add Document'}
        size="md"
      >
        {error && (
          <div className="alert-error mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="form-label">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Document title"
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional description"
              rows={3}
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">
              {editDoc ? 'Replace File (optional)' : 'File'} {!editDoc && <span className="text-red-400">*</span>}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept=".txt,.md,.csv,.json,.xml,.html,.css,.js,.sh,.yaml,.yml,.log,.conf,.cfg,.ini,.env,text/*"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                className="text-sm text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-sky-600 file:text-white file:text-sm file:font-medium file:cursor-pointer file:hover:bg-sky-500"
              />
            </div>
            {editDoc && (
              <p className="text-xs text-text-faint mt-1.5">
                Current file: <span className="font-mono">{editDoc.file_name}</span> — select a new file to replace it.
              </p>
            )}
            {selectedFile && (
              <p className="text-xs text-text-secondary mt-1.5">
                Selected: <span className="font-mono">{selectedFile.name}</span> ({formatSize(selectedFile.size)})
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => { setShowAdd(false); setEditDoc(null); }}
            className="btn-ghost"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveDoc}
            disabled={!formData.title.trim() || (!editDoc && !selectedFile)}
            className="btn-primary disabled:opacity-50"
          >
            {editDoc ? 'Save Changes' : 'Add Document'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Document"
        message="Are you sure you want to delete this document? The file will be permanently removed."
        itemName={confirmDelete?.title}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
