import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { smartApi } from '../../api/smartApi';
import { systemApi } from '../../api/systemApi';
import { useSystemStats } from '../../hooks/useSystemStats';
import type { SmartAttributes } from '../../types/smart';
import { formatMemLabel } from '../../utils/format';
import { BenchmarkSection } from './BenchmarkSection';
import { SmartOverviewRows } from './SmartOverviewRows';

interface BootDiskDetailPanelProps {
  onClose: () => void;
}

type SmartLoadState = 'loading' | 'ready' | 'error';

export function BootDiskDetailPanel({ onClose }: BootDiskDetailPanelProps) {
  const { t } = useTranslation('diskDetail');
  const stats = useSystemStats();
  const [smartAttrs, setSmartAttrs] = useState<SmartAttributes | null>(null);
  const [smartLoadState, setSmartLoadState] = useState<SmartLoadState>('loading');

  const bootDevice = stats?.bootDisk?.device ?? null;

  useEffect(() => {
    if (!bootDevice) return;
    let alive = true;
    setSmartLoadState('loading');
    smartApi
      .getAttributesByDevice(bootDevice)
      .then((attrs) => {
        if (!alive) return;
        setSmartAttrs(attrs);
        setSmartLoadState('ready');
      })
      .catch(() => {
        if (alive) setSmartLoadState('error');
      });
    return () => {
      alive = false;
    };
  }, [bootDevice]);

  const boot = stats?.bootDisk;
  if (!boot) return null;

  const usedPct = boot.usedBytes !== null && boot.totalBytes !== null ? Math.round((boot.usedBytes / boot.totalBytes) * 100) : null;

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="detail-panel">
        <div className="detail-panel__head">
          <div className="detail-panel__title">{t('BootDiskDetailPanel.title')}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('BootDiskDetailPanel.close')}>
            &#10005;
          </button>
        </div>

        <div className="detail-panel__body">
          <div className="detail-card">
            <div className="eyebrow">{t('BootDiskDetailPanel.info')}</div>
            <div className="detail-rows">
              <div className="detail-row">
                <span className="detail-row__label">{t('BootDiskDetailPanel.device')}</span>
                <span className="detail-row__value">{boot.device}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">{t('BootDiskDetailPanel.model')}</span>
                <span className="detail-row__value">{boot.model ?? '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">{t('BootDiskDetailPanel.filesystem')}</span>
                <span className="detail-row__value">{boot.filesystem ?? '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">{t('BootDiskDetailPanel.uuid')}</span>
                <span className="detail-row__value">{boot.uuid ?? '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">{t('BootDiskDetailPanel.used')}</span>
                <span className="detail-row__value">
                  {usedPct !== null && boot.usedBytes !== null && boot.totalBytes !== null
                    ? `${formatMemLabel(boot.usedBytes, boot.totalBytes)} (${usedPct}%)`
                    : '-'}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">{t('BootDiskDetailPanel.temperature')}</span>
                <span className="detail-row__value">{boot.tempCelsius !== null ? `${Math.round(boot.tempCelsius)}°C` : '-'}</span>
              </div>
            </div>
          </div>

          <div className="detail-card">
            <div className="eyebrow">{t('BootDiskDetailPanel.smart')}</div>
            {smartLoadState === 'loading' && <div className="status-note">{t('BootDiskDetailPanel.loadingSmart')}</div>}
            {smartLoadState === 'error' && <div className="status-note status-note--error">{t('BootDiskDetailPanel.smartLoadFailed')}</div>}
            {smartLoadState === 'ready' && !smartAttrs && <div className="status-note">{t('BootDiskDetailPanel.noSmartData')}</div>}
            {smartAttrs && <SmartOverviewRows attributes={smartAttrs} />}
          </div>

          <BenchmarkSection
            onRead={(durationSeconds) => systemApi.benchmarkBootRead(durationSeconds)}
            onWrite={(durationSeconds) => systemApi.benchmarkBootWrite(durationSeconds)}
          />
        </div>
      </div>
    </>
  );
}
