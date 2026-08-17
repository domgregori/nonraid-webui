import { useState } from 'react';
import { CreateLxcDialog } from '../components/lxc/CreateLxcDialog';
import { DistroIcon } from '../components/lxc/DistroIcon';
import { EditLxcConfigDialog } from '../components/lxc/EditLxcConfigDialog';
import { SnapshotsDialog } from '../components/lxc/SnapshotsDialog';
import { useLxcContainers } from '../hooks/useLxcContainers';
import { deriveLxcContainerViewModel } from '../selectors/lxcContainers';

type DialogState = { mode: 'add' } | { mode: 'edit'; name: string } | { mode: 'snapshots'; name: string } | null;

export function LxcPage() {
  const { containers, status, error, pendingNames, start, stop, restart, destroy, refresh } = useLxcContainers();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirmingDestroy, setConfirmingDestroy] = useState<string | null>(null);

  const handleDestroyClick = (name: string) => {
    if (confirmingDestroy === name) {
      destroy(name);
      setConfirmingDestroy(null);
    } else {
      setConfirmingDestroy(name);
    }
  };

  const views = containers.map((c) =>
    deriveLxcContainerViewModel(c, {
      isPending: pendingNames.has(c.name),
      onToggle: () => (c.state === 'running' ? stop(c.name) : start(c.name)),
      onRestart: () => restart(c.name),
      onDestroy: () => handleDestroyClick(c.name),
      onEdit: () => setDialog({ mode: 'edit', name: c.name }),
      onSnapshots: () => setDialog({ mode: 'snapshots', name: c.name }),
    }),
  );

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">LXC Containers</div>
        <button type="button" className="btn--primary" onClick={() => setDialog({ mode: 'add' })}>
          Add Container
        </button>
      </div>

      {status === 'loading' && <div className="status-note">Loading containers…</div>}
      {error && <div className="status-note status-note--error">{error}</div>}

      <div className="docker-grid">
        {views.map((c) => (
          <div className="docker-card" key={c.name}>
            <div className="docker-card__head">
              <div className="docker-card__identity">
                <DistroIcon distribution={c.distribution} fallbackLabel={c.name} size={32} />
                <div className="docker-card__name">{c.name}</div>
              </div>
              <span className="docker-card__status" style={{ color: c.statusColor }}>
                <span className="docker-card__status-dot" style={{ background: c.statusColor }} />
                {c.statusLabel}
              </span>
            </div>
            {c.description && <div className="docker-card__image">{c.description}</div>}
            <div className="docker-card__badges">
              {c.autostart && <span className="docker-card__badge docker-card__badge--ca">Autostart</span>}
              {c.webUiUrl && (
                <a className="docker-card__weburl" href={c.webUiUrl.replace('[IP]', window.location.hostname)} target="_blank" rel="noreferrer">
                  Web UI &#8599;
                </a>
              )}
            </div>
            <div className="docker-card__stats">
              <span>CPU {c.cpuLabel}</span>
              <span>Mem {c.memLabel}</span>
              <span>{c.ips}</span>
            </div>
            <div className="docker-card__actions">
              <button
                type="button"
                className="btn"
                disabled={c.isPending}
                style={{ borderColor: c.toggleBorder, background: c.toggleBg, color: c.toggleFg }}
                onClick={c.onToggle}
              >
                {c.toggleLabel}
              </button>
              <button type="button" className="btn" disabled={c.isPending} onClick={c.onRestart}>
                Restart
              </button>
            </div>
            <div className="docker-card__actions">
              <button type="button" className="btn" disabled={c.isPending} onClick={c.onEdit}>
                Edit
              </button>
              <button type="button" className="btn" disabled={c.isPending} onClick={c.onSnapshots}>
                Snapshots
              </button>
              <button type="button" className="btn btn--danger" disabled={c.isPending} onClick={c.onDestroy}>
                {confirmingDestroy === c.name ? 'Confirm?' : 'Destroy'}
              </button>
            </div>
          </div>
        ))}
        {status === 'ready' && views.length === 0 && <div className="status-note">No LXC containers yet.</div>}
      </div>

      {dialog?.mode === 'add' && <CreateLxcDialog onClose={() => setDialog(null)} onDone={refresh} />}

      {dialog?.mode === 'edit' && <EditLxcConfigDialog name={dialog.name} onClose={() => setDialog(null)} onDone={refresh} />}

      {dialog?.mode === 'snapshots' && (
        <SnapshotsDialog
          name={dialog.name}
          containerState={containers.find((c) => c.name === dialog.name)?.state ?? 'unknown'}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}
