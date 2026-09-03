import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lxcApi } from '../api/lxcApi';
import { CreateLxcDialog } from '../components/lxc/CreateLxcDialog';
import { DistroIcon } from '../components/lxc/DistroIcon';
import { EditLxcConfigDialog } from '../components/lxc/EditLxcConfigDialog';
import { SnapshotsDialog } from '../components/lxc/SnapshotsDialog';
import { BulkContainerActionDialog } from '../components/shared/BulkContainerActionDialog';
import { useLxcContainers } from '../hooks/useLxcContainers';
import { useSettings } from '../hooks/useSettings';
import { deriveLxcContainerViewModel } from '../selectors/lxcContainers';

type DialogState = { mode: 'add' } | { mode: 'edit'; name: string } | { mode: 'snapshots'; name: string } | null;

export function LxcPage() {
  const { t } = useTranslation('pages');
  const { containers, status, error, pendingNames, start, stop, restart, destroy, setAutostart, refresh } = useLxcContainers();
  const { settings } = useSettings();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirmingDestroy, setConfirmingDestroy] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<'stop' | 'restart' | null>(null);

  const runningContainers = containers.filter((c) => c.state === 'running').map((c) => ({ id: c.name, name: c.name }));

  const handleDestroyClick = (name: string) => {
    if (confirmingDestroy === name) {
      destroy(name);
      setConfirmingDestroy(null);
    } else {
      setConfirmingDestroy(name);
    }
  };

  const views = containers.map((c) =>
    deriveLxcContainerViewModel(
      c,
      {
        isPending: pendingNames.has(c.name),
        onToggle: () => (c.state === 'running' ? stop(c.name) : start(c.name)),
        onRestart: () => restart(c.name),
        onDestroy: () => handleDestroyClick(c.name),
        onEdit: () => setDialog({ mode: 'edit', name: c.name }),
        onSnapshots: () => setDialog({ mode: 'snapshots', name: c.name }),
        onToggleAutostart: () => setAutostart(c.name, !c.autostart),
      },
      settings?.appLinkHost,
    ),
  );

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">{t('LxcPage.title')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" disabled={runningContainers.length === 0} onClick={() => setBulkAction('stop')}>
            {t('LxcPage.stopAll')}
          </button>
          <button type="button" className="btn" disabled={runningContainers.length === 0} onClick={() => setBulkAction('restart')}>
            {t('LxcPage.restartAll')}
          </button>
          <button type="button" className="btn--primary" onClick={() => setDialog({ mode: 'add' })}>
            {t('LxcPage.addContainer')}
          </button>
        </div>
      </div>

      {status === 'loading' && <div className="status-note">{t('LxcPage.loadingContainers')}</div>}
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
            <div className="docker-card__autostart-row">
              <label className="docker-card__autostart">
                <input type="checkbox" checked={c.autostart} disabled={c.isPending} onChange={c.onToggleAutostart} />
                {t('LxcPage.autostart')}
              </label>
            </div>
            {c.webUiUrl && (
              <div className="docker-card__badges">
                <a className="docker-card__weburl" href={c.webUiUrl} target="_blank" rel="noreferrer">
                  {t('LxcPage.webUi')} &#8599;
                </a>
              </div>
            )}
            <div className="docker-card__stats">
              <span>{t('LxcPage.cpuLabel')} {c.cpuLabel}</span>
              <span>{t('LxcPage.memLabel')} {c.memLabel}</span>
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
                {t('LxcPage.restart')}
              </button>
            </div>
            <div className="docker-card__actions">
              <button type="button" className="btn" disabled={c.isPending} onClick={c.onEdit}>
                {t('LxcPage.edit')}
              </button>
              <button type="button" className="btn" disabled={c.isPending} onClick={c.onSnapshots}>
                {t('LxcPage.snapshots')}
              </button>
              <button type="button" className="btn btn--danger" disabled={c.isPending} onClick={c.onDestroy}>
                {confirmingDestroy === c.name ? t('LxcPage.confirmQuestion') : t('LxcPage.destroy')}
              </button>
            </div>
          </div>
        ))}
        {status === 'ready' && views.length === 0 && <div className="status-note">{t('LxcPage.noContainers')}</div>}
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

      {bulkAction && (
        <BulkContainerActionDialog
          action={bulkAction}
          items={runningContainers}
          run={bulkAction === 'stop' ? lxcApi.stopContainer : lxcApi.restartContainer}
          onDone={refresh}
          onClose={() => setBulkAction(null)}
        />
      )}
    </div>
  );
}
