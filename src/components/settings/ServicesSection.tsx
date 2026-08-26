import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { servicesApi } from '../../api/servicesApi';
import { sshApi } from '../../api/sshApi';
import { deriveServiceStatusView } from '../../selectors/services';
import { useArrayStatus } from '../../state/useArrayStatus';
import { COLORS } from '../../styles/colors';
import type { ServiceStatus } from '../../types/servicesApi';
import { ReloadDriverPrompt } from '../shared/ReloadDriverPrompt';
import { ToggleSwitch } from '../shared/ToggleSwitch';

type Action = 'start' | 'stop' | 'restart';

const WARNING_KEYS: Record<string, string> = {
  docker: 'ServicesSection.warningContainers',
  lxc: 'ServicesSection.warningContainers',
  smb: 'ServicesSection.warningSmb',
  nfs: 'ServicesSection.warningNfs',
  ssh: 'ServicesSection.warningSsh',
  avahi: 'ServicesSection.warningAvahi',
  tailscale: 'ServicesSection.warningTailscale',
  'rclone-rcd': 'ServicesSection.warningRclone',
};

const HEALTH_POLL_INTERVAL_MS = 2000;
const HEALTH_POLL_TIMEOUT_MS = 30_000;

export function ServicesSection() {
  const { t } = useTranslation('settings');
  const { status: arrayStatus, loadState: arrayLoadState, refresh: refreshArrayStatus } = useArrayStatus();
  // The driver has no systemd unit of its own to poll (see the row below) - a successful array
  // status fetch is itself proof the kernel module is loaded and responding, since nmdctl can't
  // report anything at all otherwise (not even "no array configured yet").
  const driverLabel = arrayStatus ? t('ServicesSection.running') : arrayLoadState === 'error' ? t('ServicesSection.unreachable') : t('ServicesSection.checking');
  const driverColor = arrayStatus ? COLORS.green : arrayLoadState === 'error' ? COLORS.red : COLORS.textDim;
  const [services, setServices] = useState<ServiceStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [webuiReconnecting, setWebuiReconnecting] = useState(false);
  const [webuiReconnectFailed, setWebuiReconnectFailed] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Whether sshd starts on boot - distinct from the service's live active/inactive state above
  // (systemctl is-enabled vs is-active), so it's fetched and toggled separately from the rest of
  // this list.
  const [sshBootEnabled, setSshBootEnabled] = useState<boolean | null>(null);
  const [sshBootSaving, setSshBootSaving] = useState(false);

  const load = () => servicesApi.list().then(setServices).catch((err) => setLoadError((err as Error).message));

  useEffect(() => {
    load();
    sshApi
      .getStatus()
      .then((s) => setSshBootEnabled(s.enabled))
      .catch(() => {});
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const toggleSshBoot = async () => {
    if (sshBootEnabled === null) return;
    setSshBootSaving(true);
    try {
      await sshApi.setEnabled(!sshBootEnabled);
      setSshBootEnabled(!sshBootEnabled);
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setSshBootSaving(false);
    }
  };

  const refresh = async () => {
    try {
      setServices(await servicesApi.list());
    } catch {
      // best-effort - rows simply keep their last known state
    }
  };

  const runAction = async (id: string, action: Action) => {
    setBusyId(id);
    setActionError(null);
    try {
      if (id === 'webui' && action === 'restart') {
        await servicesApi.restart(id).catch(() => {
          // the backend may exit before the response fully arrives - that's expected here
        });
        setWebuiReconnecting(true);
        setWebuiReconnectFailed(false);
        const startedAt = Date.now();
        pollTimer.current = setInterval(async () => {
          try {
            const rows = await servicesApi.list();
            setServices(rows);
            setWebuiReconnecting(false);
            if (pollTimer.current) clearInterval(pollTimer.current);
          } catch {
            if (Date.now() - startedAt > HEALTH_POLL_TIMEOUT_MS) {
              setWebuiReconnecting(false);
              setWebuiReconnectFailed(true);
              if (pollTimer.current) clearInterval(pollTimer.current);
            }
          }
        }, HEALTH_POLL_INTERVAL_MS);
        return;
      }

      await servicesApi[action](id);
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (loadError) return <div className="status-note status-note--error">{loadError}</div>;
  if (!services) return <div className="status-note">{t('ServicesSection.loadingServices')}</div>;

  return (
    <div>
      {actionError && <div className="status-note status-note--error">{actionError}</div>}
      {webuiReconnecting && <div className="status-note">{t('ServicesSection.restartingReconnecting')}</div>}
      {webuiReconnectFailed && <div className="status-note status-note--error">{t('ServicesSection.stillNotBack')}</div>}
      {services.map((service) => {
        const view = deriveServiceStatusView(service.state);
        const busy = busyId === service.id;
        const isWebui = service.id === 'webui';
        return (
          <div key={service.id}>
            <div className="toggle-row toggle-row--bordered">
              <div>
                <div className="toggle-row__title">{service.label}</div>
                <div className="toggle-row__desc" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="docker-card__status-dot" style={{ background: view.color }} />
                  {view.label}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {!isWebui && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || service.state === 'active'}
                      onClick={() => runAction(service.id, 'start')}
                    >
                      {t('ServicesSection.start')}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || service.state === 'inactive'}
                      onClick={() => runAction(service.id, 'stop')}
                    >
                      {t('ServicesSection.stop')}
                    </button>
                  </>
                )}
                <button type="button" className="btn" disabled={busy || webuiReconnecting} onClick={() => runAction(service.id, 'restart')}>
                  {busy || (isWebui && webuiReconnecting) ? t('ServicesSection.working') : t('ServicesSection.restart')}
                </button>
              </div>
            </div>
            {WARNING_KEYS[service.id] && <div className="status-note">{t(WARNING_KEYS[service.id])}</div>}
            {service.id === 'ssh' && (
              <div className="toggle-row">
                <div>
                  <div className="toggle-row__title">{t('ServicesSection.startOnBoot')}</div>
                  <div className="toggle-row__desc">{t('ServicesSection.startOnBootDesc')}</div>
                </div>
                <ToggleSwitch
                  on={sshBootEnabled ?? false}
                  onToggle={toggleSshBoot}
                  label={t('ServicesSection.sshStartOnBoot')}
                  disabled={sshBootEnabled === null || sshBootSaving}
                />
              </div>
            )}
          </div>
        );
      })}
      {/* Not a systemd unit - unlike everything else on this page, "restarting" the kernel driver
          means unloading and reloading the kernel module against the array's own superblock, with
          the array itself stopped/started around it (see ReloadDriverPrompt / /array/reload-driver).
          No independent start/stop concept exists for it, so this only ever offers Restart. */}
      <div>
        <div className="toggle-row toggle-row--bordered">
          <div>
            <div className="toggle-row__title">{t('ServicesSection.nonraidKernelDriver')}</div>
            <div className="toggle-row__desc" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="docker-card__status-dot" style={{ background: driverColor }} />
              {driverLabel}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <ReloadDriverPrompt description={t('ServicesSection.reloadDriverDesc')} onReloaded={refreshArrayStatus} />
          </div>
        </div>
      </div>
    </div>
  );
}
