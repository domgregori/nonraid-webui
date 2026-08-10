import { useEffect, useRef, useState } from 'react';
import { authApi } from '../api/authApi';
import { cacheApi } from '../api/cacheApi';
import { dockerApi } from '../api/dockerApi';
import { lxcApi } from '../api/lxcApi';
import { nmdApi } from '../api/nmdApi';
import { settingsApi } from '../api/settingsApi';
import { systemApi } from '../api/systemApi';
import { ImportArrayWizard } from '../components/settings/ImportArrayWizard';
import { NotificationEventToggles } from '../components/settings/NotificationEventToggles';
import { ScheduleFields } from '../components/settings/ScheduleFields';
import { ServicesSection } from '../components/settings/ServicesSection';
import { StorageLocationField } from '../components/settings/StorageLocationField';
import { TwoFactorSection } from '../components/settings/TwoFactorSection';
import { ToggleSwitch } from '../components/shared/ToggleSwitch';
import { useSettings } from '../hooks/useSettings';
import { useSystemStats } from '../hooks/useSystemStats';
import { type ThemePreference, useTheme } from '../hooks/useTheme';
import { deriveProtection } from '../selectors/status';
import { useArrayStatus } from '../state/useArrayStatus';
import type { NotificationEventType } from '../types/settingsApi';
import { formatMemLabel, formatUptime } from '../utils/format';

