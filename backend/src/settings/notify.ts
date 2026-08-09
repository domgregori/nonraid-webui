import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { NmdCommandResult } from '../nmd/types.js';
import type { NotificationEventType } from './notificationCatalog.js';
import type { SettingsStore } from './store.js';

const execFileAsync = promisify(execFile);

/**
 * Shells out to the real `apprise` CLI (https://github.com/caronc/apprise) —
 * URLs are passed as separate argv entries (execFile, no shell), never
 * concatenated into a command string, so this is safe even though the URLs
 * are user-supplied config. `apprise` itself isn't bundled with this project;
 * if it's not installed, the resulting ENOENT surfaces as a clear error
 * rather than silently doing nothing.
 */
export async function sendAppriseNotification(appriseUrls: string, title: string, body: string): Promise<NmdCommandResult> {
  const urls = appriseUrls.split(/\s+/).filter(Boolean);
  if (urls.length === 0) {
    throw new Error('No notification URLs configured — add at least one apprise target URL first.');
  }

  try {
    await execFileAsync(config.appriseBin, ['-t', title, '-b', body, ...urls], { timeout: 15_000 });
    return { ok: true, message: `Sent to ${urls.length} target${urls.length === 1 ? '' : 's'}.` };
  } catch (err) {
    const e = err as { code?: string; stdout?: string; stderr?: string; message: string };
    if (e.code === 'ENOENT') {
      throw new Error(`"${config.appriseBin}" isn't installed or isn't on PATH.`);
    }
    throw new Error(e.stderr?.trim() || e.stdout?.trim() || e.message);
  }
}

/**
 * Gate + send for one specific event type — respects the master enabled toggle, the per-event
 * toggle (see notificationCatalog.ts), and whether any apprise target is configured. Best-effort:
 * a bad/unreachable target must never break the caller's own tick/request, so every failure here is
 * swallowed — the activity log entry each call site already writes is the record either way.
 */
export async function notifyEvent(settingsStore: SettingsStore, eventType: NotificationEventType, title: string, body: string): Promise<void> {
  try {
    const settings = await settingsStore.get();
    if (!settings.notifications.enabled || !settings.notifications.eventTypes[eventType] || !settings.notifications.appriseUrls.trim()) {
      return;
    }
    await sendAppriseNotification(settings.notifications.appriseUrls, title, body);
  } catch {
    // swallowed — see doc comment above
  }
}
