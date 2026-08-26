import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { diskQueueApi } from '../../api/diskQueueApi';
import { useAvailableDevices } from '../../hooks/useAvailableDevices';
import { formatBytesHuman } from '../../utils/format';

interface CacheSetupDialogProps {
  onClose: () => void;
  onDone: () => void;
}

/**
 * Picks two devices for the mirror from the same pool AddDiskDialog draws from - refusing to let
 * both picks be the same device is the only extra rule beyond what a single-device picker needs,
 * since cache setup runs mkfs.btrfs across exactly two devices, never one.
 *
 * This dialog's job is just "enqueue and close" - it no longer runs mkfs.btrfs itself. The actual
 * formatting (including the auto-retry-with-force-on-existing-filesystem behavior this dialog
 * used to handle inline, see commit dc2248e) now happens in DiskQueueService.runItem, with its
 * outcome visible on the Disk Queue card / activity log instead of here.
 */
export function CacheSetupDialog({ onClose, onDone }: CacheSetupDialogProps) {
  const { t } = useTranslation('diskDetail');
  const { devices, status: devicesStatus, error: devicesError, refresh } = useAvailableDevices();
  const [deviceA, setDeviceA] = useState('');
  const [deviceB, setDeviceB] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const selectedA = devices.find((d) => d.device === deviceA);
  const selectedB = devices.find((d) => d.device === deviceB);
  const sameDevice = !!deviceA && deviceA === deviceB;
  const canSubmit = !!deviceA && !!deviceB && !sameDevice && !submitting;

  const handleSetup = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const item = await diskQueueApi.enqueueCacheMirror(deviceA, deviceB);
      setResult(
        item.status === 'running'
          ? t('CacheSetupDialog.addedRunning')
          : t('CacheSetupDialog.addedQueued'),
      );
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('CacheSetupDialog.title')}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('CacheSetupDialog.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {!result && (
            <>
              <div className="status-note status-note--error">
                {t('CacheSetupDialog.formatWarning')}
              </div>

              <div className="disk-section-head">
                <div className="toggle-row__desc">{t('CacheSetupDialog.pickTwoDevices')}</div>
                <button type="button" className="disk-section-link disk-section-link--btn" onClick={refresh}>
                  {t('CacheSetupDialog.refresh')} &#8635;
                </button>
              </div>

              {devicesStatus === 'loading' && <div className="status-note">{t('CacheSetupDialog.scanning')}</div>}
              {devicesError && <div className="status-note status-note--error">{devicesError}</div>}
              {devicesStatus === 'ready' && devices.length < 2 && (
                <div className="status-note">
                  {devices.length === 0 ? t('CacheSetupDialog.noDevicesFound') : t('CacheSetupDialog.onlyOneDevice')}
                </div>
              )}

              {devices.length > 0 && (
                <div className="settings-field">
                  <div className="toggle-row__title">{t('CacheSetupDialog.firstDevice')}</div>
                  <select className="history-input" style={{ width: '100%' }} value={deviceA} onChange={(e) => setDeviceA(e.target.value)}>
                    <option value="">{t('CacheSetupDialog.selectDevice')}</option>
                    {devices.map((d) => (
                      <option key={d.device} value={d.device}>
                        {d.model ?? d.device} · {d.sizeKb != null ? formatBytesHuman(d.sizeKb * 1024) : t('CacheSetupDialog.unknownSize')}
                      </option>
                    ))}
                  </select>
                  {selectedA?.locked && (
                    <div className="status-note status-note--error">{t('CacheSetupDialog.lockedWarning')}</div>
                  )}

                  <div className="toggle-row__title" style={{ marginTop: 10 }}>
                    {t('CacheSetupDialog.secondDevice')}
                  </div>
                  <select className="history-input" style={{ width: '100%' }} value={deviceB} onChange={(e) => setDeviceB(e.target.value)}>
                    <option value="">{t('CacheSetupDialog.selectDevice')}</option>
                    {devices.map((d) => (
                      <option key={d.device} value={d.device}>
                        {d.model ?? d.device} · {d.sizeKb != null ? formatBytesHuman(d.sizeKb * 1024) : t('CacheSetupDialog.unknownSize')}
                      </option>
                    ))}
                  </select>
                  {selectedB?.locked && (
                    <div className="status-note status-note--error">{t('CacheSetupDialog.lockedWarning')}</div>
                  )}
                  {sameDevice && <div className="status-note status-note--error">{t('CacheSetupDialog.pickDifferent')}</div>}
                </div>
              )}

              {error && <div className="status-note status-note--error">{error}</div>}
            </>
          )}

          {result && <div className="status-note">{result} {t('CacheSetupDialog.watchProgress')}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              {result ? t('CacheSetupDialog.close') : t('CacheSetupDialog.cancel')}
            </button>
            {!result && (
              <button type="button" className="btn--primary" disabled={!canSubmit} onClick={handleSetup}>
                {submitting ? t('CacheSetupDialog.settingUp') : t('CacheSetupDialog.setUpMirror')}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
