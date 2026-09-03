import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { authApi } from '../api/authApi';
import { cacheApi } from '../api/cacheApi';
import { dockerApi } from '../api/dockerApi';
import { lxcApi } from '../api/lxcApi';
import { nmdApi } from '../api/nmdApi';
import { settingsApi } from '../api/settingsApi';
import { systemApi } from '../api/systemApi';
import { ApiTokensSection } from '../components/settings/ApiTokensSection';
import { AppriseTargetsField } from '../components/settings/AppriseTargetsField';
import { ConfigRestoreWizard } from '../components/settings/ConfigRestoreWizard';
import { EncryptBackupModal } from '../components/settings/EncryptBackupModal';
import { ImportArrayWizard } from '../components/settings/ImportArrayWizard';
import { ImportUnraidWizard } from '../components/settings/ImportUnraidWizard';
import { LogsSection } from '../components/settings/LogsSection';
import { NotificationEventToggles } from '../components/settings/NotificationEventToggles';
import { PasskeySection } from '../components/settings/PasskeySection';
import { RemoteBackupSection } from '../components/settings/RemoteBackupSection';
import { BootSnapshotsSection } from '../components/settings/BootSnapshotsSection';
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
import { SUPPORTED_LANGUAGES, useLanguage } from '../hooks/useLanguage';
import { deriveProtection } from '../selectors/status';
import { useOnboarding } from '../state/OnboardingContext';
import { useArrayStatus } from '../state/useArrayStatus';
import { useAuth } from '../state/useAuth';
import type { NotificationChannelToggle, NotificationEventType } from '../types/settingsApi';
import type { BackupCategoryId } from '../types/systemApi';
import { formatMemLabel, formatUptime } from '../utils/format';

