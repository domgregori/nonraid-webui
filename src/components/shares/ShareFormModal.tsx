import { useEffect, useState } from 'react';
import { useCacheStatus } from '../../hooks/useCacheStatus';
import { useArrayStatus } from '../../state/useArrayStatus';
import type { AllocationMethod, Share, ShareInput } from '../../types/sharesApi';
import { ToggleSwitch } from '../shared/ToggleSwitch';

interface ShareFormModalProps {
  initial: Share | null; // null = create mode
  existingNames: string[];
  onCancel: () => void;
  onSubmit: (input: ShareInput) => Promise<boolean>;
}

const ALLOCATION_OPTIONS: { value: AllocationMethod; label: string; description: string }[] = [
  {
    value: 'most-free',
    label: 'Most-free',
    description: 'Writes new files to whichever disk currently has the most free space - keeps usage balanced across all disks over time.',
  },
  {
    value: 'fill-up',
    label: 'Fill-up',
    description: 'Fills disks in order - writes go to the first disk (in disk order) with room until it’s full, then moves on to the next.',
  },
  {
    value: 'high-water',
    label: 'High-water',
    description:
      'Keeps files under the same path together on one disk when possible, otherwise picks the disk with the most free space. An approximation of the classic High-Water allocation policy, not an exact match.',
  },
  {
    value: 'single-disk',
    label: 'Single disk',
    description: 'Pins this pool to exactly one disk - no spreading files across drives.',
  },
  {
    value: 'cache-only',
    label: 'Cache only',
    description: 'Lives entirely on the cache disks - no array disk is used, and the mover never touches it.',
  },
];

