import { useTranslation } from 'react-i18next';
import { useSettings } from '../../hooks/useSettings';
import { useUnlockAllDisks, type UnlockAllResult } from '../../hooks/useUnlockAllDisks';
import { deriveDisks } from '../../selectors/disks';
import { useArrayStatus } from '../../state/useArrayStatus';
import { COLORS } from '../../styles/colors';
import { Card } from '../shared/Card';
import type { DiskViewModel } from '../../types';

/** One locked disk's row - no input of its own anymore (see LuksLockedCard's own doc comment on
 *  why "Unlock All" replaced a per-row passphrase field). Only shows anything extra when the last
 *  "Unlock All" attempt specifically failed on this disk - a disk that succeeded just drops out of
 *  the list on the next refresh, which is feedback enough on its own. */
function LockedDiskRow({ disk, result }: { disk: DiskViewModel; result?: UnlockAllResult }) {
  return (
    <div className="luks-locked-row">
      <div className="luks-locked-row__label">{disk.customLabel ?? disk.label}</div>
      {result && !result.ok && <div className="status-note status-note--error">{result.error}</div>}
    </div>
  );
}

/**
 * Dashboard-level "N disks locked" summary - a locked LUKS data disk can't serve any share until
 * unlocked (see docs/luks-support-scope.md, and ShareService.buildContext(), which already
 * excludes a disk with no live mountpoint from every share exactly the same way it would for any
 * other unmounted disk). Prominent by design: this is a disk that's fully present and healthy per
 * the array driver, just inaccessible, which otherwise looks identical to "everything's fine" on
 * every other card.
 *
 * One shared "Unlock All" passphrase field rather than a field per locked disk - every LUKS disk
 * in this app is meant to share the same day-to-day passphrase/key (both unlock modes are
 * array-wide, not per-disk, see docs/luks-support-scope.md), so asking the admin to retype an
 * identical passphrase once per disk was pure friction. Falls back gracefully if that's not
 * actually true right now (disks formatted separately, outside this app's own convention): each
 * disk is unlocked independently (useUnlockAllDisks), and one that doesn't match the given
 * passphrase just stays listed with its own error, rather than the whole action failing silently.
 * Unlock is deliberately not step-up gated here (see routes/luks.ts) - typing an already-known
 * passphrase to use a disk you're already an authenticated admin for is the same operational tier
 * as unassigning a disk, not the "mint new key material" tier format/mode-switch are in.
 */
export function LuksLockedCard() {
  const { t } = useTranslation('dashboard');
  const { status, temps, refresh } = useArrayStatus();
  const { settings } = useSettings();
  const { passphrase, setPassphrase, pending, results, unlockAll } = useUnlockAllDisks(refresh);
  if (!status) return null;

  // Same diskLabels thread ArrayDisks/DiskDetailPanel already pass through, so a locked disk with
  // a custom nickname shows that nickname here too rather than always falling back to "Disk N" -
  // otherwise this card, of all places, is the one where matching the row to the right physical
  // drive matters most (the disk is inaccessible until the admin picks the right one to unlock).
  const { data } = deriveDisks(status, temps, {}, {}, {}, {}, settings?.diskLabels ?? {});
  const locked = data.filter((d) => d.encryption === 'luks-locked');
  if (locked.length === 0) return null;

  const resultFor = (slot: number) => results?.find((r) => r.slot === slot);
  const failedCount = results?.filter((r) => !r.ok).length ?? 0;
  const submit = () => unlockAll(locked.map((d) => d.slot));

  return (
    <Card className="parity-card">
      <div className="parity-card__head">
        <div className="eyebrow" style={{ color: COLORS.red }}>
          {t('LuksLockedCard.title', { count: locked.length })}
        </div>
      </div>
      <div className="status-note status-note--error">{t('LuksLockedCard.description', { count: locked.length })}</div>

      <div className="luks-locked-list">
        {locked.map((disk) => (
          <LockedDiskRow key={disk.slot} disk={disk} result={resultFor(disk.slot)} />
        ))}
      </div>

      <div className="settings-field__row" style={{ marginTop: 8 }}>
        <input
          type="password"
          className="history-input"
          placeholder={t('LuksLockedCard.passphrasePlaceholder')}
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          disabled={pending}
        />
        <button type="button" className="btn btn--primary" disabled={pending || !passphrase} onClick={submit}>
          {pending ? t('LuksLockedCard.unlocking') : t('LuksLockedCard.unlockAll')}
        </button>
      </div>

      {failedCount > 0 && <div className="status-note status-note--error" style={{ marginTop: 8 }}>{t('LuksLockedCard.someFailed', { count: failedCount })}</div>}
    </Card>
  );
}