const SECTIONS = [
  { id: 'about' },
  { id: 'appearance' },
  { id: 'array' },
  { id: 'backups' },
  { id: 'cache' },
  { id: 'docker-lxc' },
  { id: 'network' },
  { id: 'notifications' },
  { id: 'parity' },
  { id: 'shares' },
  { id: 'recovery' },
  { id: 'security' },
  { id: 'services' },
  { id: 'logs' },
  { id: 'tailscale' },
  { id: 'update' },
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
  const { t } = useTranslation('pages');
  const location = useLocation();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<(typeof SECTIONS)[number]['id']>(() => sectionFromHash(window.location.hash));
  // Sidebar search - filters SECTIONS down to whichever ones actually contain the query, read
  // straight from each card's own rendered text (settingsMainRef, matched via each card's
  // data-section-id) rather than a hand-maintained index of every field's title/description. Every
  // settings-card always renders regardless of activeSection (see `settings-hidden`, a display:none
  // class, not a conditional unmount) specifically so this can find text in a section that isn't
  // the one currently showing - textContent works on a display:none element exactly like a visible
  // one. null = no active search, show every section (the normal, everyday state).
  const [settingsSearch, setSettingsSearch] = useState('');
  const [matchingSectionIds, setMatchingSectionIds] = useState<Set<string> | null>(null);
  const settingsMainRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = settingsSearch.trim().toLowerCase();
    if (!query) {
      setMatchingSectionIds(null);
      return;
    }
    const matches = new Set<string>();
    settingsMainRef.current?.querySelectorAll<HTMLElement>('[data-section-id]').forEach((el) => {
      const id = el.dataset.sectionId;
      if (id && el.textContent?.toLowerCase().includes(query)) matches.add(id);
    });
    setMatchingSectionIds(matches);
  }, [settingsSearch]);
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
  const { language, setLanguage } = useLanguage();
  const stats = useSystemStats();
  const { status, refresh: refreshArrayStatus } = useArrayStatus();
  const { replay } = useOnboarding();
  const { refreshStatus: refreshAuthStatus } = useAuth();
  const dataDisks = (status?.disks ?? []).filter((d) => d.type === 'data').map((d) => ({ slot: d.slot, label: t('SettingsPage.backups.diskLabel', { slot: d.slot }) }));

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
      setDockerPruneResult(t('SettingsPage.dockerLxc.pruneImagesResult', { count: result.imagesDeleted, mb }));
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
      setLxcPruneResult(t('SettingsPage.dockerLxc.pruneCacheResult', { mb }));
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

  const [trustProxyAddressDraft, setTrustProxyAddressDraft] = useState('');

  const [appLinkHostDraft, setAppLinkHostDraft] = useState('');

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
  // encryption.hasPassword), driving EncryptBackupModal's "change password" vs "encrypt backups"
  // framing. The real password is never round-tripped from the server (see BackupEncryption's own
  // doc comment) - the modal always starts blank, entered twice, only sent on a real change.
  const [backupEncryptEnabled, setBackupEncryptEnabled] = useState(false);
  const [backupHadPassword, setBackupHadPassword] = useState(false);
  const [showEncryptModal, setShowEncryptModal] = useState(false);
  const [encryptDisabling, setEncryptDisabling] = useState(false);
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
  const [showImportUnraidWizard, setShowImportUnraidWizard] = useState(false);

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
  const trustProxyAddressInitialized = useRef(false);
  const appLinkHostInitialized = useRef(false);
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
    if (settings && !trustProxyAddressInitialized.current) {
      setTrustProxyAddressDraft(settings.trustProxyAddress);
      trustProxyAddressInitialized.current = true;
    }
  }, [settings]);

  useEffect(() => {
    if (settings && !appLinkHostInitialized.current) {
      setAppLinkHostDraft(settings.appLinkHost);
      appLinkHostInitialized.current = true;
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
      setMinFreeSpaceError(t('SettingsPage.shares.minFreeSpaceError'));
      return;
    }
    setMinFreeSpaceSaving(true);
    setMinFreeSpaceError(null);
    await update({ minFreeSpaceGb: value });
    setMinFreeSpaceSaving(false);
  };

  // Validation itself happens server-side (resolveTrustProxyValue, backend/src/auth/trustProxy.ts
  // - a hostname needs a real DNS lookup, not something worth duplicating here) - update() itself
  // never throws (it swallows failures into the shared saving/saveError below), so that's what
  // actually surfaces a bad address, same as every other settings field in this file.
  const saveTrustProxyAddress = () => update({ trustProxyAddress: trustProxyAddressDraft.trim() });

  const saveAppLinkHost = () => update({ appLinkHost: appLinkHostDraft.trim() });

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
      setCpuTempThresholdError(t('SettingsPage.notifications.tempThresholdError'));
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
      setDiskTempThresholdError(t('SettingsPage.notifications.tempThresholdError'));
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
      setBackupSchedError(t('SettingsPage.backups.retainError'));
      return;
    }
    if (backupDestMode === 'array' && backupDestDiskSlot === null) {
      setBackupSchedError(t('SettingsPage.backups.destDiskError'));
      return;
    }
    if (backupDestMode === 'custom' && !backupDestCustomPath.trim()) {
      setBackupSchedError(t('SettingsPage.backups.destPathError'));
      return;
    }
    if (backupSchedFrequency === 'cron' && !backupCronExpression.trim()) {
      setBackupSchedError(t('SettingsPage.backups.cronExpressionError'));
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
        // Encryption is its own standalone save (see EncryptBackupModal/handleEncryptConfirm/
        // handleDisableEncryption below) - omitted here entirely rather than sent as unchanged,
        // since AppSettingsUpdate's backupSchedule.encryption is optional precisely so a patch
        // that doesn't touch it can leave it alone.
      },
    });
    setBackupSchedSaving(false);
  };

  // The "Encrypt backups…"/"Change password…" modal's confirm handler - a standalone save (not
  // tied to the rest of the schedule's own Save button) since encryption is now its own guided
  // step, entered via EncryptBackupModal's double-password-entry rather than an inline field.
  const handleEncryptConfirm = async (password: string) => {
    await update({ backupSchedule: { encryption: { enabled: true, password } } });
    setBackupEncryptEnabled(true);
    setBackupHadPassword(true);
  };

  const handleDisableEncryption = async () => {
    setEncryptDisabling(true);
    try {
      await update({ backupSchedule: { encryption: { enabled: false } } });
      setBackupEncryptEnabled(false);
    } finally {
      setEncryptDisabling(false);
    }
  };

  const runBackupNow = async () => {
    setBackupRunning(true);
    setBackupRunError(null);
    setBackupRunResult(null);
    try {
      const { bytes } = await systemApi.runBackupNow();
      const sizeLabel = bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
      setBackupRunResult(t('SettingsPage.backups.backupWrittenResult', { size: sizeLabel }));
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
      setPasswordError(t('SettingsPage.security.passwordMismatchError'));
      return;
    }
    setPasswordError(null);
    setConfirmingPasswordChange(true);
  };

  return (
    <div className="page">
      <div className="page-title">{t('SettingsPage.pageTitle')}</div>

      {loadState === 'error' && <div className="status-note status-note--error">{error}</div>}

      <div className="settings-layout">
        <aside className="settings-sidebar">
          <input
            type="text"
            className="history-input settings-search"
            value={settingsSearch}
            onChange={(e) => setSettingsSearch(e.target.value)}
            placeholder={t('SettingsPage.searchPlaceholder')}
            aria-label={t('SettingsPage.searchPlaceholder')}
          />
          {matchingSectionIds && matchingSectionIds.size === 0 ? (
            <div className="settings-search-empty">{t('SettingsPage.searchNoResults')}</div>
          ) : (
            SECTIONS.filter((s) => !matchingSectionIds || matchingSectionIds.has(s.id)).map((s) => (
              <button key={s.id} type="button" className={`category-item${activeSection === s.id ? ' category-item--active' : ''}`} onClick={() => selectSection(s.id)}>
                {t(`SettingsPage.sections.${s.id}`)}
              </button>
            ))
          )}
        </aside>

        <div className="settings-main" ref={settingsMainRef}>
          <div className={`settings-card${activeSection === 'about' ? '' : ' settings-hidden'}`} data-section-id="about">
            <div className="settings-card__title">{t('SettingsPage.about.title')}</div>
            <div className="settings-info-grid">
              <InfoRow label={t('SettingsPage.about.hostnameLabel')} value={stats?.hostname ?? '-'} />
              <InfoRow label={t('SettingsPage.about.uptimeLabel')} value={stats ? formatUptime(stats.uptimeSeconds) : '-'} />
              <InfoRow label={t('SettingsPage.about.cpuLabel')} value={stats ? `${Math.round(stats.cpuPercent)}%` : '-'} />
              <InfoRow label={t('SettingsPage.about.memoryLabel')} value={stats ? formatMemLabel(stats.memUsedBytes, stats.memTotalBytes) : '-'} />
              <InfoRow label={t('SettingsPage.about.arrayLabelLabel')} value={status?.array.label || '(unset)'} />
              <InfoRow label={t('SettingsPage.about.arrayHealthLabel')} value={status ? deriveProtection(status).short : '-'} />
              <InfoRow label={t('SettingsPage.about.arraySizeLabel')} value={status ? `${status.array.size.data_disk_count} ${t('SettingsPage.about.dataDiskUnit')}${status.array.size.data_disk_count === 1 ? '' : 's'}, ${status.array.size.data_gb} ${t('SettingsPage.about.gbUnit')}` : '-'} />
              <InfoRow label={t('SettingsPage.about.superblockLabel')} value={status?.array.superblock ?? '-'} mono />
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.about.hostnameFieldTitle')}</div>
              <div className="settings-field__row">
                <input className="history-input" style={{ width: '100%' }} value={hostnameDraft} onChange={(e) => setHostnameDraft(e.target.value)} disabled={!stats} />
                <button type="button" className="btn" disabled={hostnameSaving || !stats} onClick={saveHostname}>
                  {hostnameSaving ? t('SettingsPage.saving') : t('SettingsPage.save')}
                </button>
              </div>
              {hostnameResult && <div className="status-note">{hostnameResult}</div>}
              {hostnameError && <div className="status-note status-note--error">{hostnameError}</div>}
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.about.timezoneFieldTitle')}</div>
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
                  {timezoneSaving ? t('SettingsPage.saving') : t('SettingsPage.save')}
                </button>
              </div>
              {timezoneResult && <div className="status-note">{timezoneResult}</div>}
              {timezoneError && <div className="status-note status-note--error">{timezoneError}</div>}
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.about.timeFormatFieldTitle')}</div>
              <div className="settings-field__row">
                <select className="history-input" style={{ width: '100%' }} value={settings?.timeFormat ?? '12h'} onChange={(e) => update({ timeFormat: e.target.value as '12h' | '24h' })} disabled={!settings || saving}>
                  <option value="12h">{t('SettingsPage.about.timeFormat12h')}</option>
                  <option value="24h">{t('SettingsPage.about.timeFormat24h')}</option>
                </select>
              </div>
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.about.setupTourTitle')}</div>
              <div className="toggle-row__desc">{t('SettingsPage.about.setupTourDesc')}</div>
              <button type="button" className="btn" style={{ marginTop: 6 }} onClick={replay}>
                {t('SettingsPage.about.replayButton')}
              </button>
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.about.rebootTitle')}</div>
              <div className="toggle-row__desc">{t('SettingsPage.about.rebootDesc')}</div>
              {!rebootConfirming ? (
                <div className="settings-field__row">
                  <button type="button" className="btn" onClick={() => setRebootConfirming(true)}>
                    {t('SettingsPage.about.rebootButton')}
                  </button>
                </div>
              ) : (
                <div className="settings-field__row">
                  <button type="button" className="btn" disabled={rebootRunning} onClick={() => setRebootConfirming(false)}>
                    {t('SettingsPage.cancel')}
                  </button>
                  <button type="button" className="btn btn--danger" disabled={rebootRunning} onClick={handleReboot}>
                    {rebootRunning ? t('SettingsPage.about.rebootingButton') : t('SettingsPage.about.confirmRebootButton')}
                  </button>
                </div>
              )}
              {rebootResult && <div className="status-note">{rebootResult}</div>}
              {rebootError && <div className="status-note status-note--error">{rebootError}</div>}
            </div>
          </div>

          <div className={`settings-card${activeSection === 'network' ? '' : ' settings-hidden'}`} data-section-id="network">
            <div className="settings-card__title">{t('SettingsPage.network.title')}</div>
            <div className="toggle-row__desc" style={{ marginBottom: 10 }}>
              {t('SettingsPage.network.ifaceAddressesDesc')}
            </div>
            {!stats ? (
              <div className="status-note">{t('SettingsPage.network.loading')}</div>
            ) : stats.networkInterfaces.length === 0 ? (
              <div className="status-note">{t('SettingsPage.network.noInterfaces')}</div>
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
                    <InfoRow label={t('SettingsPage.network.ipv4Label')} value={iface.ipv4.join(', ') || '-'} mono />
                    <InfoRow label={t('SettingsPage.network.ipv6Label')} value={iface.ipv6.join(', ') || '-'} mono />
                    <InfoRow label={t('SettingsPage.network.macLabel')} value={iface.mac ?? '-'} mono />
                  </div>
                </div>
              ))
            )}
          </div>

          <div className={`settings-card${activeSection === 'appearance' ? '' : ' settings-hidden'}`} data-section-id="appearance">
            <div className="settings-card__title">{t('SettingsPage.appearance.title')}</div>
            <div className="settings-field">
              <div className="toggle-row__title">{t('SettingsPage.appearance.themeLabel')}</div>
              <div className="settings-field__row">
                <select className="history-input" value={themePreference} onChange={(e) => setThemePreference(e.target.value as ThemePreference)}>
                  <option value="system">{t('SettingsPage.appearance.themeSystem')}</option>
                  <option value="light">{t('SettingsPage.appearance.themeLight')}</option>
                  <option value="dark">{t('SettingsPage.appearance.themeDark')}</option>
                </select>
              </div>
            </div>
            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.appearance.languageLabel')}</div>
              <div className="toggle-row__desc">{t('SettingsPage.appearance.languageDesc')}</div>
              <div className="settings-field__row">
                <select className="history-input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className={`settings-card${activeSection === 'array' ? '' : ' settings-hidden'}`} data-section-id="array">
            <div className="settings-card__title">{t('SettingsPage.array.title')}</div>
            <div className="toggle-row">
              <div>
                <div className="toggle-row__title">{t('SettingsPage.array.turboWriteTitle')}</div>
                <div className="toggle-row__desc">{t('SettingsPage.array.turboWriteDesc')}</div>
              </div>
              <ToggleSwitch on={settings?.turboWrite ?? false} onToggle={() => settings && update({ turboWrite: !settings.turboWrite })} label={t('SettingsPage.array.turboWriteTitle')} disabled={!settings || saving} />
            </div>
            {saveError && <div className="status-note status-note--error">{saveError}</div>}

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.array.spinDownTitle')}</div>
              <div className="toggle-row__desc">{t('SettingsPage.array.spinDownDesc')}</div>
              <div className="settings-field__row">
                <select
                  className="history-input"
                  value={settings?.spinDownTimeoutMinutes ?? 0}
                  onChange={(e) => update({ spinDownTimeoutMinutes: Number(e.target.value) })}
                  disabled={!settings || saving}
                >
                  <option value={0}>{t('SettingsPage.array.spinDownNever')}</option>
                  <option value={5}>{t('SettingsPage.array.spinDownMinutes', { count: 5 })}</option>
                  <option value={10}>{t('SettingsPage.array.spinDownMinutes', { count: 10 })}</option>
                  <option value={15}>{t('SettingsPage.array.spinDownMinutes', { count: 15 })}</option>
                  <option value={20}>{t('SettingsPage.array.spinDownMinutes', { count: 20 })}</option>
                  <option value={30}>{t('SettingsPage.array.spinDownMinutes', { count: 30 })}</option>
                  <option value={60}>{t('SettingsPage.array.spinDownHours', { count: 1 })}</option>
                  <option value={120}>{t('SettingsPage.array.spinDownHours', { count: 2 })}</option>
                  <option value={180}>{t('SettingsPage.array.spinDownHours', { count: 3 })}</option>
                  <option value={240}>{t('SettingsPage.array.spinDownHours', { count: 4 })}</option>
                  <option value={300}>{t('SettingsPage.array.spinDownHours', { count: 5 })}</option>
                </select>
              </div>
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.array.arrayLabelFieldTitle')}</div>
              <div className="settings-field__row">
                <input className="history-input" style={{ width: '100%' }} value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} placeholder={t('SettingsPage.array.arrayLabelPlaceholder')} disabled={!status} />
                <button type="button" className="btn" disabled={labelSaving || !status} onClick={saveLabel}>
                  {labelSaving ? t('SettingsPage.saving') : t('SettingsPage.save')}
                </button>
              </div>
              {arrayStarted && <div className="toggle-row__desc">{t('SettingsPage.array.arrayMustBeStoppedDesc')}</div>}
              {labelResult && <div className="status-note">{labelResult}</div>}
              {labelError && <div className="status-note status-note--error">{labelError}</div>}
            </div>

            <div className="toggle-row toggle-row--bordered">
              <div>
                <div className="toggle-row__title">{t('SettingsPage.array.superblockPathTitle')}</div>
                <div className="toggle-row__desc toggle-row__desc--mono">{status?.array.superblock ?? '-'}</div>
              </div>
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.array.reloadDriverTitle')}</div>
              <div className="toggle-row__desc">{t('SettingsPage.array.reloadDriverDesc')}</div>
              <div className="settings-field__row" style={{ marginTop: 8 }}>
                <ReloadDriverPrompt description={t('SettingsPage.array.reloadDriverPromptDesc')} onReloaded={refreshArrayStatus} />
              </div>
            </div>
          </div>

          <div className={`settings-card${activeSection === 'cache' ? '' : ' settings-hidden'}`} data-section-id="cache">
            <div className="settings-card__title">{t('SettingsPage.cache.title')}</div>
            <div className="toggle-row">
              <div>
                <div className="toggle-row__title">{t('SettingsPage.cache.useCacheTitle')}</div>
                <div className="toggle-row__desc">{t('SettingsPage.cache.useCacheDesc')}</div>
              </div>
              <ToggleSwitch on={cacheEnabled} onToggle={toggleCacheEnabled} label={t('SettingsPage.cache.useCacheToggleLabel')} disabled={!settings || cacheEnabledSaving} />
            </div>
            {cacheEnabledError && <div className="status-note status-note--error">{cacheEnabledError}</div>}

            <div className="toggle-row toggle-row--bordered">
              <div>
                <div className="toggle-row__title">{t('SettingsPage.cache.autoMoverTitle')}</div>
                <div className="toggle-row__desc">{t('SettingsPage.cache.autoMoverDesc')}</div>
              </div>
              <ToggleSwitch on={cacheSchedEnabled} onToggle={() => setCacheSchedEnabled((v) => !v)} label={t('SettingsPage.cache.autoMoverTitle')} disabled={!settings} />
            </div>
            <div className="settings-field toggle-row--bordered">
              <ScheduleFields frequency={cacheSchedFrequency} onFrequencyChange={setCacheSchedFrequency} dayOfWeek={cacheSchedDay} onDayOfWeekChange={setCacheSchedDay} dayOfMonth={cacheSchedDayOfMonth} onDayOfMonthChange={setCacheSchedDayOfMonth} hour={cacheSchedHour} onHourChange={setCacheSchedHour} hour12={settings?.timeFormat !== '24h'} disabled={!settings} />
              <div className="settings-field__row">
                <button type="button" className="btn" disabled={cacheSchedSaving || !settings} onClick={saveCacheSchedule}>
                  {cacheSchedSaving ? t('SettingsPage.saving') : t('SettingsPage.save')}
                </button>
              </div>
            </div>

            <div className="settings-field toggle-row--bordered">
              <div>
                <div className="toggle-row__title">{t('SettingsPage.cache.runMoverTitle')}</div>
                <div className="toggle-row__desc">
                  {t('SettingsPage.cache.runMoverDesc1')}
                  <br />
                  {t('SettingsPage.cache.runMoverDesc2')}
                  <br />
                  {t('SettingsPage.cache.runMoverDesc3')}
                </div>
              </div>
              <div className="settings-field__row">
                <button type="button" className="btn" disabled={cacheMoverSaving} onClick={runCacheMover}>
                  {cacheMoverSaving ? t('SettingsPage.cache.movingButton') : t('SettingsPage.cache.moveButton')}
                </button>
              </div>
            </div>
            {cacheMoverError && <div className="status-note status-note--error">{cacheMoverError}</div>}
          </div>

          <div className={`settings-card${activeSection === 'docker-lxc' ? '' : ' settings-hidden'}`} data-section-id="docker-lxc">
            <div className="settings-card__title">{t('SettingsPage.dockerLxc.title')}</div>
            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.dockerLxc.appLinkHostTitle')}</div>
              <div className="toggle-row__desc">{t('SettingsPage.dockerLxc.appLinkHostDesc')}</div>
              <div className="settings-field__row">
                <input
                  className="history-input"
                  style={{ flex: 1, minWidth: 200 }}
                  value={appLinkHostDraft}
                  onChange={(e) => setAppLinkHostDraft(e.target.value)}
                  placeholder={t('SettingsPage.dockerLxc.appLinkHostPlaceholder')}
                  disabled={!settings}
                />
                <button type="button" className="btn" disabled={!settings || saving} onClick={saveAppLinkHost}>
                  {saving ? t('SettingsPage.saving') : t('SettingsPage.save')}
                </button>
              </div>
              {saveError && <div className="status-note status-note--error">{saveError}</div>}
            </div>
            <StorageLocationField title={t('SettingsPage.dockerLxc.dockerStorageTitle')} desc={t('SettingsPage.dockerLxc.dockerStorageDesc')} dataDisks={dataDisks} getStorage={dockerApi.getStorage} moveStorage={dockerApi.moveStorage} />
            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.dockerLxc.pruneImagesTitle')}</div>
              <div className="toggle-row__desc">{t('SettingsPage.dockerLxc.pruneImagesDesc')}</div>
              <button type="button" className="btn" disabled={dockerPruneSaving} onClick={handlePruneImages}>
                {dockerPruneSaving ? t('SettingsPage.dockerLxc.pruningButton') : t('SettingsPage.dockerLxc.pruneImagesButton')}
              </button>
              {dockerPruneResult && <div className="status-note">{dockerPruneResult}</div>}
              {dockerPruneError && <div className="status-note status-note--error">{dockerPruneError}</div>}
            </div>
            <StorageLocationField title={t('SettingsPage.dockerLxc.lxcStorageTitle')} desc={t('SettingsPage.dockerLxc.lxcStorageDesc')} dataDisks={dataDisks} getStorage={lxcApi.getStorage} moveStorage={lxcApi.moveStorage} />
            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.dockerLxc.clearCacheTitle')}</div>
              <div className="toggle-row__desc">{t('SettingsPage.dockerLxc.clearCacheDesc')}</div>
              <button type="button" className="btn" disabled={lxcPruneSaving} onClick={handlePruneTemplateCache}>
                {lxcPruneSaving ? t('SettingsPage.dockerLxc.clearingButton') : t('SettingsPage.dockerLxc.clearCacheButton')}
              </button>
              {lxcPruneResult && <div className="status-note">{lxcPruneResult}</div>}
              {lxcPruneError && <div className="status-note status-note--error">{lxcPruneError}</div>}
            </div>
          </div>

          <div className={`settings-card${activeSection === 'services' ? '' : ' settings-hidden'}`} data-section-id="services">
            <div className="settings-card__title">{t('SettingsPage.sections.services')}</div>
            <ServicesSection />
          </div>

          <div className={`settings-card${activeSection === 'logs' ? '' : ' settings-hidden'}`} data-section-id="logs">
            <div className="settings-card__title">{t('SettingsPage.logs.title')}</div>
            <LogsSection active={activeSection === 'logs'} />
          </div>

          <div className={`settings-card${activeSection === 'parity' ? '' : ' settings-hidden'}`} data-section-id="parity">
            <div className="settings-card__title">{t('SettingsPage.parity.title')}</div>
            <div className="toggle-row">
              <div>
                <div className="toggle-row__title">{t('SettingsPage.parity.autoCheckTitle')}</div>
                <div className="toggle-row__desc">{t('SettingsPage.parity.autoCheckDesc')}</div>
              </div>
              <ToggleSwitch on={paritySchedEnabled} onToggle={() => setParitySchedEnabled((v) => !v)} label={t('SettingsPage.parity.autoCheckTitle')} disabled={!settings} />
            </div>
            <div className="settings-field toggle-row--bordered">
              <ScheduleFields frequency={paritySchedFrequency} onFrequencyChange={setParitySchedFrequency} dayOfWeek={paritySchedDay} onDayOfWeekChange={setParitySchedDay} dayOfMonth={paritySchedDayOfMonth} onDayOfMonthChange={setParitySchedDayOfMonth} hour={paritySchedHour} onHourChange={setParitySchedHour} hour12={settings?.timeFormat !== '24h'} disabled={!settings} />
              <div className="settings-field__row">
                <button type="button" className="btn" disabled={paritySchedSaving || !settings} onClick={saveParitySchedule}>
                  {paritySchedSaving ? t('SettingsPage.saving') : t('SettingsPage.save')}
                </button>
              </div>
            </div>
          </div>

          <div className={`settings-card${activeSection === 'shares' ? '' : ' settings-hidden'}`} data-section-id="shares">
            <div className="settings-card__title">{t('SettingsPage.shares.title')}</div>
            <div className="settings-field">
              <div className="toggle-row__title">{t('SettingsPage.shares.minFreeSpaceTitle')}</div>
              <div className="toggle-row__desc">{t('SettingsPage.shares.minFreeSpaceDesc')}</div>
              <div className="settings-field__row">
                <input className="history-input" type="number" min={0} step={1} value={minFreeSpaceDraft} onChange={(e) => setMinFreeSpaceDraft(e.target.value)} disabled={!settings} />
                <button type="button" className="btn" disabled={minFreeSpaceSaving || !settings} onClick={saveMinFreeSpace}>
                  {minFreeSpaceSaving ? t('SettingsPage.saving') : t('SettingsPage.save')}
                </button>
              </div>
              {minFreeSpaceError && <div className="status-note status-note--error">{minFreeSpaceError}</div>}
            </div>
          </div>

          <div className={`settings-card${activeSection === 'backups' ? '' : ' settings-hidden'}`} data-section-id="backups">
            <div className="settings-card__title settings-card__title--with-link">
              <span>{t('SettingsPage.backups.title')}</span>
              <Link to="/settings#recovery" className="settings-card__title-link">
                {t('SettingsPage.backups.recoveryLink')}
              </Link>
            </div>
            <div className="toggle-row">
              <div>
                <div className="toggle-row__title">{t('SettingsPage.backups.autoBackupTitle')}</div>
                <div className="toggle-row__desc">
                  {t('SettingsPage.backups.autoBackupDesc1')}
                  <br />
                  {t('SettingsPage.backups.autoBackupDesc2')}
                </div>
              </div>
              <ToggleSwitch on={backupSchedEnabled} onToggle={() => setBackupSchedEnabled((v) => !v)} label={t('SettingsPage.backups.autoBackupTitle')} disabled={!settings} />
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.backups.backUpNowTitle')}</div>
              <div className="settings-field__row">
                <button type="button" className="btn" disabled={backupRunning || !settings} onClick={runBackupNow} title={t('SettingsPage.backups.backUpNowTooltip')}>
                  {backupRunning && <span className="spinner" aria-hidden="true" />}
                  {backupRunning ? t('SettingsPage.backups.backingUpButton') : t('SettingsPage.backups.backUpNowButton')}
                </button>
                <a
                  className="btn"
                  href={backupEncryptEnabled ? systemApi.bootDiskConfigBackupEncryptedUrl() : systemApi.bootDiskConfigBackupUrl()}
                  download
                  title={backupEncryptEnabled ? t('SettingsPage.backups.downloadEncryptedCopyTooltip') : t('SettingsPage.backups.downloadCopyTooltip')}
                >
                  {t('SettingsPage.backups.downloadCopyButton')}
                </a>
              </div>
              {backupRunResult && <div className="status-note">{backupRunResult}</div>}
              {backupRunError && <div className="status-note status-note--error">{backupRunError}</div>}
            </div>

            {backupSchedEnabled && (
              <>
                <div className="settings-field toggle-row--bordered">
                  <label className="field" style={{ maxWidth: 280 }}>
                    <span className="settings-field__label">{t('SettingsPage.backups.whatToBackUpLabel')}</span>
                    <select className="history-input" value={backupSchedScope} onChange={(e) => setBackupSchedScope(e.target.value as 'config' | 'configAppdata')} disabled={!settings}>
                      <option value="config">{t('SettingsPage.backups.scopeConfig')}</option>
                      <option value="configAppdata">{t('SettingsPage.backups.scopeConfigAppdata')}</option>
                    </select>
                  </label>

                  <div className="toggle-row__title" style={{ marginTop: 10 }}>
                    {t('SettingsPage.backups.destinationTitle')}
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
                      <option value="boot">{t('SettingsPage.backups.bootDiskOption')}</option>
                      {dataDisks.map((d) => (
                        <option key={d.slot} value={`disk-${d.slot}`}>
                          {d.label}
                        </option>
                      ))}
                      <option value="custom">{t('SettingsPage.backups.customOption')}</option>
                    </select>
                  </div>
                  {backupDestMode === 'custom' && (
                    <>
                      <div className="toggle-row__title" style={{ marginTop: 10 }}>
                        {t('SettingsPage.backups.pathTitle')}
                      </div>
                      <div className="settings-field__row">
                        <PathAutocomplete scope="browse" value={backupDestCustomPath} onChange={setBackupDestCustomPath} placeholder={t('SettingsPage.backups.pathPlaceholder')} disabled={!settings} />
                      </div>
                    </>
                  )}

                  <div className="toggle-row__title" style={{ marginTop: 10 }}>
                    {t('SettingsPage.backups.keepLastTitle')}
                  </div>
                  <div className="settings-field__row">
                    <input className="history-input" type="number" min={1} step={1} value={backupRetainDraft} onChange={(e) => setBackupRetainDraft(e.target.value)} disabled={!settings || backupRetainForever} style={backupRetainForever ? { opacity: 0.4 } : undefined} />
                  </div>
                  <div className="keep-forever-row">
                    <input className="round-checkbox" type="checkbox" id="local-keep-forever" checked={backupRetainForever} onChange={(e) => setBackupRetainForever(e.target.checked)} disabled={!settings} />
                    <label htmlFor="local-keep-forever">{t('SettingsPage.backups.keepForeverLabel')}</label>
                  </div>

                  <div className="toggle-row__title" style={{ marginTop: 10 }}>
                    {t('SettingsPage.backups.encryptionTitle')}
                  </div>
                  <div className="toggle-row__desc">{backupEncryptEnabled ? t('SettingsPage.backups.encryptionOnDesc') : t('SettingsPage.backups.encryptionOffDesc')}</div>
                  <div className="settings-field__row" style={{ marginTop: 6 }}>
                    <button type="button" className="btn" disabled={!settings} onClick={() => setShowEncryptModal(true)}>
                      {backupEncryptEnabled ? t('SettingsPage.backups.changePasswordButton') : t('SettingsPage.backups.encryptBackupsButton')}
                    </button>
                    {backupEncryptEnabled && (
                      <button type="button" className="btn btn--danger" disabled={!settings || encryptDisabling} onClick={handleDisableEncryption}>
                        {encryptDisabling ? t('SettingsPage.saving') : t('SettingsPage.backups.disableEncryptionButton')}
                      </button>
                    )}
                  </div>
                  {showEncryptModal && (
                    <EncryptBackupModal
                      hadPassword={backupHadPassword}
                      onConfirm={handleEncryptConfirm}
                      onClose={() => setShowEncryptModal(false)}
                    />
                  )}

                  <div className="schedule-row" style={{ marginTop: 10 }}>
                    <div className="schedule-row__label">{t('SettingsPage.backups.scheduleLabel')}</div>
                    <ScheduleFields frequency={backupSchedFrequency} onFrequencyChange={setBackupSchedFrequency} dayOfWeek={backupSchedDay} onDayOfWeekChange={setBackupSchedDay} dayOfMonth={backupSchedDayOfMonth} onDayOfMonthChange={setBackupSchedDayOfMonth} hour={backupSchedHour} onHourChange={setBackupSchedHour} hour12={settings?.timeFormat !== '24h'} disabled={!settings} allowCron cronExpression={backupCronExpression} onCronExpressionChange={setBackupCronExpression} />
                  </div>

                  <div className="settings-field__row" style={{ marginTop: 10 }}>
                    <button type="button" className="btn" disabled={backupSchedSaving || !settings} onClick={saveBackupSchedule}>
                      {backupSchedSaving ? t('SettingsPage.saving') : t('SettingsPage.save')}
                    </button>
                  </div>
                  {backupSchedError && <div className="status-note status-note--error">{backupSchedError}</div>}
                </div>
              </>
            )}
          </div>

          <div className={activeSection === 'backups' ? '' : 'settings-hidden'}>
            <RemoteBackupSection />
          </div>

          <div className={`settings-card${activeSection === 'recovery' ? '' : ' settings-hidden'}`} data-section-id="recovery">
            <div className="settings-card__title">{t('SettingsPage.recovery.title')}</div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.recovery.restoreConfigTitle')}</div>
              <div className="toggle-row__desc">
                {t('SettingsPage.recovery.restoreConfigDesc')}
              </div>
              <div className="settings-field__row">
                <button type="button" className="btn" onClick={() => setRestoreDialog({ source: 'upload' })}>
                  {t('SettingsPage.recovery.fromUpload')}
                </button>
                <button type="button" className="btn" onClick={() => setRestoreDialog({ source: 'local' })}>
                  {t('SettingsPage.recovery.fromLocal')}
                </button>
                <button type="button" className="btn" onClick={() => setRestoreDialog({ source: 'remote' })}>
                  {t('SettingsPage.recovery.fromRemote')}
                </button>
              </div>
              <div className="toggle-row__desc" style={{ marginTop: 6 }}>
                {t('SettingsPage.recovery.cliDecryptPrefix')} <code>nonraid-tool decrypt-backup</code> {t('SettingsPage.recovery.cliDecryptSuffix')}
              </div>
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.recovery.recoverArrayTitle')}</div>
              <div className="toggle-row__desc">
                {t('SettingsPage.recovery.recoverArrayDesc')}
              </div>
              <div className="settings-field__row">
                <button type="button" className="btn" onClick={() => setRestoreDialog({ source: 'upload', focusCategory: 'array' })}>
                  {t('SettingsPage.recovery.fromUpload')}
                </button>
                <button type="button" className="btn" onClick={() => setRestoreDialog({ source: 'local', focusCategory: 'array' })}>
                  {t('SettingsPage.recovery.fromLocal')}
                </button>
                <button type="button" className="btn" onClick={() => setRestoreDialog({ source: 'remote', focusCategory: 'array' })}>
                  {t('SettingsPage.recovery.fromRemote')}
                </button>
              </div>
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.recovery.importArrayTitle')}</div>
              <div className="toggle-row__desc">
                {t('SettingsPage.recovery.importDescPrefix')} <code>.dat</code> {t('SettingsPage.recovery.importDescSuffix')}
              </div>
              <div className="settings-field__row">
                <button type="button" className="btn" onClick={() => setShowImportWizard(true)}>
                  {t('SettingsPage.recovery.importArrayButton')}
                </button>
              </div>
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.recovery.importUnraidTitle')}</div>
              <div className="toggle-row__desc">{t('SettingsPage.recovery.importUnraidDesc')}</div>
              <div className="settings-field__row">
                <button type="button" className="btn" onClick={() => setShowImportUnraidWizard(true)}>
                  {t('SettingsPage.recovery.importUnraidButton')}
                </button>
              </div>
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.recovery.bootSnapshotsTitle')}</div>
              <BootSnapshotsSection />
            </div>
          </div>

          {restoreDialog?.source === 'upload' && (
            <ConfigRestoreWizard
              onClose={() => setRestoreDialog(null)}
              focusCategory={restoreDialog.focusCategory}
              title={restoreDialog.focusCategory === 'array' ? t('SettingsPage.recovery.recoverArrayWizardTitle') : t('SettingsPage.recovery.restoreWizardTitle')}
            />
          )}
          {restoreDialog?.source === 'local' && <RestoreFromLocalWizard onClose={() => setRestoreDialog(null)} focusCategory={restoreDialog.focusCategory} />}
          {restoreDialog?.source === 'remote' && <RestoreFromRemoteWizard onClose={() => setRestoreDialog(null)} focusCategory={restoreDialog.focusCategory} />}
          {showImportWizard && <ImportArrayWizard onClose={() => setShowImportWizard(false)} />}
          {showImportUnraidWizard && <ImportUnraidWizard onClose={() => setShowImportUnraidWizard(false)} />}

          <div className={`settings-card${activeSection === 'notifications' ? '' : ' settings-hidden'}`} data-section-id="notifications">
            <div className="settings-card__title">{t('SettingsPage.notifications.title')}</div>
            <div className="toggle-row">
              <div>
                <div className="toggle-row__title">{t('SettingsPage.notifications.appriseToggleTitle')}</div>
                <div className="toggle-row__desc">{t('SettingsPage.notifications.appriseToggleDesc')}</div>
              </div>
              <ToggleSwitch
                on={settings?.notifications.enabled ?? false}
                onToggle={() =>
                  settings &&
                  update({
                    notifications: { enabled: !settings.notifications.enabled },
                  })
                }
                label={t('SettingsPage.notifications.appriseToggleTitle')}
                disabled={!settings || saving}
              />
            </div>

            <div className="settings-field toggle-row--bordered">
              <div className="toggle-row__title">{t('SettingsPage.notifications.whichEventsTitle')}</div>
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
                          <span className="toggle-row__desc">{t('SettingsPage.notifications.tempUnitCelsius')}</span>
                          <button type="button" className="btn" disabled={cpuTempThresholdSaving || !settings} onClick={saveCpuTempThreshold}>
                            {cpuTempThresholdSaving ? t('SettingsPage.saving') : t('SettingsPage.save')}
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
                          <span className="toggle-row__desc">{t('SettingsPage.notifications.tempUnitCelsius')}</span>
                          <button type="button" className="btn" disabled={diskTempThresholdSaving || !settings} onClick={saveDiskTempThreshold}>
                            {diskTempThresholdSaving ? t('SettingsPage.saving') : t('SettingsPage.save')}
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
              <div className="toggle-row__title">{t('SettingsPage.notifications.targetUrlsTitle')}</div>
              <div className="toggle-row__desc">
                {t('SettingsPage.notifications.targetUrlsDescPrefix')}{' '}
                <a href="https://github.com/caronc/apprise#popular-notification-services" target="_blank" rel="noreferrer">
                  {t('SettingsPage.notifications.targetUrlsLinkText')}
                </a>
                {t('SettingsPage.notifications.targetUrlsDescSuffix')}
              </div>
              <AppriseTargetsField value={appriseDraft} onChange={setAppriseDraft} />
              <div className="settings-field__row">
                <button type="button" className="btn" disabled={saving} onClick={saveNotifications}>
                  {saving ? t('SettingsPage.saving') : t('SettingsPage.save')}
                </button>
                <button type="button" className="btn" disabled={testSending} onClick={sendTest}>
                  {testSending ? t('SettingsPage.notifications.sendingButton') : t('SettingsPage.notifications.sendTestButton')}
                </button>
              </div>
              {testResult && <div className="status-note">{testResult}</div>}
              {testError && <div className="status-note status-note--error">{testError}</div>}
            </div>
          </div>

          <div className={`settings-card${activeSection === 'security' ? '' : ' settings-hidden'}`} data-section-id="security">
            <div className="settings-card__title">{t('SettingsPage.security.title')}</div>
            <TlsSection />
            <div className="toggle-row">
              <div>
                <div className="toggle-row__title">{t('SettingsPage.security.trustProxyTitle')}</div>
                <div className="toggle-row__desc">{t('SettingsPage.security.trustProxyDesc')}</div>
              </div>
              <ToggleSwitch on={settings?.trustProxy ?? false} onToggle={() => settings && update({ trustProxy: !settings.trustProxy })} label={t('SettingsPage.security.trustProxyTitle')} disabled={!settings || saving} />
            </div>
            <div className="settings-field">
              <div className="toggle-row__title">{t('SettingsPage.security.trustProxyAddressTitle')}</div>
              <div className="toggle-row__desc">
                {t('SettingsPage.security.trustProxyAddressDesc')}
              </div>
              <div className="settings-field__row">
                <input
                  className="history-input"
                  style={{ flex: 1, minWidth: 200 }}
                  value={trustProxyAddressDraft}
                  onChange={(e) => setTrustProxyAddressDraft(e.target.value)}
                  placeholder={t('SettingsPage.security.trustProxyAddressPlaceholder')}
                  disabled={!settings}
                />
                <button type="button" className="btn" disabled={!settings || saving} onClick={saveTrustProxyAddress}>
                  {saving ? t('SettingsPage.saving') : t('SettingsPage.save')}
                </button>
              </div>
              {saveError && <div className="status-note status-note--error">{saveError}</div>}
            </div>
            <div className="settings-field">
              <div className="toggle-row__title">{t('SettingsPage.security.changePasswordTitle')}</div>
              <div className="toggle-row__desc">{t('SettingsPage.security.changePasswordDesc')}</div>
              <input type="password" className="history-input" style={{ width: '100%' }} value={newPasswordDraft} onChange={(e) => setNewPasswordDraft(e.target.value)} placeholder={t('SettingsPage.security.newPasswordPlaceholder')} autoComplete="new-password" />
              <input type="password" className="history-input" style={{ width: '100%' }} value={confirmPasswordDraft} onChange={(e) => setConfirmPasswordDraft(e.target.value)} placeholder={t('SettingsPage.security.confirmPasswordPlaceholder')} autoComplete="new-password" />
              <div className="settings-field__row">
                <button type="button" className="btn" onClick={startPasswordChange}>
                  {t('SettingsPage.security.changePasswordButton')}
                </button>
              </div>
              {passwordError && <div className="status-note status-note--error">{passwordError}</div>}
              {confirmingPasswordChange && (
                <StepUpModal
                  title={t('SettingsPage.security.stepUpTitle')}
                  description={t('SettingsPage.security.stepUpDesc')}
                  confirmLabel={t('SettingsPage.security.changePasswordButton')}
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
            <ApiTokensSection />
          </div>

          <div className={`settings-card${activeSection === 'tailscale' ? '' : ' settings-hidden'}`} data-section-id="tailscale">
            <div className="settings-card__title">{t('SettingsPage.tailscale.title')}</div>
            <TailscaleSection />
          </div>

          <div className={`settings-card${activeSection === 'update' ? '' : ' settings-hidden'}`} data-section-id="update">
            <div className="settings-card__title">{t('SettingsPage.update.title')}</div>
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
