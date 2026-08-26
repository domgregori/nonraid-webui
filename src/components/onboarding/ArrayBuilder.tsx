import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { nmdApi } from '../../api/nmdApi';
import { useAvailableDevices } from '../../hooks/useAvailableDevices';
import { useArrayStatus } from '../../state/useArrayStatus';
import { formatBytesHuman } from '../../utils/format';
import { Card } from '../shared/Card';

// nmdctl's own slot numbering (see backend/src/nmd/superblock.ts's MD_SB_P_IDX): slot 0 is
// always Parity 1, 1-28 are data. A second parity disk, more data disks, and a cache mirror can
// all be added later from the Disks page - see this component's own doc comment for why this
// stays a plain pair of picks instead of trying to plan all of that up front.
const PARITY_SLOT = 0;
const FIRST_DATA_SLOT = 1;

interface ArrayBuilderProps {
  /** Fired once parity + the data disk have committed and the initial parity build has started. */
  onBuilt: () => void;
}

/**
 * Deliberately just two picks - a parity disk and a data disk - not a full multi-disk plan.
 * Confirmed live against nmdctl that anything more ambitious here doesn't actually pay off:
 *
 * - Its own `add` command hard-refuses once the array has any uncommitted data disk (mdState
 *   flips to NEW_ARRAY), so a second data disk can't be queued up alongside the first.
 * - A stop→add→start cycle for a second data disk doesn't work either: `start` after the first
 *   data disk only marks the initial parity build pending, it doesn't run it, and nmdctl then
 *   refuses further adds (ERROR:INVALID_EXPANSION) until that reconstruction has actually
 *   completed - minutes to hours on real disks, not something to await inside one click.
 * - A second parity disk and a cache mirror have no such hard blocker, but folding them in here
 *   just adds more decisions to a screen whose only job is "get the array running" - they're one
 *   click away on the Disks page (and Settings → Cache) once this screen is done.
 *
 * Nothing is sent to nmdctl until "Build Array" - the two picks are local state until then.
 */
