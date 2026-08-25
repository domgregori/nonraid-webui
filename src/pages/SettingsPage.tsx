import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { authApi } from '../api/authApi';
import { cacheApi } from '../api/cacheApi';
import { dockerApi } from '../api/dockerApi';
import { lxcApi } from '../api/lxcApi';
import { nmdApi } from '../api/nmdApi';
import { settingsApi } from '../api/settingsApi';
import { systemApi } from '../api/systemApi';
import { AppriseTargetsField } from '../components/settings/AppriseTargetsField';
import { ConfigRestoreWizard } from '../components/settings/ConfigRestoreWizard';
import { ImportArrayWizard } from '../components/settings/ImportArrayWizard';
import { LogsSection } from '../components/settings/LogsSection';
import { NotificationEventToggles } from '../components/settings/NotificationEventToggles';
import { PasskeySection } from '../components/settings/PasskeySection';
import { RemoteBackupSection } from '../components/settings/RemoteBackupSection';
import { RestoreFromLocalWizard } from '../components/settings/RestoreFromLocalWizard';
import { RestoreFromRemoteWizard } from '../components/settings/RestoreFromRemoteWizard';
import { ScheduleFields } from '../components/settings/ScheduleFields';
import { ServicesSection } from '../components/settings/ServicesSection';
import { SshKeysSection } from '../components/settings/SshKeysSection';
import { StorageLocationField } from '../components/settings/StorageLocationField';
import { TailscaleSection } from '../components/settings/TailscaleSection';
import { UpdateSection } from '../components/settings/UpdateSection';
import { TlsSection } from '../components/settings/TlsSection';
import { TwoFactorSection } from '../components/settings/TwoFactorSection';
import { PathAutocomplete } from '../components/shared/PathAutocomplete';
import { ReloadDriverPrompt } from '../components/shared/ReloadDriverPrompt';
import { StepUpModal } from '../components/shared/StepUpModal';
import { ToggleSwitch } from '../components/shared/ToggleSwitch';
import { useSettings } from '../hooks/useSettings';
import { useSystemStats } from '../hooks/useSystemStats';
import { type ThemePreference, useTheme } from '../hooks/useTheme';
import { deriveProtection } from '../selectors/status';
import { useOnboarding } from '../state/OnboardingContext';
import { useArrayStatus } from '../state/useArrayStatus';
import { useAuth } from '../state/useAuth';
import type { NotificationChannelToggle, NotificationEventType } from '../types/settingsApi';
import type { BackupCategoryId } from '../types/systemApi';
import { formatMemLabel, formatUptime } from '../utils/format';

const SECTIONS = [
  { id: 'about', label: 'About' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'array', label: 'Array' },
  { id: 'backups', label: 'Backups' },
  { id: 'cache', label: 'Cache' },
  { id: 'docker-lxc', label: 'Docker & LXC Storage' },
  { id: 'network', label: 'Network' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'parity', label: 'Parity' },
  { id: 'shares', label: 'Pools' },
  { id: 'recovery', label: 'Recovery' },
  { id: 'security', label: 'Security' },
  { id: 'services', label: 'Services' },
  { id: 'logs', label: 'System Logs' },
  { id: 'tailscale', label: 'Tailscale' },
  { id: 'update', label: 'Update' },
] as const;

// Every valid deep-link target, e.g. /settings#recovery - kept as a real Set (not just trusting
// the hash) so an arbitrary/stale/typo'd hash falls back to the default section instead of
// silently leaving the sidebar on "About" while some other card is actually showing.
const SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