export function ShareFormModal({ initial, existingNames, onCancel, onSubmit }: ShareFormModalProps) {
  const { status } = useArrayStatus();
  // A cache pool must actually be set up (fsUuid persisted, even if currently degraded) before
  // "Cache only" can be picked at all - configuring a share that can never mount is worse than
  // just not offering the option yet. Mirrors the /cache/enabled route's own fsUuid gate.
  const { status: cacheStatus } = useCacheStatus();
  const cacheConfigured = cacheStatus !== null && cacheStatus.health !== 'not-configured';
  const dataDisks = (status?.disks ?? []).filter((d) => d.type === 'data').sort((a, b) => a.slot - b.slot);

  const allDiskSlots = dataDisks.map((d) => d.slot);

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [disks, setDisks] = useState<number[]>(initial?.disks ?? allDiskSlots);
  const [allocationMethod, setAllocationMethod] = useState<AllocationMethod>(initial?.allocationMethod ?? 'most-free');
  // Default to "all drives" on create. On edit, trust the share's own persisted
  // allDisks flag when present - falls back to inferring from the current disk
  // list only for shares saved before that flag existed.
  const [useAllDisks, setUseAllDisks] = useState<boolean>(() => {
    if (initial?.allocationMethod === 'single-disk') return false;
    if (initial && initial.allDisks !== undefined) return initial.allDisks;
    const disksAtLoad = initial?.disks ?? allDiskSlots;
    return (
      disksAtLoad.length === allDiskSlots.length &&
      allDiskSlots.every((slot) => disksAtLoad.includes(slot))
    );
  });

  // Keep the disk list in sync with the array while "all drives" is on, so a disk added
  // after the modal opens (or removed) is reflected without the user re-toggling anything.
  const allDiskSlotsKey = allDiskSlots.join(',');
  useEffect(() => {
    if (useAllDisks) setDisks(allDiskSlots);
  }, [useAllDisks, allDiskSlotsKey]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isEdit = initial !== null;

  const toggleDisk = (slot: number) => {
    setDisks((prev) => {
      if (allocationMethod === 'single-disk') return prev.includes(slot) ? [] : [slot];
      return prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot].sort((a, b) => a - b);
    });
  };

  const handleAllocationChange = (value: AllocationMethod) => {
    setAllocationMethod(value);
    if (value === 'single-disk') {
      // "All drives" doesn't apply to a single-disk share - fall back to manual selection.
      setUseAllDisks(false);
      if (disks.length > 1) setDisks(disks.slice(0, 1));
    } else if (value === 'cache-only') {
      // A cache-only share has no array disks at all - the picker is hidden entirely below.
      setUseAllDisks(false);
      setDisks([]);
    }
  };

  const validate = (): string | null => {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) return 'Name must be 1-32 characters: letters, numbers, dash, underscore.';
    if (!isEdit && existingNames.includes(name)) return `Pool "${name}" already exists.`;
    if (allocationMethod === 'cache-only') {
      if (!cacheConfigured) return 'Set up a cache pool on the Disks page before creating a cache-only pool.';
    } else {
      if (disks.length === 0) return 'Select at least one disk.';
      if (allocationMethod === 'single-disk' && disks.length !== 1) return 'Single-disk allocation requires exactly one disk.';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    // SMB/NFS export settings aren't edited here - see the Sharing tab - so an edit passes them
    // through unchanged, and a new pool starts with none at all (not shared anywhere yet).
    const input: ShareInput = {
      name,
      disks,
      allDisks: useAllDisks,
      allocationMethod,
      protocols: initial?.protocols ?? [],
      smb: initial?.smb,
      nfs: initial?.nfs,
      description: description.trim() || undefined,
    };

    setSubmitting(true);
    setError(null);
    const ok = await onSubmit(input);
    setSubmitting(false);
    if (!ok) setError('Request failed - see the page error banner for details.');
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{isEdit ? `Edit ${initial.name}` : 'Add Pool'}</div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <label className="form-field">
            <span className="form-field__label">Name</span>
            <input className="history-input" style={{ width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="media" />
          </label>

          <label className="form-field">
            <span className="form-field__label">Description (optional)</span>
            <input
              className="history-input"
              style={{ width: '100%' }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this pool for?"
              maxLength={200}
            />
          </label>

          {allocationMethod === 'cache-only' ? (
            <div className="status-note">This pool lives entirely on the cache disks - no array disk is used, and the mover never touches it.</div>
          ) : (
            <div className="form-field">
              <div className="toggle-row" style={{ padding: 0 }}>
                <div>
                  <div className="toggle-row__title">Use all drives</div>
                  <div className="toggle-row__desc">
                    {useAllDisks
                      ? `Using all ${allDiskSlots.length} data disk(s) - new disks are added automatically`
                      : 'Choose specific disks below'}
                  </div>
                </div>
                <ToggleSwitch
                  on={useAllDisks}
                  onToggle={() => setUseAllDisks((prev) => !prev)}
                  label="Use all drives"
                  disabled={allocationMethod === 'single-disk'}
                />
              </div>

              {!useAllDisks && (
                <div className="disk-checkbox-grid" style={{ marginTop: 8 }}>
                  {dataDisks.map((d) => (
                    <label key={d.slot} className="disk-checkbox">
                      <input
                        type={allocationMethod === 'single-disk' ? 'radio' : 'checkbox'}
                        checked={disks.includes(d.slot)}
                        onChange={() => toggleDisk(d.slot)}
                      />
                      Disk {d.slot}
                    </label>
                  ))}
                  {dataDisks.length === 0 && <span className="status-note">No data disks reported by the array right now.</span>}
                </div>
              )}
            </div>
          )}

          <label className="form-field">
            <span className="form-field__label">Allocation method</span>
            <select
              className="history-input"
              style={{ width: '100%' }}
              value={allocationMethod}
              onChange={(e) => handleAllocationChange(e.target.value as AllocationMethod)}
              title={ALLOCATION_OPTIONS.find((opt) => opt.value === allocationMethod)?.description}
            >
              {ALLOCATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.value === 'cache-only' && !cacheConfigured} title={opt.description}>
                  {opt.value === 'cache-only' && !cacheConfigured ? `${opt.label} (set up a cache pool first)` : opt.label}
                </option>
              ))}
            </select>
          </label>

          {!isEdit && (
            <div className="status-note">
              Not shared anywhere yet - turn on SMB or NFS access for this pool from the Sharing tab once it's
              created.
            </div>
          )}

          {error && <div className="status-note status-note--error">{error}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn--primary" disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Pool'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
