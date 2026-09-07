import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { luksApi } from '../../api/luksApi';
import { useSettings } from '../../hooks/useSettings';
import { deriveDisks } from '../../selectors/disks';
import { useArrayStatus } from '../../state/useArrayStatus';
import { COLORS } from '../../styles/colors';
import { Card } from '../shared/Card';
import type { DiskViewModel } from '../../types';

function LockedDiskRow({ disk, onUnlocked }: { disk: DiskViewModel; onUnlocked: () => void }) {
  const { t } = useTranslation('dashboard');
  const [passphrase, setPassphrase] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!passphrase) return;
    setSubmitting(true);
    setError(null);
    try {
      await luksApi.unlock(disk.slot, passphrase);
      setPassphrase('');
      onUnlocked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="luks-locked-row">
      <div className="luks-locked-row__label">{disk.customLabel ?? disk.label}</div>
      <input
        type="password"
        className="history-input"
        placeholder={t('LuksLockedCard.passphrasePlaceholder')}
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        disabled={submitting}
      />
      <button type="button" className="btn btn--primary" disabled={submitting || !passphrase} onClick={submit}>
        {submitting ? t('LuksLockedCard.unlocking') : t('LuksLockedCard.unlock')}
      </button>
      {error && <div className="status-note status-note--error">{error}</div>}
    </div>
  );
}

/**
 * Dashboard-level "N disks locked" summary - a locked LUKS data disk can't serve any share until
 * unlocked (see docs/luks-support-scope.md, and ShareService.buildContext(), which already
 * excludes a disk with no live mountpoint from every share exactly the same way it would for any
 * other unmounted disk). Prominent by design: this is a disk that's fully present and healthy per
 * the array driver, just inaccessible, which otherwise looks identical to "everything's fine" on
 * every other card. Unlock is deliberately not step-up gated here (see routes/luks.ts) - typing an
 * already-known passphrase to use a disk you're already an authenticated admin for is the same
 * operational tier as unassigning a disk, not the "mint new key material" tier format/mode-switch
 * are in.
 */
export function LuksLockedCard() {
  const { t } = useTranslation('dashboard');
  const { status, temps, refresh } = useArrayStatus();
  const { settings } = useSettings();
  if (!status) return null;

  // Same diskLabels thread ArrayDisks/DiskDetailPanel already pass through, so a locked disk with
  // a custom nickname shows that nickname here too rather than always falling back to "Disk N" -
  // otherwise this card, of all places, is the one where matching the row to the right physical
  // drive matters most (the disk is inaccessible until the admin picks the right one to unlock).
  const { data } = deriveDisks(status, temps, {}, {}, {}, {}, settings?.diskLabels ?? {});
  const locked = data.filter((d) => d.encryption === 'luks-locked');
  if (locked.length === 0) return null;

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
          <LockedDiskRow key={disk.slot} disk={disk} onUnlocked={refresh} />
        ))}
      </div>
    </Card>
  );
}
