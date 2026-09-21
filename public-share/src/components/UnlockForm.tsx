import { useState } from 'react';
import type { ShareInfo } from '../api';

interface UnlockFormProps {
  info: ShareInfo;
  onUnlock: (password: string) => Promise<void>;
}

const MODE_LABEL: Record<ShareInfo['mode'], string> = {
  'read-only': 'Browse and download',
  'upload-only': 'Upload files',
  editable: 'Browse, download, and edit',
};

export function UnlockForm({ info, onUnlock }: UnlockFormProps) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onUnlock(password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ps-card ps-unlock">
      <h1 className="ps-title">{info.label || 'Shared files'}</h1>
      <p className="ps-subtitle">{MODE_LABEL[info.mode]}</p>
      {info.requiresPassword ? (
        <form onSubmit={submit}>
          <label className="ps-field">
            <span>Password</span>
            <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting} />
          </label>
          {error && <div className="ps-error">{error}</div>}
          <button type="submit" className="ps-btn ps-btn--primary" disabled={submitting || !password}>
            {submitting ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>
      ) : (
        <button type="button" className="ps-btn ps-btn--primary" disabled={submitting} onClick={() => onUnlock('')}>
          {submitting ? 'Loading…' : 'Continue'}
        </button>
      )}
    </div>
  );
}