const SECTIONS = [
  { id: 'about', label: 'About' },
  { id: 'network', label: 'Network' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'array', label: 'Array' },
  { id: 'cache', label: 'Cache' },
  { id: 'docker-lxc', label: 'Docker & LXC Storage' },
  { id: 'services', label: 'Services' },
  { id: 'parity', label: 'Parity' },
  { id: 'import', label: 'Import from Unraid' },
  { id: 'shares', label: 'Shares' },
  { id: 'backups', label: 'Backups' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'security', label: 'Security' },
] as const;

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<(typeof SECTIONS)[number]['id']>('about');
  const { settings, loadState, error, saving, saveError, update } = useSettings();
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const stats = useSystemStats();
  const { status } = useArrayStatus();
  const dataDisks = (status?.disks ?? []).filter((d) => d.type === 'data').map((d) => ({ slot: d.slot, label: `Disk ${d.slot}` }));

  const [dockerPruneSaving, setDockerPruneSaving] = useState(false);
  const [dockerPruneResult, setDockerPruneResult] = useState<string | null>(null);
  const [dockerPruneError, setDockerPruneError] = useState<string | null>(null);
  const handlePruneImages = async () => {
    setDockerPruneSaving(true);
    setDockerPruneResult(null);
    setDockerPruneError(null);
    try {
      const result = await dockerApi.pruneImages();
      const mb = (result.spaceReclaimedBytes / 1024 / 1024).toFixed(0);
      setDockerPruneResult(`Removed ${result.imagesDeleted} unused image(s), reclaimed ${mb} MB.`);
    } catch (err) {
      setDockerPruneError((err as Error).message);
    } finally {
      setDockerPruneSaving(false);
    }
  };

  const [lxcPruneSaving, setLxcPruneSaving] = useState(false);
  const [lxcPruneResult, setLxcPruneResult] = useState<string | null>(null);
  const [lxcPruneError, setLxcPruneError] = useState<string | null>(null);
  const handlePruneTemplateCache = async () => {
    setLxcPruneSaving(true);
    setLxcPruneResult(null);
    setLxcPruneError(null);
    try {
      const result = await lxcApi.pruneTemplateCache();
      const mb = (result.spaceReclaimedBytes / 1024 / 1024).toFixed(0);
      setLxcPruneResult(`Cleared template cache, reclaimed ${mb} MB.`);
    } catch (err) {
      setLxcPruneError((err as Error).message);
    } finally {
      setLxcPruneSaving(false);
    }
  };

  const [labelDraft, setLabelDraft] = useState('');
  const [labelResult, setLabelResult] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [labelSaving, setLabelSaving] = useState(false);

  const [reloadConfirming, setReloadConfirming] = useState(false);
  const [reloadStopContainers, setReloadStopContainers] = useState(false);
  const [reloadRunning, setReloadRunning] = useState(false);
  const [reloadResult, setReloadResult] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);

  const [appriseDraft, setAppriseDraft] = useState('');
  const [eventTypesDraft, setEventTypesDraft] = useState<Record<NotificationEventType, boolean>>({} as Record<NotificationEventType, boolean>);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSending, setTestSending] = useState(false);

  const [minFreeSpaceDraft, setMinFreeSpaceDraft] = useState('');
  const [minFreeSpaceSaving, setMinFreeSpaceSaving] = useState(false);
  const [minFreeSpaceError, setMinFreeSpaceError] = useState<string | null>(null);

  const [paritySchedEnabled, setParitySchedEnabled] = useState(false);
  const [paritySchedFrequency, setParitySchedFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [paritySchedDay, setParitySchedDay] = useState(0);
  const [paritySchedDayOfMonth, setParitySchedDayOfMonth] = useState(1);
  const [paritySchedHour, setParitySchedHour] = useState(2);
  const [paritySchedSaving, setParitySchedSaving] = useState(false);

  const [tempAlertsEnabled, setTempAlertsEnabled] = useState(false);
  const [tempAlertsThresholdDraft, setTempAlertsThresholdDraft] = useState('');
  const [tempAlertsSaving, setTempAlertsSaving] = useState(false);
  const [tempAlertsError, setTempAlertsError] = useState<string | null>(null);

  const [cacheEnabled, setCacheEnabled] = useState(false);
  const [cacheEnabledSaving, setCacheEnabledSaving] = useState(false);
  const [cacheEnabledError, setCacheEnabledError] = useState<string | null>(null);
  const [cacheSchedEnabled, setCacheSchedEnabled] = useState(false);
  const [cacheSchedFrequency, setCacheSchedFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [cacheSchedDay, setCacheSchedDay] = useState(0);
  const [cacheSchedDayOfMonth, setCacheSchedDayOfMonth] = useState(1);
  const [cacheSchedHour, setCacheSchedHour] = useState(3);
  const [cacheSchedSaving, setCacheSchedSaving] = useState(false);
  const [cacheMoverSaving, setCacheMoverSaving] = useState(false);
  const [cacheMoverError, setCacheMoverError] = useState<string | null>(null);

  const [backupSchedEnabled, setBackupSchedEnabled] = useState(false);
  const [backupSchedFrequency, setBackupSchedFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [backupSchedDay, setBackupSchedDay] = useState(0);
  const [backupSchedDayOfMonth, setBackupSchedDayOfMonth] = useState(1);
  const [backupSchedHour, setBackupSchedHour] = useState(3);
  const [backupDestDirDraft, setBackupDestDirDraft] = useState('');
  const [backupRetainDraft, setBackupRetainDraft] = useState('7');
  const [backupSchedSaving, setBackupSchedSaving] = useState(false);
  const [backupSchedError, setBackupSchedError] = useState<string | null>(null);

  const [hostnameDraft, setHostnameDraft] = useState('');
  const [hostnameSaving, setHostnameSaving] = useState(false);
  const [hostnameResult, setHostnameResult] = useState<string | null>(null);
  const [hostnameError, setHostnameError] = useState<string | null>(null);

  const [timezones, setTimezones] = useState<string[]>([]);
  const [timezoneDraft, setTimezoneDraft] = useState('');
  const [timezoneSaving, setTimezoneSaving] = useState(false);
  const [timezoneResult, setTimezoneResult] = useState<string | null>(null);
  const [timezoneError, setTimezoneError] = useState<string | null>(null);

  const [showImportWizard, setShowImportWizard] = useState(false);

  const [currentPasswordDraft, setCurrentPasswordDraft] = useState('');
  const [newPasswordDraft, setNewPasswordDraft] = useState('');
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordResult, setPasswordResult] = useState<string | null>(null);

  // Only seed the drafts the first time data arrives — re-syncing on every
  // later status/settings poll would clobber whatever the user is mid-typing
  // (hit this live: typing right after navigating, before the first status
  // fetch resolved, silently reverted the field).
  const labelInitialized = useRef(false);
  const appriseInitialized = useRef(false);
  const minFreeSpaceInitialized = useRef(false);
  const paritySchedInitialized = useRef(false);
  const tempAlertsInitialized = useRef(false);
  const backupSchedInitialized = useRef(false);
  const cacheInitialized = useRef(false);
  const hostnameInitialized = useRef(false);
  const timezoneInitialized = useRef(false);

  useEffect(() => {
    if (status && !labelInitialized.current) {
      setLabelDraft(status.array.label);
      labelInitialized.current = true;
    }
  }, [status]);

  useEffect(() => {
    if (stats && !hostnameInitialized.current) {
      setHostnameDraft(stats.hostname);
      hostnameInitialized.current = true;
    }
  }, [stats]);

  useEffect(() => {
    if (stats && !timezoneInitialized.current) {
      setTimezoneDraft(stats.timezone);
      timezoneInitialized.current = true;
    }
  }, [stats]);

  useEffect(() => {
    systemApi.getTimezones().then(setTimezones).catch(() => {});
  }, []);

  useEffect(() => {
    if (settings && !appriseInitialized.current) {
      setAppriseDraft(settings.notifications.appriseUrls);
      setEventTypesDraft(settings.notifications.eventTypes);
      appriseInitialized.current = true;
    }
  }, [settings]);

  useEffect(() => {
    if (settings && !minFreeSpaceInitialized.current) {
      setMinFreeSpaceDraft(String(settings.minFreeSpaceMb));
      minFreeSpaceInitialized.current = true;
    }
  }, [settings]);

  useEffect(() => {
    if (settings && !paritySchedInitialized.current) {
      setParitySchedEnabled(settings.paritySchedule.enabled);
      setParitySchedFrequency(settings.paritySchedule.frequency);
      setParitySchedDay(settings.paritySchedule.dayOfWeek);
      setParitySchedDayOfMonth(settings.paritySchedule.dayOfMonth);
      setParitySchedHour(settings.paritySchedule.hour);
      paritySchedInitialized.current = true;
    }
  }, [settings]);

  useEffect(() => {
    if (settings && !tempAlertsInitialized.current) {
      setTempAlertsEnabled(settings.tempAlerts.enabled);
      setTempAlertsThresholdDraft(String(settings.tempAlerts.warnAboveCelsius));
      tempAlertsInitialized.current = true;
    }
  }, [settings]);

  useEffect(() => {
    if (settings && !backupSchedInitialized.current) {
      setBackupSchedEnabled(settings.backupSchedule.enabled);
      setBackupSchedFrequency(settings.backupSchedule.frequency);
      setBackupSchedDay(settings.backupSchedule.dayOfWeek);
      setBackupSchedDayOfMonth(settings.backupSchedule.dayOfMonth);
      setBackupSchedHour(settings.backupSchedule.hour);
      setBackupDestDirDraft(settings.backupSchedule.destDir);
      setBackupRetainDraft(String(settings.backupSchedule.retain));
      backupSchedInitialized.current = true;
    }
  }, [settings]);

  useEffect(() => {
    if (settings && !cacheInitialized.current) {
      setCacheEnabled(settings.cache.enabled);
      setCacheSchedEnabled(settings.cacheSchedule.enabled);
      setCacheSchedFrequency(settings.cacheSchedule.frequency);
      setCacheSchedDay(settings.cacheSchedule.dayOfWeek);
      setCacheSchedDayOfMonth(settings.cacheSchedule.dayOfMonth);
      setCacheSchedHour(settings.cacheSchedule.hour);
      cacheInitialized.current = true;
    }
  }, [settings]);

  const arrayStarted = status?.array.state === 'STARTED';

  const toggleCacheEnabled = async () => {
    const next = !cacheEnabled;
    setCacheEnabledSaving(true);
    setCacheEnabledError(null);
    try {
      await cacheApi.setEnabled(next);
      setCacheEnabled(next);
    } catch (err) {
      setCacheEnabledError((err as Error).message);
    } finally {
      setCacheEnabledSaving(false);
    }
  };

  const saveCacheSchedule = async () => {
    setCacheSchedSaving(true);
    await update({
      cacheSchedule: {
        enabled: cacheSchedEnabled,
        frequency: cacheSchedFrequency,
        dayOfWeek: cacheSchedDay,
        dayOfMonth: cacheSchedDayOfMonth,
        hour: cacheSchedHour,
      },
    });
    setCacheSchedSaving(false);
  };

  const runCacheMover = async () => {
    setCacheMoverSaving(true);
    setCacheMoverError(null);
    try {
      await cacheApi.runMover();
    } catch (err) {
      setCacheMoverError((err as Error).message);
    } finally {
      setCacheMoverSaving(false);
    }
  };

  const saveHostname = async () => {
    setHostnameSaving(true);
    setHostnameError(null);
    setHostnameResult(null);
    try {
      const result = await systemApi.setHostname(hostnameDraft.trim());
      setHostnameResult(result.message);
    } catch (err) {
      setHostnameError((err as Error).message);
    } finally {
      setHostnameSaving(false);
    }
  };

  const saveTimezone = async () => {
    setTimezoneSaving(true);
    setTimezoneError(null);
    setTimezoneResult(null);
    try {
      const result = await systemApi.setTimezone(timezoneDraft);
      setTimezoneResult(result.message);
    } catch (err) {
      setTimezoneError((err as Error).message);
    } finally {
      setTimezoneSaving(false);
    }
  };

  const saveLabel = async () => {
    setLabelSaving(true);
    setLabelError(null);
    setLabelResult(null);
    try {
      const result = await nmdApi.setLabel(labelDraft.trim());
      setLabelResult(result.message);
    } catch (err) {
      setLabelError((err as Error).message);
    } finally {
      setLabelSaving(false);
    }
  };

  const handleReloadDriver = async () => {
    setReloadRunning(true);
    setReloadError(null);
    setReloadResult(null);
    try {
      const result = await nmdApi.reloadDriver(reloadStopContainers);
      setReloadResult(result.message);
      setReloadConfirming(false);
    } catch (err) {
      setReloadError((err as Error).message);
    } finally {
      setReloadRunning(false);
    }
  };

  const saveNotifications = () => update({ notifications: { appriseUrls: appriseDraft, eventTypes: eventTypesDraft } });

  const toggleEventType = (eventType: NotificationEventType, enabled: boolean) => {
    setEventTypesDraft((prev) => ({ ...prev, [eventType]: enabled }));
    update({ notifications: { eventTypes: { [eventType]: enabled } } });
  };

  const saveMinFreeSpace = async () => {
    const value = Number(minFreeSpaceDraft);
    if (!Number.isInteger(value) || value < 0) {
      setMinFreeSpaceError('Enter a non-negative whole number of MB.');
      return;
    }
    setMinFreeSpaceSaving(true);
    setMinFreeSpaceError(null);
    await update({ minFreeSpaceMb: value });
    setMinFreeSpaceSaving(false);
  };

  const saveParitySchedule = async () => {
    setParitySchedSaving(true);
    await update({
      paritySchedule: {
        enabled: paritySchedEnabled,
        frequency: paritySchedFrequency,
        dayOfWeek: paritySchedDay,
        dayOfMonth: paritySchedDayOfMonth,
        hour: paritySchedHour,
      },
    });
    setParitySchedSaving(false);
  };

  const saveTempAlerts = async () => {
    const value = Number(tempAlertsThresholdDraft);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setTempAlertsError('Enter a temperature between 0 and 100°C.');
      return;
    }
    setTempAlertsSaving(true);
    setTempAlertsError(null);
    await update({ tempAlerts: { enabled: tempAlertsEnabled, warnAboveCelsius: value } });
    setTempAlertsSaving(false);
  };

  const saveBackupSchedule = async () => {
    const retain = Number(backupRetainDraft);
    if (!Number.isInteger(retain) || retain < 1) {
      setBackupSchedError('Enter a positive whole number for how many backups to keep.');
      return;
    }
    if (backupSchedEnabled && !backupDestDirDraft.trim()) {
      setBackupSchedError('Enter a destination directory before enabling the schedule.');
      return;
    }
    setBackupSchedSaving(true);
    setBackupSchedError(null);
    await update({
      backupSchedule: {
        enabled: backupSchedEnabled,
        frequency: backupSchedFrequency,
        dayOfWeek: backupSchedDay,
        dayOfMonth: backupSchedDayOfMonth,
        hour: backupSchedHour,
        destDir: backupDestDirDraft.trim(),
        retain,
      },
    });
    setBackupSchedSaving(false);
  };

  const sendTest = async () => {
    setTestSending(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await settingsApi.testNotification();
      setTestResult(result.message);
    } catch (err) {
      setTestError((err as Error).message);
    } finally {
      setTestSending(false);
    }
  };

  const changePassword = async () => {
    if (newPasswordDraft !== confirmPasswordDraft) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setPasswordSaving(true);
    setPasswordError(null);
    setPasswordResult(null);
    try {
      await authApi.changePassword(currentPasswordDraft, newPasswordDraft);
      setCurrentPasswordDraft('');
      setNewPasswordDraft('');
      setConfirmPasswordDraft('');
      setPasswordResult('Password changed. Any other signed-in session has been logged out.');
    } catch (err) {
      setPasswordError((err as Error).message);
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-title">Settings</div>

      {loadState === 'error' && <div className="status-note status-note--error">{error}</div>}

      <div className="settings-layout">
        <aside className="settings-sidebar">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`category-item${activeSection === s.id ? ' category-item--active' : ''}`}
              onClick={() => setActiveSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </aside>

        <div className="settings-main">
      <div className={`settings-card${activeSection === 'about' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">About</div>
        <div className="settings-info-grid">
          <InfoRow label="Hostname" value={stats?.hostname ?? '—'} />
          <InfoRow label="Uptime" value={stats ? formatUptime(stats.uptimeSeconds) : '—'} />
          <InfoRow label="CPU" value={stats ? `${Math.round(stats.cpuPercent)}%` : '—'} />
          <InfoRow label="Memory" value={stats ? formatMemLabel(stats.memUsedBytes, stats.memTotalBytes) : '—'} />
          <InfoRow label="Array label" value={status?.array.label || '(unset)'} />
          <InfoRow label="Array health" value={status ? deriveProtection(status).short : '—'} />
          <InfoRow
            label="Array size"
            value={
              status
                ? `${status.array.size.data_disk_count} data disk${status.array.size.data_disk_count === 1 ? '' : 's'}, ${status.array.size.data_gb} GB`
                : '—'
            }
          />
          <InfoRow label="Superblock" value={status?.array.superblock ?? '—'} mono />
          <InfoRow label="Version" value={stats ? `v${stats.version}${stats.buildVersion ? ` (${stats.buildVersion})` : ''}` : '—'} mono />
        </div>

        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Hostname</div>
          <div className="settings-field__row">
            <input
              className="history-input"
              style={{ width: '100%' }}
              value={hostnameDraft}
              onChange={(e) => setHostnameDraft(e.target.value)}
              disabled={!stats}
            />
            <button type="button" className="btn" disabled={hostnameSaving || !stats} onClick={saveHostname}>
              {hostnameSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <div className="toggle-row__desc">Some services (e.g. mDNS/.local advertisement) may need a restart to fully pick up a new hostname.</div>
          {hostnameResult && <div className="status-note">{hostnameResult}</div>}
          {hostnameError && <div className="status-note status-note--error">{hostnameError}</div>}
        </div>

        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Timezone</div>
          <div className="settings-field__row">
            <select className="history-input" style={{ width: '100%' }} value={timezoneDraft} onChange={(e) => setTimezoneDraft(e.target.value)} disabled={!stats}>
              {!timezones.includes(timezoneDraft) && timezoneDraft && <option value={timezoneDraft}>{timezoneDraft}</option>}
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={timezoneSaving || !stats} onClick={saveTimezone}>
              {timezoneSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {timezoneResult && <div className="status-note">{timezoneResult}</div>}
          {timezoneError && <div className="status-note status-note--error">{timezoneError}</div>}
        </div>
      </div>

      <div className={`settings-card${activeSection === 'network' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Network</div>
        <div className="toggle-row__desc" style={{ marginBottom: 10 }}>
          Live interface addresses, read-only — this app doesn't manage network configuration.
        </div>
        {!stats ? (
          <div className="status-note">Loading…</div>
        ) : stats.networkInterfaces.length === 0 ? (
          <div className="status-note">No network interfaces detected.</div>
        ) : (
          stats.networkInterfaces.map((iface, i) => (
            <div key={iface.name} className={`toggle-row${i > 0 ? ' toggle-row--bordered' : ''}`}>
              <div>
                <div className="toggle-row__title">{iface.name}</div>
                <div className="toggle-row__desc toggle-row__desc--mono">
                  {[...iface.ipv4, ...iface.ipv6].join(', ') || '—'}
                  {iface.mac ? ` · ${iface.mac}` : ''}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className={`settings-card${activeSection === 'appearance' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Appearance</div>
        <div className="settings-field">
          <div className="toggle-row__title">Theme</div>
          <div className="toggle-row__desc">Stored in this browser only — doesn't sync across devices.</div>
          <div className="settings-field__row">
            <select className="history-input" value={themePreference} onChange={(e) => setThemePreference(e.target.value as ThemePreference)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
      </div>

      <div className={`settings-card${activeSection === 'array' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Array</div>
        <div className="toggle-row">
          <div>
            <div className="toggle-row__title">Turbo write</div>
            <div className="toggle-row__desc">
              Reconstruct write mode — faster writes, but needs every disk spinning. The driver can't report its
              current setting back, so this switch reflects what was last saved here, not necessarily live kernel
              state after an out-of-band change.
            </div>
          </div>
          <ToggleSwitch
            on={settings?.turboWrite ?? false}
            onToggle={() => settings && update({ turboWrite: !settings.turboWrite })}
            label="Turbo write"
            disabled={!settings || saving}
          />
        </div>
        {saveError && <div className="status-note status-note--error">{saveError}</div>}

        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Array label</div>
          <div className="settings-field__row">
            <input
              className="history-input"
              style={{ width: '100%' }}
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              placeholder="(unset)"
              disabled={!status}
            />
            <button type="button" className="btn" disabled={labelSaving || !status} onClick={saveLabel}>
              {labelSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {arrayStarted && (
            <div className="toggle-row__desc">Stop the array first — nmdctl only allows changing the label while stopped.</div>
          )}
          {labelResult && <div className="status-note">{labelResult}</div>}
          {labelError && <div className="status-note status-note--error">{labelError}</div>}
        </div>

        <div className="toggle-row toggle-row--bordered">
          <div>
            <div className="toggle-row__title">Superblock path</div>
            <div className="toggle-row__desc toggle-row__desc--mono">{status?.array.superblock ?? '—'}</div>
          </div>
        </div>

        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Reload driver</div>
          <div className="toggle-row__desc">
            Reloads the storage driver against the current superblock and re-imports every disk's already-known
            identity — doesn't change which disks are in the array or touch any data, only refreshes stale
            internal state. A routine sequence of unassign/replace operations can leave driver-side counters out
            of sync with reality even when the array otherwise looks healthy; this clears that without waiting
            for it to surface as a real array error. Like any driver reload, the array is briefly unavailable
            while it runs.
          </div>
          {!reloadConfirming ? (
            <div className="settings-field__row">
              <button type="button" className="btn" onClick={() => setReloadConfirming(true)}>
                Reload Driver
              </button>
            </div>
          ) : (
            <>
              <label className="disk-checkbox" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={reloadStopContainers}
                  onChange={(e) => setReloadStopContainers(e.target.checked)}
                  disabled={reloadRunning}
                />
                Stop Docker and running LXC containers first, if needed
              </label>
              <div className="toggle-row__desc">
                {reloadStopContainers
                  ? 'If a disk is busy (e.g. Docker or an LXC container has storage on an array disk), Docker and any running LXC containers are stopped before the reload and started again right after. Leave this off and the reload just fails with a clear error instead — nothing is stopped without your say-so.'
                  : "Off by default: if a disk turns out to be busy, the reload fails with a clear error instead of stopping anything. Check this to let it stop Docker/LXC containers first when that's actually what's blocking it, then restart them automatically afterward."}
              </div>
              <div className="settings-field__row">
                <button type="button" className="btn" disabled={reloadRunning} onClick={() => setReloadConfirming(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn--danger" disabled={reloadRunning} onClick={handleReloadDriver}>
                  {reloadRunning ? 'Reloading…' : 'Confirm Reload'}
                </button>
              </div>
            </>
          )}
          {reloadResult && <div className="status-note">{reloadResult}</div>}
          {reloadError && <div className="status-note status-note--error">{reloadError}</div>}
        </div>
      </div>

      <div className={`settings-card${activeSection === 'cache' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Cache</div>
        <div className="toggle-row">
          <div>
            <div className="toggle-row__title">Use cache for shares</div>
            <div className="toggle-row__desc">
              While on, every share not pinned to a single disk writes to the cache mirror first — set up the mirror
              on the Disks page before enabling this. A scheduled mover then drains cache onto the array below.
            </div>
          </div>
          <ToggleSwitch on={cacheEnabled} onToggle={toggleCacheEnabled} label="Use cache for shares" disabled={!settings || cacheEnabledSaving} />
        </div>
        {cacheEnabledError && <div className="status-note status-note--error">{cacheEnabledError}</div>}

        <div className="toggle-row toggle-row--bordered">
          <div>
            <div className="toggle-row__title">Automatic mover</div>
            <div className="toggle-row__desc">
              Moves everything currently on cache onto the array, per each share's own allocation settings, on the
              schedule below.
            </div>
          </div>
          <ToggleSwitch on={cacheSchedEnabled} onToggle={() => setCacheSchedEnabled((v) => !v)} label="Automatic mover" disabled={!settings} />
        </div>
        <div className="settings-field toggle-row--bordered">
          <ScheduleFields
            frequency={cacheSchedFrequency}
            onFrequencyChange={setCacheSchedFrequency}
            dayOfWeek={cacheSchedDay}
            onDayOfWeekChange={setCacheSchedDay}
            dayOfMonth={cacheSchedDayOfMonth}
            onDayOfMonthChange={setCacheSchedDayOfMonth}
            hour={cacheSchedHour}
            onHourChange={setCacheSchedHour}
            disabled={!settings}
          />
          <div className="settings-field__row">
            <button type="button" className="btn" disabled={cacheSchedSaving || !settings} onClick={saveCacheSchedule}>
              {cacheSchedSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <div className="toggle-row toggle-row--bordered">
          <div>
            <div className="toggle-row__title">Run mover now</div>
            <div className="toggle-row__desc">
              Moves everything currently on cache onto the array right away, outside the schedule above. A file
              that's currently open (e.g. by a running Docker container) is skipped rather than failing the whole
              run — stop anything actively using cache-hosted paths first for a complete move.
            </div>
          </div>
          <button type="button" className="btn" disabled={cacheMoverSaving} onClick={runCacheMover}>
            {cacheMoverSaving ? 'Starting…' : 'Move Now'}
          </button>
        </div>
        {cacheMoverError && <div className="status-note status-note--error">{cacheMoverError}</div>}
      </div>

      <div className={`settings-card${activeSection === 'docker-lxc' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Docker &amp; LXC Storage</div>
        <StorageLocationField
          title="Docker"
          desc="Where Docker images and containers are stored."
          dataDisks={dataDisks}
          getStorage={dockerApi.getStorage}
          moveStorage={dockerApi.moveStorage}
        />
        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Prune unused Docker images</div>
          <div className="toggle-row__desc">
            Removes every Docker image not used by any container, running or stopped — not just dangling/untagged
            ones. Destroying a container already removes its own image if nothing else uses it; this catches
            anything left over from before that (or images pulled but never run).
          </div>
          <button type="button" className="btn" disabled={dockerPruneSaving} onClick={handlePruneImages}>
            {dockerPruneSaving ? 'Pruning…' : 'Prune Images'}
          </button>
          {dockerPruneResult && <div className="status-note">{dockerPruneResult}</div>}
          {dockerPruneError && <div className="status-note status-note--error">{dockerPruneError}</div>}
        </div>
        <StorageLocationField
          title="LXC"
          desc="Where LXC container storage lives."
          dataDisks={dataDisks}
          getStorage={lxcApi.getStorage}
          moveStorage={lxcApi.moveStorage}
        />
        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Clear LXC template cache</div>
          <div className="toggle-row__desc">
            Clears lxc-create's downloaded distro template cache. Unlike Docker images, this is never in use by an
            existing container — each container gets its own full rootfs copy at creation time — so it's always
            safe to clear; the only effect is a slower re-download next time you create a container from the same
            distro/release/arch.
          </div>
          <button type="button" className="btn" disabled={lxcPruneSaving} onClick={handlePruneTemplateCache}>
            {lxcPruneSaving ? 'Clearing…' : 'Clear Cache'}
          </button>
          {lxcPruneResult && <div className="status-note">{lxcPruneResult}</div>}
          {lxcPruneError && <div className="status-note status-note--error">{lxcPruneError}</div>}
        </div>
      </div>

      <div className={`settings-card${activeSection === 'services' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Services</div>
        <ServicesSection />
      </div>

      <div className={`settings-card${activeSection === 'parity' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Parity</div>
        <div className="toggle-row">
          <div>
            <div className="toggle-row__title">Automatic check</div>
            <div className="toggle-row__desc">
              Runs a correcting parity check automatically on the schedule below. Skipped if the array isn't started
              or a check is already running.
            </div>
          </div>
          <ToggleSwitch
            on={paritySchedEnabled}
            onToggle={() => setParitySchedEnabled((v) => !v)}
            label="Automatic check"
            disabled={!settings}
          />
        </div>
        <div className="settings-field toggle-row--bordered">
          <ScheduleFields
            frequency={paritySchedFrequency}
            onFrequencyChange={setParitySchedFrequency}
            dayOfWeek={paritySchedDay}
            onDayOfWeekChange={setParitySchedDay}
            dayOfMonth={paritySchedDayOfMonth}
            onDayOfMonthChange={setParitySchedDayOfMonth}
            hour={paritySchedHour}
            onHourChange={setParitySchedHour}
            disabled={!settings}
          />
          <div className="settings-field__row">
            <button type="button" className="btn" disabled={paritySchedSaving || !settings} onClick={saveParitySchedule}>
              {paritySchedSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className={`settings-card${activeSection === 'import' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Import from Unraid</div>
        <div className="toggle-row__desc">
          Migrating an existing Unraid array? This walks through picking the original superblock file, checking it
          against what's physically connected, and importing only once everything checks out.
        </div>
        <div className="settings-field__row">
          <button type="button" className="btn" onClick={() => setShowImportWizard(true)}>
            Import array…
          </button>
        </div>
      </div>

      {showImportWizard && <ImportArrayWizard onClose={() => setShowImportWizard(false)} />}

      <div className={`settings-card${activeSection === 'shares' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Shares</div>
        <div className="settings-field">
          <div className="toggle-row__title">Minimum free space (MB)</div>
          <div className="toggle-row__desc">
            When a share spans multiple disks, mergerfs won't pick a disk with less free space than this for a new
            file. Its own default is 4096 MB (4 GB) — a sane margin on large disks, but on small disks that can make
            every disk ineligible and every write fail. Applies immediately to every currently-mounted share.
          </div>
          <div className="settings-field__row">
            <input
              className="history-input"
              type="number"
              min={0}
              step={1}
              value={minFreeSpaceDraft}
              onChange={(e) => setMinFreeSpaceDraft(e.target.value)}
              disabled={!settings}
            />
            <button type="button" className="btn" disabled={minFreeSpaceSaving || !settings} onClick={saveMinFreeSpace}>
              {minFreeSpaceSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {minFreeSpaceError && <div className="status-note status-note--error">{minFreeSpaceError}</div>}
        </div>
      </div>

      <div className={`settings-card${activeSection === 'backups' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Backups</div>
        <div className="toggle-row">
          <div>
            <div className="toggle-row__title">Automatic config backup</div>
            <div className="toggle-row__desc">
              Writes a config backup (Samba/NFS config, this app's settings/shares/users, the array superblock) on
              the schedule below. Point this at a directory on the array, not the boot disk — the whole point is
              surviving a boot disk failure.
            </div>
          </div>
          <ToggleSwitch on={backupSchedEnabled} onToggle={() => setBackupSchedEnabled((v) => !v)} label="Automatic config backup" disabled={!settings} />
        </div>
        <div className="settings-field toggle-row--bordered">
          <ScheduleFields
            frequency={backupSchedFrequency}
            onFrequencyChange={setBackupSchedFrequency}
            dayOfWeek={backupSchedDay}
            onDayOfWeekChange={setBackupSchedDay}
            dayOfMonth={backupSchedDayOfMonth}
            onDayOfMonthChange={setBackupSchedDayOfMonth}
            hour={backupSchedHour}
            onHourChange={setBackupSchedHour}
            disabled={!settings}
          />
          <div className="toggle-row__title" style={{ marginTop: 10 }}>
            Destination directory
          </div>
          <div className="settings-field__row">
            <input
              className="history-input"
              style={{ width: '100%' }}
              value={backupDestDirDraft}
              onChange={(e) => setBackupDestDirDraft(e.target.value)}
              placeholder="/mnt/user/backups"
              disabled={!settings}
            />
          </div>
          <div className="toggle-row__title" style={{ marginTop: 10 }}>
            Keep last
          </div>
          <div className="settings-field__row">
            <input
              className="history-input"
              type="number"
              min={1}
              step={1}
              value={backupRetainDraft}
              onChange={(e) => setBackupRetainDraft(e.target.value)}
              disabled={!settings}
            />
            <span className="toggle-row__desc">backups — older ones are pruned automatically.</span>
          </div>
          <div className="settings-field__row">
            <button type="button" className="btn" disabled={backupSchedSaving || !settings} onClick={saveBackupSchedule}>
              {backupSchedSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {backupSchedError && <div className="status-note status-note--error">{backupSchedError}</div>}
        </div>
      </div>

      <div className={`settings-card${activeSection === 'notifications' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Notifications</div>
        <div className="toggle-row">
          <div>
            <div className="toggle-row__title">Event notifications</div>
            <div className="toggle-row__desc">
              Master switch for dispatching notifications via apprise — turns off every event below regardless of
              its own toggle.
            </div>
          </div>
          <ToggleSwitch
            on={settings?.notifications.enabled ?? false}
            onToggle={() => settings && update({ notifications: { enabled: !settings.notifications.enabled } })}
            label="Event notifications"
            disabled={!settings || saving}
          />
        </div>

        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Which events notify</div>
          <div className="toggle-row__desc" style={{ marginBottom: 8 }}>
            Grouped by severity — saves each toggle immediately.
          </div>
          <NotificationEventToggles eventTypes={eventTypesDraft} onChange={toggleEventType} disabled={!settings} />
        </div>

        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Apprise target URLs</div>
          <div className="toggle-row__desc">
            One or more{' '}
            <a href="https://github.com/caronc/apprise#popular-notification-services" target="_blank" rel="noreferrer">
              apprise service URLs
            </a>
            , space or newline separated (e.g. mailto://, discord://, pushover://).
          </div>
          <textarea
            className="history-input settings-textarea"
            value={appriseDraft}
            onChange={(e) => setAppriseDraft(e.target.value)}
            placeholder="mailto://user:pass@gmail.com"
            rows={3}
          />
          <div className="settings-field__row">
            <button type="button" className="btn" disabled={saving} onClick={saveNotifications}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn" disabled={testSending} onClick={sendTest}>
              {testSending ? 'Sending…' : 'Send test notification'}
            </button>
          </div>
          {testResult && <div className="status-note">{testResult}</div>}
          {testError && <div className="status-note status-note--error">{testError}</div>}
        </div>

        <div className="toggle-row toggle-row--bordered">
          <div>
            <div className="toggle-row__title">Temperature alerts</div>
            <div className="toggle-row__desc">
              Notify when the CPU or any array disk reaches this temperature. Fires once when it's crossed, not on
              every check while it stays high.
            </div>
          </div>
          <ToggleSwitch on={tempAlertsEnabled} onToggle={() => setTempAlertsEnabled((v) => !v)} label="Temperature alerts" disabled={!settings} />
        </div>
        <div className="settings-field">
          <div className="settings-field__row">
            <input
              className="history-input"
              type="number"
              min={0}
              max={100}
              step={1}
              value={tempAlertsThresholdDraft}
              onChange={(e) => setTempAlertsThresholdDraft(e.target.value)}
              disabled={!settings}
            />
            <span className="toggle-row__desc">°C</span>
            <button type="button" className="btn" disabled={tempAlertsSaving || !settings} onClick={saveTempAlerts}>
              {tempAlertsSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {tempAlertsError && <div className="status-note status-note--error">{tempAlertsError}</div>}
        </div>
      </div>

      <div className={`settings-card${activeSection === 'security' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Security</div>
        <div className="settings-field">
          <div className="toggle-row__title">Change admin password</div>
          <div className="toggle-row__desc">
            Also signs out every other session — this stateless-cookie design has no other way to revoke a session
            early.
          </div>
          <input
            type="password"
            className="history-input"
            style={{ width: '100%' }}
            value={currentPasswordDraft}
            onChange={(e) => setCurrentPasswordDraft(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
          />
          <input
            type="password"
            className="history-input"
            style={{ width: '100%' }}
            value={newPasswordDraft}
            onChange={(e) => setNewPasswordDraft(e.target.value)}
            placeholder="New password"
            autoComplete="new-password"
          />
          <input
            type="password"
            className="history-input"
            style={{ width: '100%' }}
            value={confirmPasswordDraft}
            onChange={(e) => setConfirmPasswordDraft(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
          />
          <div className="settings-field__row">
            <button type="button" className="btn" disabled={passwordSaving} onClick={changePassword}>
              {passwordSaving ? 'Changing…' : 'Change password'}
            </button>
          </div>
          {passwordResult && <div className="status-note">{passwordResult}</div>}
          {passwordError && <div className="status-note status-note--error">{passwordError}</div>}
        </div>

        <TwoFactorSection />
      </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="settings-info-row">
      <span className="settings-info-row__label">{label}</span>
      <span className={`settings-info-row__value${mono ? ' settings-info-row__value--mono' : ''}`}>{value}</span>
    </div>
  );
}