export function ArrayBuilder({ onBuilt }: ArrayBuilderProps) {
  const { t } = useTranslation('onboarding');
  const { devices, status: devicesStatus, error: devicesError, refresh } = useAvailableDevices();
  const { status } = useArrayStatus();
  const [parityDevice, setParityDevice] = useState('');
  const [dataDevice, setDataDevice] = useState('');
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildLog, setBuildLog] = useState<string[]>([]);

  // Reopening this screen after parity alone was already committed (e.g. picked up mid-setup) -
  // only the data disk is still needed then, so the parity picker is replaced with a plain note.
  const existingParity = (status?.disks ?? []).find((d) => d.disk_id && d.type === 'P');

  const parity = devices.find((d) => d.device === parityDevice);
  const data = devices.find((d) => d.device === dataDevice);

  const parityKb = existingParity ? existingParity.size_kb : (parity?.sizeKb ?? null);
  const parityTooSmall = !!data && data.sizeKb != null && parityKb != null && parityKb < data.sizeKb;

  const canBuild = (!!existingParity || !!parity) && !!data && !parityTooSmall && !building;

  const appendLog = (line: string) => setBuildLog((prev) => [...prev, line]);

  const handleBuild = async () => {
    if (!data) return;
    setBuilding(true);
    setBuildError(null);
    setBuildLog([]);
    try {
      if (parity && !existingParity) {
        appendLog(t('ArrayBuilder.logAddingParity', { name: parity.model ?? parity.device }));
        const res = await nmdApi.addDisk(PARITY_SLOT, parity.device, false);
        appendLog(res.output);
      }

      appendLog(t('ArrayBuilder.logAddingData', { name: data.model ?? data.device }));
      const res = await nmdApi.addDisk(FIRST_DATA_SLOT, data.device, false);
      appendLog(res.output);

      appendLog(t('ArrayBuilder.logStartingArray'));
      await nmdApi.startArray();
      // start alone only marks the initial parity build pending (resync.pending) - it doesn't run
      // it. parityCheck('CORRECT') is the same action the dashboard's own Parity Check card sends;
      // RealNmdClient.parityCheck() already substitutes in the pending build's own action word for
      // this exact case (confirmed live: without this, parity sits at 0% indefinitely and nmdctl
      // later refuses to add another disk at all).
      appendLog(t('ArrayBuilder.logStartingParityBuild'));
      await nmdApi.parityCheck('CORRECT');

      refresh();
      onBuilt();
    } catch (err) {
      setBuildError((err as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <Card>
      {devicesStatus === 'loading' && <div className="status-note">{t('ArrayBuilder.scanningDevices')}</div>}
      {devicesError && <div className="status-note status-note--error">{devicesError}</div>}
      {devicesStatus === 'ready' && devices.length === 0 && <div className="status-note">{t('ArrayBuilder.noDevicesFound')}</div>}

      {devices.length > 0 && (
        <>
          {existingParity ? (
            <div className="settings-field">
              <div className="toggle-row__title">{t('ArrayBuilder.parityDiskLabel')}</div>
              <div className="status-note">{t('ArrayBuilder.parityAlreadyAssigned', { diskId: existingParity.disk_id })}</div>
            </div>
          ) : (
            <div className="settings-field">
              <div className="toggle-row__title">{t('ArrayBuilder.parityDiskLabel')}</div>
              <div className="toggle-row__desc">{t('ArrayBuilder.parityDesc')}</div>
              <select
                className="history-input"
                style={{ width: '100%' }}
                value={parityDevice}
                disabled={building}
                onChange={(e) => setParityDevice(e.target.value)}
              >
                <option value="">{t('ArrayBuilder.selectDisk')}</option>
                {devices
                  .filter((d) => d.device !== dataDevice)
                  .map((d) => (
                    <option key={d.device} value={d.device}>
                      {d.model ?? d.device} · {d.sizeKb != null ? formatBytesHuman(d.sizeKb * 1024) : t('ArrayBuilder.unknownSize')}
                    </option>
                  ))}
              </select>
              {parity?.locked && <div className="status-note status-note--error">{t('ArrayBuilder.diskLockedWarning')}</div>}
            </div>
          )}

          <div className="settings-field" style={{ marginTop: 10 }}>
            <div className="toggle-row__title">{t('ArrayBuilder.dataDiskLabel')}</div>
            <div className="toggle-row__desc">{t('ArrayBuilder.dataDiskDesc')}</div>
            <select
              className="history-input"
              style={{ width: '100%' }}
              value={dataDevice}
              disabled={building}
              onChange={(e) => setDataDevice(e.target.value)}
            >
              <option value="">{t('ArrayBuilder.selectDisk')}</option>
              {devices
                .filter((d) => d.device !== parityDevice)
                .map((d) => (
                  <option key={d.device} value={d.device}>
                    {d.model ?? d.device} · {d.sizeKb != null ? formatBytesHuman(d.sizeKb * 1024) : t('ArrayBuilder.unknownSize')}
                  </option>
                ))}
            </select>
            {data?.locked && <div className="status-note status-note--error">{t('ArrayBuilder.diskLockedWarning')}</div>}
          </div>
        </>
      )}

      {parityTooSmall && (
        <div className="status-note status-note--error">
          {t('ArrayBuilder.paritySmallWarning', { size: data ? formatBytesHuman(data.sizeKb! * 1024) : '' })}
        </div>
      )}
      {status?.array.state === 'STARTED' && (dataDevice || parityDevice) && (
        <div className="status-note">{t('ArrayBuilder.arrayRunningWarning')}</div>
      )}
      {buildError && <div className="status-note status-note--error">{buildError}</div>}

      {buildLog.length > 0 && <pre className="import-raw-output">{buildLog.join('\n\n')}</pre>}

      <div className="onboarding__actions" style={{ marginTop: 'var(--space-lg)' }}>
        <div className="onboarding__actions-right">
          <button type="button" className="btn btn--primary" disabled={!canBuild} onClick={handleBuild}>
            {building ? t('ArrayBuilder.buildingButton') : t('ArrayBuilder.buildButton')}
          </button>
        </div>
      </div>
    </Card>
  );
}
