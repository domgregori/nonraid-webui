import { useEffect, useRef, useState } from 'react';
import { authApi } from '../api/authApi';
import { nmdApi } from '../api/nmdApi';
import { settingsApi } from '../api/settingsApi';
import { ImportArrayWizard } from '../components/settings/ImportArrayWizard';
import { ToggleSwitch } from '../components/shared/ToggleSwitch';
import { useSettings } from '../hooks/useSettings';
import { useSystemStats } from '../hooks/useSystemStats';
import { useArrayStatus } from '../state/useArrayStatus';
import { formatMemLabel, formatUptime } from '../utils/format';

export function SettingsPage() {
  const { settings, loadState, error, saving, saveError, update } = useSettings();
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

  useEffect(() => {
    if (status && !labelInitialized.current) {
      setLabelDraft(status.array.label);
      labelInitialized.current = true;
    }
  }, [status]);

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

  const arrayStarted = status?.array.state === 'STARTED';

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
        <div className="settings-card__title">Notifications</div>
        <div className="toggle-row">
          <div>
            <div className="toggle-row__title">Event notifications</div>
            <div className="toggle-row__desc">Enable dispatching notifications via apprise</div>
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
