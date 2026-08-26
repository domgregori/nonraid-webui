import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi } from '../../api/authApi';
import type { TwoFactorStatus } from '../../types/authApi';
import { Disable2faDialog } from './Disable2faDialog';

type EnrollStep = 'idle' | 'scanning' | 'backup-codes';

export function TwoFactorSection() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [enrollStep, setEnrollStep] = useState<EnrollStep>('idle');
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollPending, setEnrollPending] = useState(false);
  const [secret, setSecret] = useState('');
  const [qrDataUri, setQrDataUri] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [codesSavedAck, setCodesSavedAck] = useState(false);

  const [showDisableDialog, setShowDisableDialog] = useState(false);

  const [regenPasswordDraft, setRegenPasswordDraft] = useState('');
  const [regenPending, setRegenPending] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const load = () => authApi.twoFactorStatus().then(setStatus).catch((err) => setLoadError((err as Error).message));

  useEffect(() => {
    load();
  }, []);

  const startEnroll = async () => {
    setEnrollPending(true);
    setEnrollError(null);
    try {
      const enrollment = await authApi.totpEnroll();
      setSecret(enrollment.secret);
      setQrDataUri(enrollment.qrDataUri);
      setConfirmCode('');
      setEnrollStep('scanning');
    } catch (err) {
      setEnrollError((err as Error).message);
    } finally {
      setEnrollPending(false);
    }
  };

  const confirmEnroll = async () => {
    setEnrollPending(true);
    setEnrollError(null);
    try {
      const result = await authApi.totpConfirm(confirmCode);
      setBackupCodes(result.backupCodes);
      setCodesSavedAck(false);
      setEnrollStep('backup-codes');
    } catch (err) {
      setEnrollError((err as Error).message);
    } finally {
      setEnrollPending(false);
    }
  };

  const dismissBackupCodes = () => {
    setEnrollStep('idle');
    setBackupCodes([]);
    load();
  };

  const regenerateBackupCodes = async () => {
    setRegenPending(true);
    setRegenError(null);
    try {
      const result = await authApi.regenerateBackupCodes(regenPasswordDraft);
      setRegenPasswordDraft('');
      setBackupCodes(result.backupCodes);
      setCodesSavedAck(false);
      setEnrollStep('backup-codes');
    } catch (err) {
      setRegenError((err as Error).message);
    } finally {
      setRegenPending(false);
    }
  };

  if (loadError) return <div className="status-note status-note--error">{loadError}</div>;
  if (!status) return <div className="status-note">{t('TwoFactorSection.loadingStatus')}</div>;

  if (enrollStep === 'backup-codes') {
    return (
      <div className="settings-field">
        <div className="toggle-row__title">{t('TwoFactorSection.saveBackupCodesTitle')}</div>
        <div className="toggle-row__desc">{t('TwoFactorSection.saveBackupCodesDesc')}</div>
        <div className="backup-codes-grid">
          {backupCodes.map((code) => (
            <code key={code}>{code}</code>
          ))}
        </div>
        <label className="form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={codesSavedAck} onChange={(e) => setCodesSavedAck(e.target.checked)} />
          <span>{t('TwoFactorSection.savedCodesAck')}</span>
        </label>
        <div className="settings-field__row">
          <button type="button" className="btn btn--primary" disabled={!codesSavedAck} onClick={dismissBackupCodes}>
            {t('TwoFactorSection.done')}
          </button>
        </div>
      </div>
    );
  }

  if (enrollStep === 'scanning') {
    return (
      <div className="settings-field">
        <div className="toggle-row__title">{t('TwoFactorSection.scanTitle')}</div>
        <div className="toggle-row__desc">
          {t('TwoFactorSection.scanDesc')} <code>{secret}</code>
        </div>
        <img src={qrDataUri} alt={t('TwoFactorSection.qrAlt')} width={180} height={180} />
        <label className="form-field">
          <span className="form-field__label">{t('TwoFactorSection.codeFromApp')}</span>
          <input
            className="history-input"
            value={confirmCode}
            onChange={(e) => setConfirmCode(e.target.value)}
            autoComplete="one-time-code"
            autoFocus
          />
        </label>
        {enrollError && <div className="status-note status-note--error">{enrollError}</div>}
        <div className="settings-field__row">
          <button type="button" className="btn" disabled={enrollPending} onClick={() => setEnrollStep('idle')}>
            {t('TwoFactorSection.cancel')}
          </button>
          <button type="button" className="btn btn--primary" disabled={enrollPending || !confirmCode} onClick={confirmEnroll}>
            {enrollPending ? t('TwoFactorSection.confirming') : t('TwoFactorSection.confirm')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-field">
      <div className="toggle-row__title">{t('TwoFactorSection.totpTitle')}</div>
      <div className="toggle-row__desc">
        {status.totpEnabled
          ? t('TwoFactorSection.enabledRemaining', { count: status.backupCodesRemaining })
          : t('TwoFactorSection.notEnabled')}
      </div>
      {enrollError && enrollStep === 'idle' && <div className="status-note status-note--error">{enrollError}</div>}
      {status.totpEnabled ? (
        <>
          <div className="settings-field__row">
            <input
              type="password"
              className="history-input"
              value={regenPasswordDraft}
              onChange={(e) => setRegenPasswordDraft(e.target.value)}
              placeholder={t('TwoFactorSection.currentPasswordPlaceholder')}
              autoComplete="current-password"
            />
            <button type="button" className="btn" disabled={regenPending || !regenPasswordDraft} onClick={regenerateBackupCodes}>
              {regenPending ? t('TwoFactorSection.regenerating') : t('TwoFactorSection.regenerateBackupCodes')}
            </button>
          </div>
          {regenError && <div className="status-note status-note--error">{regenError}</div>}
          <div className="settings-field__row">
            <button type="button" className="btn btn--danger" onClick={() => setShowDisableDialog(true)}>
              {t('TwoFactorSection.disableTwoFactor')}
            </button>
          </div>
        </>
      ) : (
        <div className="settings-field__row">
          <button type="button" className="btn btn--primary" disabled={enrollPending} onClick={startEnroll}>
            {enrollPending ? t('TwoFactorSection.starting') : t('TwoFactorSection.enable')}
          </button>
        </div>
      )}

      {showDisableDialog && (
        <Disable2faDialog
          onClose={() => setShowDisableDialog(false)}
          onDone={() => {
            setShowDisableDialog(false);
            load();
          }}
        />
      )}
    </div>
  );
}
