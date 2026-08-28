import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiTokenApi } from '../../api/apiTokenApi';
import type { ApiTokenEntry, CreatedApiToken } from '../../types/apiTokenApi';
import { formatRelativeTime } from '../../utils/format';
import { StepUpModal } from '../shared/StepUpModal';

/** Long-lived bearer tokens for the `nonraid` CLI (or any other non-browser client) - list/create/
 *  revoke. Creating one is step-up gated like adding a trusted SSH key (SshKeysSection.tsx) - it
 *  grants durable API access. Revoking one is not - removing access is strictly safety-positive, so
 *  it's just the same click-once-to-arm "Confirm?" pattern BrowsePage.tsx's own Delete button uses,
 *  no re-auth modal. Creation also gets a one-time reveal step for the raw token right after,
 *  mirroring TwoFactorSection.tsx's backup-codes reveal: the value is shown exactly once and never
 *  again. */
export function ApiTokensSection() {
  const { t } = useTranslation('settings');
  const [tokens, setTokens] = useState<ApiTokenEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmingCreate, setConfirmingCreate] = useState(false);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<CreatedApiToken | null>(null);
  const [savedAck, setSavedAck] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'selected'>('idle');
  const revealRef = useRef<HTMLDivElement>(null);

  const load = () =>
    apiTokenApi
      .list()
      .then(setTokens)
      .catch((err) => setLoadError((err as Error).message));

  useEffect(() => {
    load();
  }, []);

  const handleRevokeClick = async (id: string) => {
    if (armedId !== id) {
      setArmedId(id);
      return;
    }
    setArmedId(null);
    setRevokeError(null);
    try {
      await apiTokenApi.revoke(id);
      await load();
    } catch (err) {
      setRevokeError((err as Error).message);
    }
  };

  // navigator.clipboard is only exposed on a secure context (HTTPS) - this app also runs over
  // plain HTTP (a normal, supported mode - see Settings > Security), where it's undefined
  // entirely, not just permission-denied. Fall back to selecting the token's text so the user can
  // still copy it with Ctrl/Cmd+C, rather than a button that silently does nothing.
  const copyToken = async () => {
    if (!revealed) return;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(revealed.token);
        setCopyState('copied');
        return;
      } catch {
        // fall through to the selection fallback below
      }
    }
    const el = revealRef.current;
    const selection = window.getSelection();
    if (el && selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      setCopyState('selected');
    }
  };

  const dismissReveal = () => {
    setRevealed(null);
    setSavedAck(false);
    setCopyState('idle');
  };

  if (revealed) {
    return (
      <div className="settings-field">
        <div className="toggle-row__title">{t('ApiTokensSection.revealTitle')}</div>
        <div className="toggle-row__desc">{t('ApiTokensSection.revealDesc')}</div>
        <div className="api-token-reveal" ref={revealRef}>
          {revealed.token}
        </div>
        <div className="settings-field__row">
          <button type="button" className="btn" onClick={copyToken}>
            {copyState === 'copied' ? t('ApiTokensSection.copied') : copyState === 'selected' ? t('ApiTokensSection.selectedForCopy') : t('ApiTokensSection.copy')}
          </button>
        </div>
        <label className="form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={savedAck} onChange={(e) => setSavedAck(e.target.checked)} />
          <span>{t('ApiTokensSection.savedAck')}</span>
        </label>
        <div className="settings-field__row">
          <button type="button" className="btn btn--primary" disabled={!savedAck} onClick={dismissReveal}>
            {t('ApiTokensSection.done')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-field">
      <div className="toggle-row__title">{t('ApiTokensSection.title')}</div>
      <div className="toggle-row__desc">{t('ApiTokensSection.desc')}</div>

      {loadError && <div className="status-note status-note--error">{loadError}</div>}
      {revokeError && <div className="status-note status-note--error">{revokeError}</div>}

      {tokens && tokens.length > 0 && (
        <div className="remote-list">
          {tokens.map((tok) => (
            <div className="remote-row" key={tok.id}>
              <div className="remote-row__body">
                <div className="remote-row__name">{tok.name}</div>
                <div className="remote-row__meta">
                  {t('ApiTokensSection.created', { time: formatRelativeTime(tok.createdAt) })} ·{' '}
                  {tok.lastUsedAt ? t('ApiTokensSection.lastUsed', { time: formatRelativeTime(tok.lastUsedAt) }) : t('ApiTokensSection.neverUsed')}
                </div>
              </div>
              <div className="remote-row__actions">
                <button type="button" className="btn btn--danger" onClick={() => handleRevokeClick(tok.id)}>
                  {armedId === tok.id ? t('ApiTokensSection.confirm') : t('ApiTokensSection.revoke')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {tokens && tokens.length === 0 && <div className="status-note">{t('ApiTokensSection.noTokens')}</div>}

      <input
        type="text"
        className="history-input"
        style={{ width: '100%' }}
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        placeholder={t('ApiTokensSection.namePlaceholder')}
      />
      <div className="settings-field__row">
        <button type="button" className="btn" disabled={!nameDraft.trim()} onClick={() => setConfirmingCreate(true)}>
          {t('ApiTokensSection.createToken')}
        </button>
      </div>

      {confirmingCreate && (
        <StepUpModal
          title={t('ApiTokensSection.confirmItsYou')}
          description={t('ApiTokensSection.createTokenDesc')}
          confirmLabel={t('ApiTokensSection.createToken')}
          onClose={() => setConfirmingCreate(false)}
          onConfirm={async (password, totpCode) => {
            const created = await apiTokenApi.create(nameDraft.trim(), password, totpCode);
            setNameDraft('');
            setRevealed(created);
            await load();
          }}
        />
      )}
    </div>
  );
}
