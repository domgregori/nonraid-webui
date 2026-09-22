import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cloudflaredApi } from '../../api/cloudflaredApi';
import type { CloudflaredStatus } from '../../types/cloudflaredApi';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import { StepUpModal } from '../shared/StepUpModal';

// Structurally mirrors TailscaleSection.tsx: load/poll status on mount, a ToggleSwitch for the
// feature's own enable flag, inline status-note errors. The token field is step-up gated
// (StepUpModal, same shell SshKeysSection.tsx's add-key flow uses) since a Cloudflare Tunnel
// token is a real bearer credential for whatever ingress rule the dashboard has configured.
export function CloudflaredSection() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<CloudflaredStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  const [tokenDraft, setTokenDraft] = useState('');
  const [settingToken, setSettingToken] = useState(false);

  const [publicUrlDraft, setPublicUrlDraft] = useState('');
  const [savingPublicUrl, setSavingPublicUrl] = useState(false);
  const [publicUrlNote, setPublicUrlNote] = useState<string | null>(null);
  const [publicUrlError, setPublicUrlError] = useState<string | null>(null);
  const [publicUrlInitialized, setPublicUrlInitialized] = useState(false);

  const load = () =>
    cloudflaredApi
      .getStatus()
      .then((s) => {
        setStatus(s);
        if (!publicUrlInitialized) {
          setPublicUrlInitialized(true);
          setPublicUrlDraft(s.publicUrl);
        }
        return s;
      })
      .catch((err) => setLoadError((err as Error).message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleEnabled = async () => {
    if (!status) return;
    setEnabling(true);
    setEnableError(null);
    try {
      await cloudflaredApi.setEnabled(!status.featureEnabled);
      await load();
    } catch (err) {
      setEnableError((err as Error).message);
    } finally {
      setEnabling(false);
    }
  };

  const savePublicUrl = async () => {
    setSavingPublicUrl(true);
    setPublicUrlError(null);
    setPublicUrlNote(null);
    try {
      await cloudflaredApi.setPublicUrl(publicUrlDraft.trim());
      await load();
      setPublicUrlNote(t('CloudflaredSection.saved'));
    } catch (err) {
      setPublicUrlError((err as Error).message);
    } finally {
      setSavingPublicUrl(false);
    }
  };

  if (loadError) return <div className="status-note status-note--error">{loadError}</div>;
  if (!status) return <div className="status-note">{t('CloudflaredSection.loading')}</div>;

  if (!status.installed) {
    return (
      <div className="settings-field toggle-row--bordered">
        <div className="toggle-row__title">{t('CloudflaredSection.title')}</div>
        <div className="toggle-row__desc">
          {t('CloudflaredSection.notInstalled1')} <code>cloudflared</code> {t('CloudflaredSection.notInstalled2')} <code>tools/install-webui.sh</code>{' '}
          {t('CloudflaredSection.notInstalled3')}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-field toggle-row--bordered">
      <div className="toggle-row">
        <div>
          <div className="toggle-row__title">{t('CloudflaredSection.title')}</div>
          <div className="toggle-row__desc">{t('CloudflaredSection.desc')}</div>
        </div>
        <ToggleSwitch on={status.featureEnabled} onToggle={toggleEnabled} label={t('CloudflaredSection.title')} disabled={enabling} />
      </div>
      {enableError && <div className="status-note status-note--error">{enableError}</div>}

      {status.featureEnabled && (
        <>
          <div className="toggle-row__title" style={{ marginTop: 12 }}>
            {t('CloudflaredSection.tunnelStatus')}
          </div>
          <div className="toggle-row__desc">
            {status.running ? t('CloudflaredSection.running') : t('CloudflaredSection.notRunning')}
            {status.version && ` (${status.version})`} · {status.hasToken ? t('CloudflaredSection.tokenSet') : t('CloudflaredSection.tokenNotSet')}
          </div>

          <div className="status-note" style={{ marginTop: 12 }}>
            {t('CloudflaredSection.serviceUrlHint')}
          </div>

          <div className="toggle-row__title" style={{ marginTop: 12 }}>
            {t('CloudflaredSection.tunnelToken')}
          </div>
          <div className="toggle-row__desc">{t('CloudflaredSection.tunnelTokenHint')}</div>
          <div className="settings-field__row">
            <input
              className="history-input"
              style={{ width: '100%' }}
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder={t('CloudflaredSection.tunnelTokenPlaceholder')}
            />
            <button type="button" className="btn" disabled={!tokenDraft.trim()} onClick={() => setSettingToken(true)}>
              {t('CloudflaredSection.save')}
            </button>
          </div>

          <div className="toggle-row__title" style={{ marginTop: 12 }}>
            {t('CloudflaredSection.publicUrl')}
          </div>
          <div className="toggle-row__desc">{t('CloudflaredSection.publicUrlHint')}</div>
          <div className="settings-field__row">
            <input
              className="history-input"
              style={{ width: '100%' }}
              value={publicUrlDraft}
              onChange={(e) => setPublicUrlDraft(e.target.value)}
              placeholder="https://share.example.com"
              disabled={savingPublicUrl}
            />
            <button type="button" className="btn" disabled={savingPublicUrl} onClick={savePublicUrl}>
              {savingPublicUrl ? t('CloudflaredSection.saving') : t('CloudflaredSection.save')}
            </button>
          </div>
          {publicUrlNote && <div className="status-note">{publicUrlNote}</div>}
          {publicUrlError && <div className="status-note status-note--error">{publicUrlError}</div>}
        </>
      )}

      {settingToken && (
        <StepUpModal
          title={t('CloudflaredSection.confirmItsYou')}
          description={t('CloudflaredSection.setTokenDesc')}
          confirmLabel={t('CloudflaredSection.save')}
          onClose={() => setSettingToken(false)}
          onConfirm={async (password, totpCode) => {
            await cloudflaredApi.setToken(tokenDraft.trim(), password, totpCode);
            setTokenDraft('');
            await load();
          }}
        />
      )}
    </div>
  );
}