// Resolves the section a hash like "#cache" names, falling back to the default when the hash is
// absent or doesn't match a real section (a stale link, a typo). Shared by the initial state (so a
// direct load of /settings#cache renders straight into Cache, no flash of About first) and the
// location.hash effect below (so a Link/back-forward navigation while already on /settings, which
// doesn't remount, still lands on the right section).
function sectionFromHash(hash: string): (typeof SECTIONS)[number]['id'] {
  const id = hash.replace(/^#/, '');
  return id && SECTION_IDS.has(id) ? (id as (typeof SECTIONS)[number]['id']) : 'about';
}

export function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<(typeof SECTIONS)[number]['id']>(() => sectionFromHash(window.location.hash));
  // Which Recovery-hub restore dialog is open, if any - `source` picks upload vs. local vs. remote
  // (ConfigRestoreWizard vs. RestoreFromLocalWizard vs. RestoreFromRemoteWizard, all three sharing
  // the same review/confirm/result flow once a preview comes back), `focusCategory` set to 'array'
  // for the "recover just the array" entry points, which reuse the exact same three sources rather
  // than a separate sixth flow - see ConfigRestoreWizard's own doc comment on that prop.
  const [restoreDialog, setRestoreDialog] = useState<{ source: 'upload' | 'local' | 'remote'; focusCategory?: BackupCategoryId } | null>(null);
  // Deep-linking, e.g. the "Recovery ->" links on the Backups cards: /settings#recovery. Reacts to
  // location.hash rather than only running once on mount, since clicking a Link to a new hash
  // while already on /settings is a same-component navigation (no remount) in this SPA. Also
  // catches browser back/forward between sections, since selectSection() below pushes a real
  // history entry per section.
  useEffect(() => {
    setActiveSection(sectionFromHash(location.hash));
  }, [location.hash]);
  // The other direction: picking a section from the sidebar updates the URL to match, so a reload
  // (or just copying the address bar) lands back on the same section instead of always resetting to
  // About. A real history entry per section (not `replace`) so back/forward step through them too,
  // consistent with the "Recovery ->" links already doing a normal push navigation.
  const selectSection = (id: (typeof SECTIONS)[number]['id']) => {
    setActiveSection(id);
    navigate(`#${id}`);
  };
  const { settings, loadState, error, saving, saveError, update } = useSettings();
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const stats = useSystemStats();
  const { status, refresh: refreshArrayStatus } = useArrayStatus();
  const { replay } = useOnboarding();
  const { refreshStatus: refreshAuthStatus } = useAuth();
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

  const [rebootConfirming, setRebootConfirming] = useState(false);
  const [rebootRunning, setRebootRunning] = useState(false);
  const [rebootResult, setRebootResult] = useState<string | null>(null);
  const [rebootError, setRebootError] = useState<string | null>(null);

  const [appriseDraft, setAppriseDraft] = useState('');
  const [eventTypesDraft, setEventTypesDraft] = useState<Record<NotificationEventType, NotificationChannelToggle>>({} as Record<NotificationEventType, NotificationChannelToggle>);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSending, setTestSending] = useState(false);

  const [minFreeSpaceDraft, setMinFreeSpaceDraft] = useState('');
  const [minFreeSpaceSaving, setMinFreeSpaceSaving] = useState(false);
  const [minFreeSpaceError, setMinFreeSpaceError] = useState<string | null>(null);

  const [paritySchedEnabled, setParitySchedEnabled] = useState(false);
  const [paritySchedFrequency, setParitySchedFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'cron'>('weekly');
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
  const [cacheSchedFrequency, setCacheSchedFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'cron'>('weekly');
  const [cacheSchedDay, setCacheSchedDay] = useState(0);
  const [cacheSchedDayOfMonth, setCacheSchedDayOfMonth] = useState(1);
  const [cacheSchedHour, setCacheSchedHour] = useState(3);
  const [cacheSchedSaving, setCacheSchedSaving] = useState(false);
  const [cacheMoverSaving, setCacheMoverSaving] = useState(false);
  const [cacheMoverError, setCacheMoverError] = useState<string | null>(null);

  const [backupSchedEnabled, setBackupSchedEnabled] = useState(false);
  const [backupSchedScope, setBackupSchedScope] = useState<'config' | 'configAppdata'>('config');
  const [backupSchedFrequency, setBackupSchedFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'cron'>('weekly');
  const [backupSchedDay, setBackupSchedDay] = useState(0);
  const [backupSchedDayOfMonth, setBackupSchedDayOfMonth] = useState(1);
  const [backupSchedHour, setBackupSchedHour] = useState(3);
  const [backupCronExpression, setBackupCronExpression] = useState('');
  const [backupDestMode, setBackupDestMode] = useState<'boot' | 'array' | 'custom'>('custom');
  const [backupDestDiskSlot, setBackupDestDiskSlot] = useState<number | null>(null);
  const [backupDestCustomPath, setBackupDestCustomPath] = useState('');
  const [backupRetainDraft, setBackupRetainDraft] = useState('7');
  const [backupRetainForever, setBackupRetainForever] = useState(false);
  // `backupHadPassword` isn't itself editable - it's what was already saved (settings.backupSchedule.
  // encryption.hasPassword), driving the "leave blank to keep the current password" placeholder vs.
  // "required" validation. `backupEncryptPassword` is always blank to start, even when a password's
  // already saved - never round-tripped from the server (see BackupEncryption's own doc comment).
  const [backupEncryptEnabled, setBackupEncryptEnabled] = useState(false);
  const [backupEncryptPassword, setBackupEncryptPassword] = useState('');
  const [backupHadPassword, setBackupHadPassword] = useState(false);
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

  const [newPasswordDraft, setNewPasswordDraft] = useState('');
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState('');
  const [confirmingPasswordChange, setConfirmingPasswordChange] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

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
    systemApi
      .getTimezones()
      .then(setTimezones)
      .catch(() => {});
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
      setBackupSchedScope(settings.backupSchedule.scope);
      setBackupSchedFrequency(settings.backupSchedule.frequency);
      setBackupSchedDay(settings.backupSchedule.dayOfWeek);
      setBackupSchedDayOfMonth(settings.backupSchedule.dayOfMonth);
      setBackupSchedHour(settings.backupSchedule.hour);
      setBackupCronExpression(settings.backupSchedule.cronExpression);
      setBackupDestMode(settings.backupSchedule.destination.mode);
      setBackupDestDiskSlot(settings.backupSchedule.destination.diskSlot);
      setBackupDestCustomPath(settings.backupSchedule.destination.customPath);
      setBackupRetainDraft(String(settings.backupSchedule.retain));
      setBackupRetainForever(settings.backupSchedule.retainForever);
      setBackupEncryptEnabled(settings.backupSchedule.encryption.enabled);
      setBackupHadPassword(settings.backupSchedule.encryption.hasPassword);
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

  const saveNotifications = () =>
    update({
      notifications: { appriseUrls: appriseDraft, eventTypes: eventTypesDraft },
    });

  const toggleEventChannel = (eventType: NotificationEventType, channel: keyof NotificationChannelToggle, enabled: boolean) => {
    setEventTypesDraft((prev) => ({
      ...prev,
      [eventType]: { ...prev[eventType], [channel]: enabled },
    }));
    update({
      notifications: { eventTypes: { [eventType]: { [channel]: enabled } } },
    });
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
    if (!backupRetainForever && (!Number.isInteger(retain) || retain < 1)) {
      setBackupSchedError('Enter a positive whole number for how many backups to keep, or check "Keep all backups forever".');
      return;
    }
    if (backupDestMode === 'array' && backupDestDiskSlot === null) {
      setBackupSchedError('Pick a disk for the destination.');
      return;
    }
    if (backupDestMode === 'custom' && !backupDestCustomPath.trim()) {
      setBackupSchedError('Enter a destination path.');
      return;
    }
    if (backupSchedFrequency === 'cron' && !backupCronExpression.trim()) {
      setBackupSchedError('Enter a cron expression.');
      return;
    }
    if (backupEncryptEnabled && !backupEncryptPassword.trim() && !backupHadPassword) {
      setBackupSchedError('Enter a password to enable encryption.');
      return;
    }
    setBackupSchedSaving(true);
    setBackupSchedError(null);
    await update({
      backupSchedule: {
        enabled: backupSchedEnabled,
        scope: backupSchedScope,
        frequency: backupSchedFrequency,
        dayOfWeek: backupSchedDay,
        dayOfMonth: backupSchedDayOfMonth,
        hour: backupSchedHour,
        cronExpression: backupCronExpression.trim(),
        destination: {
          mode: backupDestMode,
          diskSlot: backupDestMode === 'array' ? backupDestDiskSlot : null,
          customPath: backupDestCustomPath.trim(),
        },
        retain: backupRetainForever ? 1 : retain,
        retainForever: backupRetainForever,
        encryption: { enabled: backupEncryptEnabled, password: backupEncryptPassword.trim() || undefined },
      },
    });
    // Never keeps a just-typed password sitting in this draft field past a successful save - the
    // next save (e.g. just changing the schedule) should mean "keep the current password" by
    // default, same as reopening this card fresh would.
    if (backupEncryptPassword.trim()) setBackupHadPassword(true);
    setBackupEncryptPassword('');
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
      const result = await settingsApi.testNotification(appriseDraft);
      setTestResult(result.message);
    } catch (err) {
      setTestError((err as Error).message);
    } finally {
      setTestSending(false);
    }
  };

  // Validates the new/confirm pair client-side, then hands off to the StepUpModal for the actual
  // current-password(+2FA) re-verification - see changePassword's onConfirm in the JSX below.
  const startPasswordChange = () => {
    if (newPasswordDraft !== confirmPasswordDraft) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setPasswordError(null);
    setConfirmingPasswordChange(true);
  };

  return (
    <div className="page">
      <div className="page-title">Settings</div>

      {loadState === 'error' && <div className="status-note status-note--error">{error}</div>}

      <div className="settings-layout">
        <aside className="settings-sidebar">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={`category-item${activeSection === s.id ? ' category-item--active' : ''}`} onClick={() => selectSection(s.id)}>
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
              <InfoRow label="Array size" value={status ? `${status.array.size.data_disk_count} data disk${status.array.size.data_disk_count === 1 ? '' : 's'}, ${status.array.size.data_gb} GB` : '-'} />
              <InfoRow label="Superblock" value={status?.array.superblock ?? '-'} mono />
              <InfoRow label="Version" value={stats ? `v${stats.version}${stats.buildVersion ? ` (${stats.buildVersion})` : ''}` : '-'} mono />
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">Hostname</div>
              <div className="settings-field__row">
                <input className="history-input" style={{ width: '100%' }} value={hostnameDraft} onChange={(e) => setHostnameDraft(e.target.value)} disabled={!stats} />
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
              <div className="toggle-row__title">Time format</div>
              <div className="settings-field__row">
                <select className="history-input" style={{ width: '100%' }} value={settings?.timeFormat ?? '12h'} onChange={(e) => update({ timeFormat: e.target.value as '12h' | '24h' })} disabled={!settings || saving}>
                  <option value="12h">12-hour (2:30 PM)</option>
                  <option value="24h">24-hour (14:30)</option>
                </select>
              </div>
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
              <div className="toggle-row__desc">Reboots the whole host, not just this app. The array stops and unmounts cleanly first (the normal shutdown sequence - same as if you ran this at the console), then Docker, LXC, Samba, and NFS all stop too. Everything comes back on its own once the host finishes booting; this page reconnects automatically, no need to refresh by hand.</div>
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
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      width: '100%',
                    }}
                  >
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
                <div className="toggle-row__desc">Faster writes but at the expense of more power draw and all drives must be spun up on HDDs. Best for large transfters, rebuilds, and parity checks.</div>
              </div>
              <ToggleSwitch on={settings?.turboWrite ?? false} onToggle={() => settings && update({ turboWrite: !settings.turboWrite })} label="Turbo write" disabled={!settings || saving} />
            </div>
            {saveError && <div className="status-note status-note--error">{saveError}</div>}

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">Array label</div>
              <div className="settings-field__row">
                <input className="history-input" style={{ width: '100%' }} value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} placeholder="(unset)" disabled={!status} />
                <button type="button" className="btn" disabled={labelSaving || !status} onClick={saveLabel}>
                  {labelSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
              {arrayStarted && <div className="toggle-row__desc">Array must be stopped first.</div>}
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
              <div className="toggle-row__desc">Resets stale internal counters - doesn't change array disks.</div>
              <div className="settings-field__row" style={{ marginTop: 8 }}>
                <ReloadDriverPrompt description="Resets stale internal counters - doesn't change array disks. May leave the array briefly down; let it finish." onReloaded={refreshArrayStatus} />
              </div>
            </div>
          </div>

          <div className={`settings-card${activeSection === 'cache' ? '' : ' settings-hidden'}`}>
            <div className="settings-card__title">Cache</div>
            <div className="toggle-row">
              <div>
                <div className="toggle-row__title">Use cache for pools</div>
                <div className="toggle-row__desc">Writes to the cache mirror first. A scheduled mover then drains cache onto the array below. Speeds up read/writes.</div>
              </div>
              <ToggleSwitch on={cacheEnabled} onToggle={toggleCacheEnabled} label="Use cache for shares" disabled={!settings || cacheEnabledSaving} />
            </div>
            {cacheEnabledError && <div className="status-note status-note--error">{cacheEnabledError}</div>}

            <div className="toggle-row toggle-row--bordered">
              <div>
                <div className="toggle-row__title">Automatic mover</div>
                <div className="toggle-row__desc">Moves everything on cache onto the array.</div>
              </div>
              <ToggleSwitch on={cacheSchedEnabled} onToggle={() => setCacheSchedEnabled((v) => !v)} label="Automatic mover" disabled={!settings} />
            </div>
            <div className="settings-field toggle-row--bordered">
              <ScheduleFields frequency={cacheSchedFrequency} onFrequencyChange={setCacheSchedFrequency} dayOfWeek={cacheSchedDay} onDayOfWeekChange={setCacheSchedDay} dayOfMonth={cacheSchedDayOfMonth} onDayOfMonthChange={setCacheSchedDayOfMonth} hour={cacheSchedHour} onHourChange={setCacheSchedHour} hour12={settings?.timeFormat !== '24h'} disabled={!settings} />
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
                  A file that's currently open (e.g. by a running Docker container) is skipped rather than failing the whole run.
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
            <StorageLocationField title="Docker" desc="Location of docker system and image file storage." dataDisks={dataDisks} getStorage={dockerApi.getStorage} moveStorage={dockerApi.moveStorage} />
            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">Prune unused Docker images</div>
              <div className="toggle-row__desc">Remove unused docker images.</div>
              <button type="button" className="btn" disabled={dockerPruneSaving} onClick={handlePruneImages}>
                {dockerPruneSaving ? 'Pruning…' : 'Prune Images'}
              </button>
              {dockerPruneResult && <div className="status-note">{dockerPruneResult}</div>}
              {dockerPruneError && <div className="status-note status-note--error">{dockerPruneError}</div>}
            </div>
            <StorageLocationField title="LXC" desc="Where LXC container storage lives." dataDisks={dataDisks} getStorage={lxcApi.getStorage} moveStorage={lxcApi.moveStorage} />
            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">Clear LXC template cache</div>
              <div className="toggle-row__desc">Remove LXC distro cache.</div>
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
                <div className="toggle-row__desc">Schedule a parity check.</div>
              </div>
              <ToggleSwitch on={paritySchedEnabled} onToggle={() => setParitySchedEnabled((v) => !v)} label="Automatic check" disabled={!settings} />
            </div>
            <div className="settings-field toggle-row--bordered">
              <ScheduleFields frequency={paritySchedFrequency} onFrequencyChange={setParitySchedFrequency} dayOfWeek={paritySchedDay} onDayOfWeekChange={setParitySchedDay} dayOfMonth={paritySchedDayOfMonth} onDayOfMonthChange={setParitySchedDayOfMonth} hour={paritySchedHour} onHourChange={setParitySchedHour} hour12={settings?.timeFormat !== '24h'} disabled={!settings} />
              <div className="settings-field__row">
                <button type="button" className="btn" disabled={paritySchedSaving || !settings} onClick={saveParitySchedule}>
                  {paritySchedSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>

          <div className={`settings-card${activeSection === 'shares' ? '' : ' settings-hidden'}`}>
            <div className="settings-card__title">Pools</div>
            <div className="settings-field">
              <div className="toggle-row__title">Minimum free space (GB)</div>
              <div className="toggle-row__desc">When a pool spans multiple disks, mergerfs won't pick a disk with less free space than this for a new file. Its own default is 4GB.</div>
              <div className="settings-field__row">
                <input className="history-input" type="number" min={0} step={1} value={minFreeSpaceDraft} onChange={(e) => setMinFreeSpaceDraft(e.target.value)} disabled={!settings} />
                <button type="button" className="btn" disabled={minFreeSpaceSaving || !settings} onClick={saveMinFreeSpace}>
                  {minFreeSpaceSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
              {minFreeSpaceError && <div className="status-note status-note--error">{minFreeSpaceError}</div>}
            </div>
          </div>

          <div className={`settings-card${activeSection === 'backups' ? '' : ' settings-hidden'}`}>
            <div className="settings-card__title settings-card__title--with-link">
              <span>Local Backups</span>
              <Link to="/settings#recovery" className="settings-card__title-link">
                Recovery →
              </Link>
            </div>
            <div className="toggle-row">
              <div>
                <div className="toggle-row__title">Automatic config backup</div>
                <div className="toggle-row__desc">
                  Backs up Samba/NFS config, this app's settings/pools/shares/users, the array superblock, and Docker config.
                  <br />
                  Set schedule and location below.
                </div>
              </div>
              <ToggleSwitch on={backupSchedEnabled} onToggle={() => setBackupSchedEnabled((v) => !v)} label="Automatic config backup" disabled={!settings} />
            </div>
            {backupSchedEnabled && (
              <>
                <div className="settings-field toggle-row--bordered">
                  <label className="field" style={{ maxWidth: 280 }}>
                    <span className="settings-field__label">What to back up</span>
                    <select className="history-input" value={backupSchedScope} onChange={(e) => setBackupSchedScope(e.target.value as 'config' | 'configAppdata')} disabled={!settings}>
                      <option value="config">Config backups</option>
                      <option value="configAppdata">Config backups + appdata</option>
                    </select>
                  </label>

                  <div className="toggle-row__title" style={{ marginTop: 10 }}>
                    Destination
                  </div>
                  <div className="settings-field__row">
                    <select
                      className="history-input"
                      value={backupDestMode === 'array' ? `disk-${backupDestDiskSlot}` : backupDestMode}
                      onChange={(e) => {
                        if (e.target.value === 'boot' || e.target.value === 'custom') {
                          setBackupDestMode(e.target.value);
                          setBackupDestDiskSlot(null);
                        } else {
                          setBackupDestMode('array');
                          setBackupDestDiskSlot(Number(e.target.value.replace('disk-', '')));
                        }
                      }}
                      disabled={!settings}
                    >
                      <option value="boot">Boot Disk</option>
                      {dataDisks.map((d) => (
                        <option key={d.slot} value={`disk-${d.slot}`}>
                          {d.label}
                        </option>
                      ))}
                      <option value="custom">Custom…</option>
                    </select>
                  </div>
                  {backupDestMode === 'custom' && (
                    <>
                      <div className="toggle-row__title" style={{ marginTop: 10 }}>
                        Path
                      </div>
                      <div className="settings-field__row">
                        <PathAutocomplete scope="browse" value={backupDestCustomPath} onChange={setBackupDestCustomPath} placeholder="/mnt/user/backups" disabled={!settings} />
                      </div>
                    </>
                  )}

                  <div className="toggle-row__title" style={{ marginTop: 10 }}>
                    Keep last
                  </div>
                  <div className="settings-field__row">
                    <input className="history-input" type="number" min={1} step={1} value={backupRetainDraft} onChange={(e) => setBackupRetainDraft(e.target.value)} disabled={!settings || backupRetainForever} style={backupRetainForever ? { opacity: 0.4 } : undefined} />
                  </div>
                  <div className="keep-forever-row">
                    <input className="round-checkbox" type="checkbox" id="local-keep-forever" checked={backupRetainForever} onChange={(e) => setBackupRetainForever(e.target.checked)} disabled={!settings} />
                    <label htmlFor="local-keep-forever">Keep all backups forever</label>
                  </div>

                  <div className="toggle-row__title" style={{ marginTop: 10 }}>
                    Encryption
                  </div>
                  <div className="keep-forever-row" style={{ marginTop: 0 }}>
                    <input
                      className="round-checkbox"
                      type="checkbox"
                      id="local-backup-encrypt"
                      checked={backupEncryptEnabled}
                      onChange={(e) => setBackupEncryptEnabled(e.target.checked)}
                      disabled={!settings}
                    />
                    <label htmlFor="local-backup-encrypt">Password-encrypt these backup archives</label>
                  </div>
                  {backupEncryptEnabled && (
                    <div className="settings-field__row" style={{ marginTop: 8 }}>
                      <input
                        className="history-input"
                        type="password"
                        value={backupEncryptPassword}
                        onChange={(e) => setBackupEncryptPassword(e.target.value)}
                        placeholder={backupHadPassword ? 'Leave blank to keep the current password' : 'Password'}
                        disabled={!settings}
                      />
                    </div>
                  )}

                  <div className="schedule-row" style={{ marginTop: 10 }}>
                    <div className="schedule-row__label">Schedule</div>
                    <ScheduleFields frequency={backupSchedFrequency} onFrequencyChange={setBackupSchedFrequency} dayOfWeek={backupSchedDay} onDayOfWeekChange={setBackupSchedDay} dayOfMonth={backupSchedDayOfMonth} onDayOfMonthChange={setBackupSchedDayOfMonth} hour={backupSchedHour} onHourChange={setBackupSchedHour} hour12={settings?.timeFormat !== '24h'} disabled={!settings} allowCron cronExpression={backupCronExpression} onCronExpressionChange={setBackupCronExpression} />
                  </div>

                  <div className="settings-field__row" style={{ marginTop: 10 }}>
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
                    <a className="btn" href={systemApi.bootDiskConfigBackupUrl()} download title="Downloads a config backup straight to this device's browser downloads - doesn't touch the array or its destination directory.">
                      Download a copy
                    </a>
                  </div>
                  {backupRunResult && <div className="status-note">{backupRunResult}</div>}
                  {backupRunError && <div className="status-note status-note--error">{backupRunError}</div>}
                </div>
              </>
            )}
          </div>

          <div className={activeSection === 'backups' ? '' : 'settings-hidden'}>
            <RemoteBackupSection />
          </div>

          <div className={`settings-card${activeSection === 'recovery' ? '' : ' settings-hidden'}`}>
            <div className="settings-card__title">Recovery</div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">Restore configuration</div>
              <div className="toggle-row__desc">
                Bring back this app's settings/pools/shares/users, Samba/NFS config, and (only while the array is currently blank) the array superblock, from a
                previously-saved config backup.
              </div>
              <div className="settings-field__row">
                <button type="button" className="btn" onClick={() => setRestoreDialog({ source: 'upload' })}>
                  From an uploaded file…
                </button>
                <button type="button" className="btn" onClick={() => setRestoreDialog({ source: 'local' })}>
                  From a local backup…
                </button>
                <button type="button" className="btn" onClick={() => setRestoreDialog({ source: 'remote' })}>
                  From a remote backup…
                </button>
              </div>
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">Recover just the array</div>
              <div className="toggle-row__desc">
                Restores only the array superblock - disk assignments and parity configuration - out of a config backup, leaving every other setting untouched.
                Only takes effect while this array currently has nothing assigned; stop and clear the array first if it isn't already blank.
              </div>
              <div className="settings-field__row">
                <button type="button" className="btn" onClick={() => setRestoreDialog({ source: 'upload', focusCategory: 'array' })}>
                  From an uploaded file…
                </button>
                <button type="button" className="btn" onClick={() => setRestoreDialog({ source: 'local', focusCategory: 'array' })}>
                  From a local backup…
                </button>
                <button type="button" className="btn" onClick={() => setRestoreDialog({ source: 'remote', focusCategory: 'array' })}>
                  From a remote backup…
                </button>
              </div>
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">Import an existing array</div>
              <div className="toggle-row__desc">
                Migrate the disks and configuration from a previous NonRAID or Unraid array in directly, using its own <code>.dat</code> superblock file rather
                than a config backup.
              </div>
              <div className="settings-field__row">
                <button type="button" className="btn" onClick={() => setShowImportWizard(true)}>
                  Import array…
                </button>
              </div>
            </div>
          </div>

          {restoreDialog?.source === 'upload' && (
            <ConfigRestoreWizard
              onClose={() => setRestoreDialog(null)}
              focusCategory={restoreDialog.focusCategory}
              title={restoreDialog.focusCategory === 'array' ? 'Recover the array from an uploaded file' : 'Restore from an uploaded file'}
            />
          )}
          {restoreDialog?.source === 'local' && <RestoreFromLocalWizard onClose={() => setRestoreDialog(null)} focusCategory={restoreDialog.focusCategory} />}
          {restoreDialog?.source === 'remote' && <RestoreFromRemoteWizard onClose={() => setRestoreDialog(null)} focusCategory={restoreDialog.focusCategory} />}
          {showImportWizard && <ImportArrayWizard onClose={() => setShowImportWizard(false)} />}

          <div className={`settings-card${activeSection === 'notifications' ? '' : ' settings-hidden'}`}>
            <div className="settings-card__title">Notifications</div>
            <div className="toggle-row">
              <div>
                <div className="toggle-row__title">Apprise notifications</div>
                <div className="toggle-row__desc">Master switch for the Apprise channel below - the in-app bell/toast (Webui column) has no master switch of its own, it's controlled purely per-event.</div>
              </div>
              <ToggleSwitch
                on={settings?.notifications.enabled ?? false}
                onToggle={() =>
                  settings &&
                  update({
                    notifications: { enabled: !settings.notifications.enabled },
                  })
                }
                label="Apprise notifications"
                disabled={!settings || saving}
              />
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">Which events notify</div>
              <NotificationEventToggles
                eventTypes={eventTypesDraft}
                onChange={toggleEventChannel}
                disabled={!settings}
                renderExtra={(eventId) => {
                  if (eventId === 'tempAlertCpu') {
                    return (
                      <div style={{ paddingLeft: 12, paddingBottom: 8 }}>
                        <div className="settings-field__row">
                          <input className="history-input" type="number" min={0} max={100} step={1} value={cpuTempThresholdDraft} onChange={(e) => setCpuTempThresholdDraft(e.target.value)} disabled={!settings} style={{ width: 70 }} />
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
                          <input className="history-input" type="number" min={0} max={100} step={1} value={diskTempThresholdDraft} onChange={(e) => setDiskTempThresholdDraft(e.target.value)} disabled={!settings} style={{ width: 70 }} />
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
              <AppriseTargetsField value={appriseDraft} onChange={setAppriseDraft} />
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
            <div className="toggle-row">
              <div>
                <div className="toggle-row__title">Trust reverse proxy</div>
                <div className="toggle-row__desc">Only enable if a reverse proxy is the sole way to reach this backend (it's firewalled off from any other direct access) and that proxy always sets/overwrites X-Forwarded-Proto/Host/For itself - otherwise a direct client could spoof those headers to fake an HTTPS connection or dodge login/TOTP rate limiting. Once enabled, the session cookie's Secure flag and passkey RP ID/origin are detected from the request automatically, no need to set them by hand.</div>
              </div>
              <ToggleSwitch on={settings?.trustProxy ?? false} onToggle={() => settings && update({ trustProxy: !settings.trustProxy })} label="Trust reverse proxy" disabled={!settings || saving} />
            </div>
            <div className="settings-field">
              <div className="toggle-row__title">Change admin password</div>
              <div className="toggle-row__desc">Also signs out every other session.</div>
              <input type="password" className="history-input" style={{ width: '100%' }} value={newPasswordDraft} onChange={(e) => setNewPasswordDraft(e.target.value)} placeholder="New password" autoComplete="new-password" />
              <input type="password" className="history-input" style={{ width: '100%' }} value={confirmPasswordDraft} onChange={(e) => setConfirmPasswordDraft(e.target.value)} placeholder="Confirm new password" autoComplete="new-password" />
              <div className="settings-field__row">
                <button type="button" className="btn" onClick={startPasswordChange}>
                  Change password
                </button>
              </div>
              {passwordError && <div className="status-note status-note--error">{passwordError}</div>}
              {confirmingPasswordChange && (
                <StepUpModal
                  title="Confirm it's you"
                  description="Changing your password signs you out of every session, including this one."
                  confirmLabel="Change password"
                  onClose={() => setConfirmingPasswordChange(false)}
                  onConfirm={async (password, totpCode) => {
                    await authApi.changePassword(password, newPasswordDraft, totpCode);
                    setNewPasswordDraft('');
                    setConfirmPasswordDraft('');
                    // The response already cleared this session's own cookie too (see
                    // auth/service.ts's changePassword) - resync context state so AuthGate swaps
                    // straight to the login screen instead of leaving this page showing stale
                    // "authenticated" UI against a cookie that no longer verifies.
                    await refreshAuthStatus();
                  }}
                />
              )}
            </div>

            <TwoFactorSection />
            <PasskeySection />
            <SshKeysSection />
          </div>

          <div className={`settings-card${activeSection === 'tailscale' ? '' : ' settings-hidden'}`}>
            <div className="settings-card__title">Tailscale</div>
            <TailscaleSection />
          </div>

          <div className={`settings-card${activeSection === 'update' ? '' : ' settings-hidden'}`}>
            <div className="settings-card__title">Update</div>
            <UpdateSection />
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
