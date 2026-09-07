import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { luksApi } from '../../api/luksApi';
import { LuksUnlockModeDialog } from '../disk-detail/LuksUnlockModeDialog';
import { deriveDisks } from '../../selectors/disks';
import { useSettings } from '../../hooks/useSettings';
import { useArrayStatus } from '../../state/useArrayStatus';
import { COLORS } from '../../styles/colors';
import type { LuksStatusResponse } from '../../types/luksApi';

/**
 * Array-wide encryption overview - the "Change unlock method" action (switching every currently-
 * unlocked encrypted disk between stored/manual, see LuksUnlockModeDialog's own doc comment) lived
 * only on a per-disk card before this (disk-detail/LuksSection.tsx), which is an odd home for an
 * operation that touches every encrypted disk at once, not just the one being viewed. This section
 * doesn't replace that per-disk entry point (still handy while already looking at one disk) - it
 * gives the same switch its own array-level home, alongside a plain summary of which disks are
 * actually encrypted right now, without needing to open each one to check.
 */
export function EncryptionSection() {
  const { t } = useTranslation('settings');
  const { status: arrayStatus, temps } = useArrayStatus();
  const { settings } = useSettings();
  const [luksStatus, setLuksStatus] = useState<LuksStatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showModeDialog, setShowModeDialog] = useState(false);

  const load = () =>
    luksApi
      .getStatus()
      .then(setLuksStatus)
      .catch((err) => setLoadError((err as Error).message));

  useEffect(() => {
    load();
  }, []);

  if (loadError) return <div className="status-note status-note--error">{loadError}</div>;
  if (!luksStatus) return <div className="status-note">{t('EncryptionSection.loading')}</div>;

  // Same abbreviated deriveDisks() call StatCards/LuksLockedCard already use when only per-disk
  // slot/label/encryption is needed, not the full health/SMART join DiskDetailPanel needs.
  const disks = arrayStatus ? deriveDisks(arrayStatus, temps, {}, {}, {}, {}, settings?.diskLabels ?? {}).data.filter((d) => d.encryption !== 'none') : [];
  const lockedCount = disks.filter((d) => d.encryption === 'luks-locked').length;

  if (disks.length === 0) {
    return (
      <div className="settings-field toggle-row--bordered">
        <div className="toggle-row__title">{t('EncryptionSection.title')}</div>
        <div className="toggle-row__desc">{t('EncryptionSection.noneDesc')}</div>
      </div>
    );
  }

  return (
    <div className="settings-field toggle-row--bordered">
      <div className="toggle-row__title">{t('EncryptionSection.title')}</div>
      <div className="toggle-row__desc">{t('EncryptionSection.desc')}</div>

      <div className="detail-row" style={{ marginTop: 12 }}>
        <span className="detail-row__label">{t('EncryptionSection.unlockMode')}</span>
        <span className="detail-row__value">{luksStatus.unlockMode === 'stored' ? t('EncryptionSection.modeStored') : t('EncryptionSection.modeManual')}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">{t('EncryptionSection.keyfile')}</span>
        <span className="detail-row__value">{luksStatus.keyfileExists ? t('EncryptionSection.keyfileYes') : t('EncryptionSection.keyfileNo')}</span>
      </div>

      <div className="luks-locked-list" style={{ marginTop: 12 }}>
        {disks.map((d) => (
          <div key={d.slot} className="luks-locked-row">
            <span className="luks-locked-row__label">{d.customLabel ?? d.label}</span>
            <span style={{ color: d.encryption === 'luks-locked' ? COLORS.red : COLORS.textDim }}>
              {d.encryption === 'luks-locked' ? t('EncryptionSection.locked') : t('EncryptionSection.unlocked')}
            </span>
          </div>
        ))}
      </div>

      {lockedCount > 0 && <div className="status-note status-note--error">{t('EncryptionSection.lockedNote', { count: lockedCount })}</div>}

      <div className="settings-field__row" style={{ marginTop: 12 }}>
        <button type="button" className="btn" onClick={() => setShowModeDialog(true)}>
          {t('EncryptionSection.changeUnlockMethod')}
        </button>
      </div>

      {showModeDialog && <LuksUnlockModeDialog currentMode={luksStatus.unlockMode} onClose={() => setShowModeDialog(false)} onDone={load} />}
    </div>
  );
}
