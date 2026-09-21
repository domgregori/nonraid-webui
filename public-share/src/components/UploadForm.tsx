import { useRef, useState } from 'react';
import { shareApi, type UploadResult } from '../api';
import { streamNdjson } from '../progressStream';

interface UploadFormProps {
  token: string;
  path: string;
  onUploaded?: () => void;
}

interface ProgressTick {
  name: string;
  bytesWritten: number;
}

export function UploadForm({ token, path, onUploaded }: UploadFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ProgressTick | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doUpload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const form = new FormData();
      for (const file of list) form.append('files', file);
      const uploadResult = await streamNdjson<ProgressTick, UploadResult>(shareApi.uploadUrl(token, path), { method: 'POST', credentials: 'include', body: form }, (p) =>
        setProgress(p),
      );
      setResult(uploadResult);
      onUploaded?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div
      className={`ps-upload${dragOver ? ' ps-upload--drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) doUpload(e.dataTransfer.files);
      }}
    >
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => e.target.files && doUpload(e.target.files)} disabled={uploading} />
      <button type="button" className="ps-btn ps-btn--primary" disabled={uploading} onClick={() => inputRef.current?.click()}>
        {uploading ? 'Uploading…' : 'Choose files to upload'}
      </button>
      <p className="ps-upload__hint">or drag and drop files here</p>

      {progress && (
        <div className="ps-note">
          Uploading “{progress.name}” — {(progress.bytesWritten / 1024).toFixed(0)} KB so far…
        </div>
      )}
      {error && <div className="ps-error">{error}</div>}
      {result && (
        <div className="ps-note">
          {result.succeeded.length > 0 && <div>Uploaded: {result.succeeded.map((f) => f.name).join(', ')}</div>}
          {result.failed.length > 0 && (
            <div className="ps-error">
              Failed: {result.failed.map((f) => `${f.name} (${f.error})`).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
