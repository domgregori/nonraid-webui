import { useEffect, useState } from 'react';
import { useArrayStatus } from '../../state/useArrayStatus';
import type { AllocationMethod, Share, ShareInput } from '../../types/sharesApi';
import { ToggleSwitch } from '../shared/ToggleSwitch';

interface ShareFormModalProps {
  initial: Share | null; // null = create mode
  existingNames: string[];
  onCancel: () => void;
  onSubmit: (input: ShareInput) => Promise<boolean>;
}

const ALLOCATION_OPTIONS: { value: AllocationMethod; label: string }[] = [
  { value: 'most-free', label: 'Most-free' },
  { value: 'fill-up', label: 'Fill-up' },
  { value: 'high-water', label: 'High-water' },
  { value: 'single-disk', label: 'Single disk' },
];

export function ShareFormModal({ initial, existingNames, onCancel, onSubmit }: ShareFormModalProps) {
  const { status } = useArrayStatus();
  const dataDisks = (status?.disks ?? []).filter((d) => d.type === 'data').sort((a, b) => a.slot - b.slot);

  const allDiskSlots = dataDisks.map((d) => d.slot);

  const [name, setName] = useState(initial?.name ?? '');
  const [disks, setDisks] = useState<number[]>(initial?.disks ?? allDiskSlots);
  const [allocationMethod, setAllocationMethod] = useState<AllocationMethod>(initial?.allocationMethod ?? 'most-free');
  // Default to "all drives" on create. On edit, trust the share's own persisted
  // allDisks flag when present — falls back to inferring from the current disk
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
  const [smbEnabled, setSmbEnabled] = useState(initial?.protocols.includes('smb') ?? true);
  const [smbPublic, setSmbPublic] = useState(initial?.smb?.public ?? true);
  const [nfsEnabled, setNfsEnabled] = useState(initial?.protocols.includes('nfs') ?? false);
  const [nfsReadOnly, setNfsReadOnly] = useState(initial?.nfs?.readOnly ?? false);
  const [nfsHosts, setNfsHosts] = useState(initial?.nfs?.allowedHosts?.join(', ') ?? '*');
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
      // "All drives" doesn't apply to a single-disk share — fall back to manual selection.
      setUseAllDisks(false);
      if (disks.length > 1) setDisks(disks.slice(0, 1));
    }
  };

  const validate = (): string | null => {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) return 'Name must be 1-32 characters: letters, numbers, dash, underscore.';
    if (!isEdit && existingNames.includes(name)) return `Share "${name}" already exists.`;
    if (disks.length === 0) return 'Select at least one disk.';
    if (allocationMethod === 'single-disk' && disks.length !== 1) return 'Single-disk allocation requires exactly one disk.';
    if (!smbEnabled && !nfsEnabled) return 'Enable at least one protocol.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const input: ShareInput = {
      name,
      disks,
      allDisks: useAllDisks,
      allocationMethod,
      protocols: [...(smbEnabled ? (['smb'] as const) : []), ...(nfsEnabled ? (['nfs'] as const) : [])],
      smb: smbEnabled ? { public: smbPublic } : undefined,
      nfs: nfsEnabled
        ? { readOnly: nfsReadOnly, allowedHosts: nfsHosts.split(',').map((h) => h.trim()).filter(Boolean) }
        : undefined,
    };

    setSubmitting(true);
    setError(null);
    const ok = await onSubmit(input);
    setSubmitting(false);
    if (!ok) setError('Request failed — see the page error banner for details.');
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{isEdit ? `Edit ${initial.name}` : 'Add Share'}</div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <label className="form-field">
            <span className="form-field__label">Name</span>
            <input className="history-input" style={{ width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="media" />
          </label>

          <div className="form-field">
            <div className="toggle-row" style={{ padding: 0 }}>
              <div>
                <div className="toggle-row__title">Use all drives</div>
                <div className="toggle-row__desc">
                  {useAllDisks
                    ? `Using all ${allDiskSlots.length} data disk(s) — new disks are added automatically`
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

          <label className="form-field">
            <span className="form-field__label">Allocation method</span>
            <select
              className="history-input"
              style={{ width: '100%' }}
              value={allocationMethod}
              onChange={(e) => handleAllocationChange(e.target.value as AllocationMethod)}
            >
              {ALLOCATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <div className="form-field">
            <span className="form-field__label">Protocols</span>
            <label className="disk-checkbox">
              <input type="checkbox" checked={smbEnabled} onChange={(e) => setSmbEnabled(e.target.checked)} /> SMB
            </label>
            {smbEnabled && (
              <label className="disk-checkbox" style={{ marginLeft: 20 }}>
                <input type="checkbox" checked={smbPublic} onChange={(e) => setSmbPublic(e.target.checked)} /> Public (guest access)
              </label>
            )}
            <label className="disk-checkbox">
              <input type="checkbox" checked={nfsEnabled} onChange={(e) => setNfsEnabled(e.target.checked)} /> NFS
            </label>
            {nfsEnabled && (
              <div style={{ marginLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className="disk-checkbox">
                  <input type="checkbox" checked={nfsReadOnly} onChange={(e) => setNfsReadOnly(e.target.checked)} /> Read-only
                </label>
                <label className="form-field">
                  <span className="form-field__label">Allowed hosts (comma-separated, * for any)</span>
                  <input className="history-input" style={{ width: '100%' }} value={nfsHosts} onChange={(e) => setNfsHosts(e.target.value)} />
                </label>
              </div>
            )}
          </div>

          {error && <div className="status-note status-note--error">{error}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn--primary" disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Share'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
