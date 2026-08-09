import { useEffect, useRef, useState } from 'react';
import { authApi } from '../api/authApi';
import { nmdApi } from '../api/nmdApi';
import { settingsApi } from '../api/settingsApi';
import { systemApi } from '../api/systemApi';
import { ImportArrayWizard } from '../components/settings/ImportArrayWizard';
import { ScheduleFields } from '../components/settings/ScheduleFields';
import { ToggleSwitch } from '../components/shared/ToggleSwitch';
import { useSettings } from '../hooks/useSettings';
import { useSystemStats } from '../hooks/useSystemStats';
import { type ThemePreference, useTheme } from '../hooks/useTheme';
import { useArrayStatus } from '../state/useArrayStatus';
import { formatMemLabel, formatUptime } from '../utils/format';

export function SettingsPage() {
  const { settings, loadState, error, saving, saveError, update } = useSettings();
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const stats = useSystemStats();
  const { status } = useArrayStatus();

  const [labelDraft, setLabelDraft] = useState('');
  const [labelResult, setLabelResult] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [labelSaving, setLabelSaving] = useState(false);

  const [appriseDraft, setAppriseDraft] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSending, setTestSending] = useState(false);

  const [minFreeSpaceDraft, setMinFreeSpaceDraft] = useState('');
  const [minFreeSpaceSaving, setMinFreeSpaceSaving] = useState(false);
  const [minFreeSpaceError, setMinFreeSpaceError] = useState<string | null>(null);

  const [paritySchedEnabled, setParitySchedEnabled] = useState(false);
  const [paritySchedFrequency, setParitySchedFrequency] = useState<'weekly' | 'monthly'>('weekly');
  const [paritySchedDay, setParitySchedDay] = useState(0);
  const [paritySchedDayOfMonth, setParitySchedDayOfMonth] = useState(1);
  const [paritySchedHour, setParitySchedHour] = useState(2);
  const [paritySchedSaving, setParitySchedSaving] = useState(false);

  const [tempAlertsEnabled, setTempAlertsEnabled] = useState(false);
  const [tempAlertsThresholdDraft, setTempAlertsThresholdDraft] = useState('');
  const [tempAlertsSaving, setTempAlertsSaving] = useState(false);
  const [tempAlertsError, setTempAlertsError] = useState<string | null>(null);

  const [backupSchedEnabled, setBackupSchedEnabled] = useState(false);
  const [backupSchedFrequency, setBackupSchedFrequency] = useState<'weekly' | 'monthly'>('weekly');
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

  const arrayStarted = status?.array.state === 'STARTED';

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

  const saveNotifications = () => update({ notifications: { appriseUrls: appriseDraft } });

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
    <div className="page page--narrow">
      <div className="page-title">Settings</div>

      {loadState === 'error' && <div className="status-note status-note--error">{error}</div>}

      <div className="settings-card">
        <div className="settings-card__title">About</div>
        <div className="settings-info-grid">
          <InfoRow label="Hostname" value={stats?.hostname ?? '—'} />
          <InfoRow label="Uptime" value={stats ? formatUptime(stats.uptimeSeconds) : '—'} />
          <InfoRow label="CPU" value={stats ? `${Math.round(stats.cpuPercent)}%` : '—'} />
          <InfoRow label="Memory" value={stats ? formatMemLabel(stats.memUsedBytes, stats.memTotalBytes) : '—'} />
          <InfoRow label="Array label" value={status?.array.label || '(unset)'} />
          <InfoRow label="Array health" value={status?.array.health.status ?? '—'} />
          <InfoRow
            label="Array size"
            value={
              status
                ? `${status.array.size.data_disk_count} data disk${status.array.size.data_disk_count === 1 ? '' : 's'}, ${status.array.size.data_gb} GB`
                : '—'
            }
          />
          <InfoRow label="Superblock" value={status?.array.superblock ?? '—'} mono />
          <InfoRow label="Build" value={stats?.buildVersion ?? 'unknown'} mono />
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

      <div className="settings-card">
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

      <div className="settings-card">
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

      <div className="settings-card">
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
      </div>

      <div className="settings-card">
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

      <div className="settings-card">
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

      <div className="settings-card">
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

      <div className="settings-card">
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

      <div className="settings-card">
        <div className="settings-card__title">Notifications</div>
        <div className="toggle-row">
          <div>
            <div className="toggle-row__title">Event notifications</div>
            <div className="toggle-row__desc">
              Enable dispatching notifications via apprise. Sent automatically when a parity check finishes, a disk
              reports a new error or goes offline, or a SMART health check fails.
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

      <div className="settings-card">
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
