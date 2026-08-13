import { useEffect, useRef, useState } from 'react';
import { authApi } from '../api/authApi';
import { cacheApi } from '../api/cacheApi';
import { dockerApi } from '../api/dockerApi';
import { lxcApi } from '../api/lxcApi';
import { nmdApi } from '../api/nmdApi';
import { settingsApi } from '../api/settingsApi';
import { systemApi } from '../api/systemApi';
import { ConfigRestoreWizard } from '../components/settings/ConfigRestoreWizard';
import { ImportArrayWizard } from '../components/settings/ImportArrayWizard';
import { LogsSection } from '../components/settings/LogsSection';
import { NotificationEventToggles } from '../components/settings/NotificationEventToggles';
import { PasskeySection } from '../components/settings/PasskeySection';
import { ScheduleFields } from '../components/settings/ScheduleFields';
import { ServicesSection } from '../components/settings/ServicesSection';
import { StorageLocationField } from '../components/settings/StorageLocationField';
import { TlsSection } from '../components/settings/TlsSection';
import { TwoFactorSection } from '../components/settings/TwoFactorSection';
import { PathAutocomplete } from '../components/shared/PathAutocomplete';
import { ToggleSwitch } from '../components/shared/ToggleSwitch';
import { useSettings } from '../hooks/useSettings';
import { useSystemStats } from '../hooks/useSystemStats';
import { type ThemePreference, useTheme } from '../hooks/useTheme';
import { deriveProtection } from '../selectors/status';
import { useOnboarding } from '../state/OnboardingContext';
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
  { id: 'logs', label: 'System Logs' },
  { id: 'parity', label: 'Parity' },
  { id: 'import', label: 'Import from Unraid' },
  { id: 'shares', label: 'Pools' },
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
  const { replay } = useOnboarding();
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

  const [rebootConfirming, setRebootConfirming] = useState(false);
  const [rebootRunning, setRebootRunning] = useState(false);
  const [rebootResult, setRebootResult] = useState<string | null>(null);
  const [rebootError, setRebootError] = useState<string | null>(null);

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

  const [cpuTempThresholdDraft, setCpuTempThresholdDraft] = useState('');
  const [diskTempThresholdDraft, setDiskTempThresholdDraft] = useState('');
  const [cpuTempThresholdSaving, setCpuTempThresholdSaving] = useState(false);
  const [diskTempThresholdSaving, setDiskTempThresholdSaving] = useState(false);
  const [cpuTempThresholdError, setCpuTempThresholdError] = useState<string | null>(null);
  const [diskTempThresholdError, setDiskTempThresholdError] = useState<string | null>(null);

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
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupRunResult, setBackupRunResult] = useState<string | null>(null);
  const [backupRunError, setBackupRunError] = useState<string | null>(null);

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
  const [showConfigRestoreWizard, setShowConfigRestoreWizard] = useState(false);

  const [currentPasswordDraft, setCurrentPasswordDraft] = useState('');
  const [newPasswordDraft, setNewPasswordDraft] = useState('');
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordResult, setPasswordResult] = useState<string | null>(null);

  // Only seed the drafts the first time data arrives - re-syncing on every
  // later status/settings poll would clobber whatever the user is mid-typing
  // (hit this live: typing right after navigating, before the first status
  // fetch resolved, silently reverted the field).
  const labelInitialized = useRef(false);
  const appriseInitialized = useRef(false);
  const minFreeSpaceInitialized = useRef(false);
  const paritySchedInitialized = useRef(false);
  const tempThresholdInitialized = useRef(false);
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
      setMinFreeSpaceDraft(String(settings.minFreeSpaceGb));
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
    if (settings && !tempThresholdInitialized.current) {
      setCpuTempThresholdDraft(String(settings.tempAlerts.cpuWarnAboveCelsius));
      setDiskTempThresholdDraft(String(settings.tempAlerts.diskWarnAboveCelsius));
      tempThresholdInitialized.current = true;
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

  const handleReboot = async () => {
    setRebootRunning(true);
    setRebootError(null);
    setRebootResult(null);
    try {
      const result = await systemApi.reboot();
      setRebootResult(result.message);
      setRebootConfirming(false);
    } catch (err) {
      setRebootError((err as Error).message);
    } finally {
      setRebootRunning(false);
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
    await update({ minFreeSpaceGb: value });
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

  const saveCpuTempThreshold = async () => {
    const value = Number(cpuTempThresholdDraft);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setCpuTempThresholdError('Enter a temperature between 0 and 100°C.');
      return;
    }
    setCpuTempThresholdSaving(true);
    setCpuTempThresholdError(null);
    await update({ tempAlerts: { cpuWarnAboveCelsius: value } });
    setCpuTempThresholdSaving(false);
  };

  const saveDiskTempThreshold = async () => {
    const value = Number(diskTempThresholdDraft);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setDiskTempThresholdError('Enter a temperature between 0 and 100°C.');
      return;
    }
    setDiskTempThresholdSaving(true);
    setDiskTempThresholdError(null);
    await update({ tempAlerts: { diskWarnAboveCelsius: value } });
    setDiskTempThresholdSaving(false);
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

  const runBackupNow = async () => {
    setBackupRunning(true);
    setBackupRunError(null);
    setBackupRunResult(null);
    try {
      const { bytes } = await systemApi.runBackupNow();
      const sizeLabel = bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
      setBackupRunResult(`Backup written (${sizeLabel}).`);
    } catch (err) {
      setBackupRunError((err as Error).message);
    } finally {
      setBackupRunning(false);
    }
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
          <InfoRow label="Hostname" value={stats?.hostname ?? '-'} />
          <InfoRow label="Uptime" value={stats ? formatUptime(stats.uptimeSeconds) : '-'} />
          <InfoRow label="CPU" value={stats ? `${Math.round(stats.cpuPercent)}%` : '-'} />
          <InfoRow label="Memory" value={stats ? formatMemLabel(stats.memUsedBytes, stats.memTotalBytes) : '-'} />
          <InfoRow label="Array label" value={status?.array.label || '(unset)'} />
          <InfoRow label="Array health" value={status ? deriveProtection(status).short : '-'} />
          <InfoRow
            label="Array size"
            value={
              status
                ? `${status.array.size.data_disk_count} data disk${status.array.size.data_disk_count === 1 ? '' : 's'}, ${status.array.size.data_gb} GB`
                : '-'
            }
          />
          <InfoRow label="Superblock" value={status?.array.superblock ?? '-'} mono />
          <InfoRow label="Version" value={stats ? `v${stats.version}${stats.buildVersion ? ` (${stats.buildVersion})` : ''}` : '-'} mono />
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

        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Setup tour</div>
          <div className="toggle-row__desc">Walk back through array setup, cache, and the Apps/Docker/LXC/Notifications tour.</div>
          <button type="button" className="btn" style={{ marginTop: 6 }} onClick={replay}>
            Replay setup tour
          </button>
        </div>

        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Reboot system</div>
          <div className="toggle-row__desc">
            Reboots the whole host, not just this app. The array stops and unmounts cleanly first (the normal
            shutdown sequence - same as if you ran this at the console), then Docker, LXC, Samba, and NFS all stop
            too. Everything comes back on its own once the host finishes booting; this page reconnects
            automatically, no need to refresh by hand.
          </div>
          {!rebootConfirming ? (
            <div className="settings-field__row">
              <button type="button" className="btn" onClick={() => setRebootConfirming(true)}>
                Reboot System
              </button>
            </div>
          ) : (
            <div className="settings-field__row">
              <button type="button" className="btn" disabled={rebootRunning} onClick={() => setRebootConfirming(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn--danger" disabled={rebootRunning} onClick={handleReboot}>
                {rebootRunning ? 'Rebooting…' : 'Confirm Reboot'}
              </button>
            </div>
          )}
          {rebootResult && <div className="status-note">{rebootResult}</div>}
          {rebootError && <div className="status-note status-note--error">{rebootError}</div>}
        </div>
      </div>

      <div className={`settings-card${activeSection === 'network' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Network</div>
        <div className="toggle-row__desc" style={{ marginBottom: 10 }}>
          Interface addresses
        </div>
        {!stats ? (
          <div className="status-note">Loading…</div>
        ) : stats.networkInterfaces.length === 0 ? (
          <div className="status-note">No network interfaces detected.</div>
        ) : (
          stats.networkInterfaces.map((iface, i) => (
            <div key={iface.name} className={`toggle-row${i > 0 ? ' toggle-row--bordered' : ''}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
                <div className="toggle-row__title">{iface.name}</div>
                <InfoRow label="IPv4" value={iface.ipv4.join(', ') || '-'} mono />
                <InfoRow label="IPv6" value={iface.ipv6.join(', ') || '-'} mono />
                <InfoRow label="MAC" value={iface.mac ?? '-'} mono />
              </div>
            </div>
          ))
        )}
      </div>

      <div className={`settings-card${activeSection === 'appearance' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Appearance</div>
        <div className="settings-field">
          <div className="toggle-row__title">Theme</div>
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
              Faster writes but at the expense of more power draw and all drives must be spun up on HDDs.
              Best for large transfters, rebuilds, and parity checks.
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
            <div className="toggle-row__desc">Array must be stopped first.</div>
          )}
          {labelResult && <div className="status-note">{labelResult}</div>}
          {labelError && <div className="status-note status-note--error">{labelError}</div>}
        </div>

        <div className="toggle-row toggle-row--bordered">
          <div>
            <div className="toggle-row__title">Superblock path</div>
            <div className="toggle-row__desc toggle-row__desc--mono">{status?.array.superblock ?? '-'}</div>
          </div>
        </div>

        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Reload driver</div>
          <div className="toggle-row__desc">
            Reloads the storage driver and re-imports every disk's already-known
            identity
            <br />
            A routine sequence of unassign/replace operations can leave driver-side counters out
            of sync; this clears that without waiting
            for it to surface as a real array error.
            <br />
            The array is briefly unavailable while it runs and containers must be stopped if stored on array.
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
                  ? 'If a disk is busy (e.g. Docker or an LXC container has storage on an array disk), Docker and any running LXC containers are stopped before the reload and started again right after. Leave this off and the reload just fails with a clear error instead - nothing is stopped without your say-so.'
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
            <div className="toggle-row__title">Use cache for pools</div>
            <div className="toggle-row__desc">
              Writes to the cache mirror first. A scheduled mover then drains cache onto the array below. Speeds up read/writes.
            </div>
          </div>
          <ToggleSwitch on={cacheEnabled} onToggle={toggleCacheEnabled} label="Use cache for shares" disabled={!settings || cacheEnabledSaving} />
        </div>
        {cacheEnabledError && <div className="status-note status-note--error">{cacheEnabledError}</div>}

        <div className="toggle-row toggle-row--bordered">
          <div>
            <div className="toggle-row__title">Automatic mover</div>
            <div className="toggle-row__desc">
              Moves everything on cache onto the array.
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

        <div className="settings-field toggle-row--bordered">
          <div>
            <div className="toggle-row__title">Run mover now</div>
            <div className="toggle-row__desc">
              Moves cache onto the array now.
              <br />
              A file that's currently open (e.g. by a running Docker container) is skipped rather than failing the whole
              run.
              <br />
              Stop anything actively using cache-hosted paths first for a complete move.
            </div>
          </div>
          <div className="settings-field__row">
            <button type="button" className="btn" disabled={cacheMoverSaving} onClick={runCacheMover}>
              {cacheMoverSaving ? 'Starting…' : 'Move'}
            </button>
          </div>
        </div>
        {cacheMoverError && <div className="status-note status-note--error">{cacheMoverError}</div>}
      </div>

      <div className={`settings-card${activeSection === 'docker-lxc' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Docker &amp; LXC Storage</div>
        <StorageLocationField
          title="Docker"
          desc="Location of docker system and image file storage."
          dataDisks={dataDisks}
          getStorage={dockerApi.getStorage}
          moveStorage={dockerApi.moveStorage}
        />
        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Prune unused Docker images</div>
          <div className="toggle-row__desc">
            Remove unused docker images.
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
            Remove LXC distro cache.
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

      <div className={`settings-card${activeSection === 'logs' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">System Logs</div>
        <LogsSection active={activeSection === 'logs'} />
      </div>

      <div className={`settings-card${activeSection === 'parity' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Parity</div>
        <div className="toggle-row">
          <div>
            <div className="toggle-row__title">Automatic check</div>
            <div className="toggle-row__desc">
              Schedule a parity check.
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
        <div className="settings-card__title">Import Array</div>
        <div className="toggle-row__desc">
          Migrate from a previous NonRAID or Unraid array.
        </div>
        <div className="settings-field__row">
          <button type="button" className="btn" onClick={() => setShowImportWizard(true)}>
            Import array…
          </button>
        </div>
      </div>

      {showImportWizard && <ImportArrayWizard onClose={() => setShowImportWizard(false)} />}
      {showConfigRestoreWizard && <ConfigRestoreWizard onClose={() => setShowConfigRestoreWizard(false)} />}

      <div className={`settings-card${activeSection === 'shares' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Pools</div>
        <div className="settings-field">
          <div className="toggle-row__title">Minimum free space (GB)</div>
          <div className="toggle-row__desc">
            When a pool spans multiple disks, mergerfs won't pick a disk with less free space than this for a new
            file. Its own default is 4GB.
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
              Backsup Samba/NFS config, this app's settings/pools/shares/users, the array superblock, and docker config.
              <br />
              Set schedule and and location below. 
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
            <PathAutocomplete
              scope="browse"
              value={backupDestDirDraft}
              onChange={setBackupDestDirDraft}
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
          </div>
          <div className="settings-field__row">
            <button type="button" className="btn" disabled={backupSchedSaving || !settings} onClick={saveBackupSchedule}>
              {backupSchedSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {backupSchedError && <div className="status-note status-note--error">{backupSchedError}</div>}
        </div>

        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Back up config now</div>
          <div className="settings-field__row">
            <button type="button" className="btn" disabled={backupRunning || !settings} onClick={runBackupNow} title="Writes a config backup into the destination directory above, right now.">
              {backupRunning ? 'Backing up…' : 'Back up now'}
            </button>
            <a
              className="btn"
              href={systemApi.bootDiskConfigBackupUrl()}
              download
              title="Downloads a config backup straight to this device's browser downloads - doesn't touch the array or its destination directory."
            >
              Download a copy
            </a>
          </div>
          {backupRunResult && <div className="status-note">{backupRunResult}</div>}
          {backupRunError && <div className="status-note status-note--error">{backupRunError}</div>}
        </div>

        <div className="settings-field toggle-row--bordered">
          <div className="toggle-row__title">Import config</div>
          <div className="toggle-row__desc">
            Restores a previously saved config backup
            <br />
            Requires the array to be stopped first.
            <br />
            Note: this is not for restoring an array.
          </div>
          <div className="settings-field__row">
            <button type="button" className="btn" onClick={() => setShowConfigRestoreWizard(true)}>
              Import config
            </button>
          </div>
        </div>
      </div>

      <div className={`settings-card${activeSection === 'notifications' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Notifications</div>
        <div className="toggle-row">
          <div>
            <div className="toggle-row__title">Event notifications</div>
            <div className="toggle-row__desc">
              Dispatch notifications via apprise
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
          <NotificationEventToggles
            eventTypes={eventTypesDraft}
            onChange={toggleEventType}
            disabled={!settings}
            renderExtra={(eventId) => {
              if (eventId === 'tempAlertCpu') {
                return (
                  <div style={{ paddingLeft: 12, paddingBottom: 8 }}>
                    <div className="settings-field__row">
                      <input
                        className="history-input"
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={cpuTempThresholdDraft}
                        onChange={(e) => setCpuTempThresholdDraft(e.target.value)}
                        disabled={!settings}
                        style={{ width: 70 }}
                      />
                      <span className="toggle-row__desc">°C</span>
                      <button type="button" className="btn" disabled={cpuTempThresholdSaving || !settings} onClick={saveCpuTempThreshold}>
                        {cpuTempThresholdSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                    {cpuTempThresholdError && <div className="status-note status-note--error">{cpuTempThresholdError}</div>}
                  </div>
                );
              }
              if (eventId === 'tempAlertDisk') {
                return (
                  <div style={{ paddingLeft: 12, paddingBottom: 8 }}>
                    <div className="settings-field__row">
                      <input
                        className="history-input"
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={diskTempThresholdDraft}
                        onChange={(e) => setDiskTempThresholdDraft(e.target.value)}
                        disabled={!settings}
                        style={{ width: 70 }}
                      />
                      <span className="toggle-row__desc">°C</span>
                      <button type="button" className="btn" disabled={diskTempThresholdSaving || !settings} onClick={saveDiskTempThreshold}>
                        {diskTempThresholdSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                    {diskTempThresholdError && <div className="status-note status-note--error">{diskTempThresholdError}</div>}
                  </div>
                );
              }
              return null;
            }}
          />
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
      </div>

      <div className={`settings-card${activeSection === 'security' ? '' : ' settings-hidden'}`}>
        <div className="settings-card__title">Security</div>
        <TlsSection />
        <div className="settings-field">
          <div className="toggle-row__title">Change admin password</div>
          <div className="toggle-row__desc">
            Also signs out every other session.
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
        <PasskeySection />
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
