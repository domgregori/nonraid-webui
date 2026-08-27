import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppIcon } from '../components/apps/AppIcon';
import { ContainerFormDialog } from '../components/docker/ContainerFormDialog';
import { LogsDialog } from '../components/docker/LogsDialog';
import { useDockerContainers } from '../hooks/useDockerContainers';
import { deriveContainerViewModel } from '../selectors/containers';

type DialogState =
  | { mode: 'add' }
  | { mode: 'edit'; containerId: string }
  | { mode: 'logs'; containerId: string; containerName: string }
  | null;

export function DockerPage() {
  const { t } = useTranslation('pages');
  const {
    containers,
    status,
    error,
    pendingIds,
    updateStatus,
    checkingUpdates,
    start,
    stop,
    restart,
    destroy,
    setAutostart,
    checkAllUpdates,
    updateNow,
    refresh,
  } = useDockerContainers();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirmingDestroy, setConfirmingDestroy] = useState<string | null>(null);
  const [confirmingUpdate, setConfirmingUpdate] = useState<{ id: string; name: string } | null>(null);

  const handleDestroyClick = (id: string) => {
    if (confirmingDestroy === id) {
      destroy(id);
      setConfirmingDestroy(null);
    } else {
      setConfirmingDestroy(id);
    }
  };

  const handleConfirmUpdate = () => {
    if (!confirmingUpdate) return;
    updateNow(confirmingUpdate.id);
    setConfirmingUpdate(null);
  };

  const views = containers.map((c) =>
    deriveContainerViewModel(c, {
      isPending: pendingIds.has(c.id),
      updateAvailable: updateStatus[c.id]?.updateAvailable ?? null,
      onToggle: () => (c.state === 'running' ? stop(c.id) : start(c.id)),
      onRestart: () => restart(c.id),
      onEdit: () => setDialog({ mode: 'edit', containerId: c.id }),
      onViewLogs: () => setDialog({ mode: 'logs', containerId: c.id, containerName: c.name }),
      onDestroy: () => handleDestroyClick(c.id),
      onToggleAutostart: () => setAutostart(c.id, !c.autostart),
      onUpdateNow: () => setConfirmingUpdate({ id: c.id, name: c.name }),
    }),
  );

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">{t('DockerPage.title')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" disabled={checkingUpdates} onClick={checkAllUpdates}>
            {checkingUpdates ? t('DockerPage.checking') : t('DockerPage.checkForUpdates')}
          </button>
          <button type="button" className="btn--primary" onClick={() => setDialog({ mode: 'add' })}>
            {t('DockerPage.addContainer')}
          </button>
        </div>
      </div>

      {status === 'loading' && <div className="status-note">{t('DockerPage.loadingContainers')}</div>}
      {error && <div className="status-note status-note--error">{error}</div>}

      <div className="docker-grid">
        {views.map((c) => (
          <div className="docker-card" key={c.id}>
            <div className="docker-card__head">
              <div className="docker-card__identity">
                <AppIcon name={c.name} icon={c.icon} size={32} />
                <div className="docker-card__name">{c.name}</div>
              </div>
              <span className="docker-card__status" style={{ color: c.statusColor }}>
                <span className="docker-card__status-dot" style={{ background: c.statusColor }} />
                {c.statusLabel}
              </span>
            </div>
            <div className="docker-card__image">{c.image}</div>
            <div className="docker-card__autostart-row">
              <label className="docker-card__autostart">
                <input type="checkbox" checked={c.autostart} disabled={c.isPending} onChange={c.onToggleAutostart} />
                {t('DockerPage.autostart')}
              </label>
            </div>
            <div className="docker-card__badges">
              {c.caAppName ? (
                <span className="docker-card__badge docker-card__badge--ca">{t('DockerPage.caBadge', { name: c.caAppName })}</span>
              ) : (
                <span className="docker-card__badge docker-card__badge--custom">{t('DockerPage.customBadge')}</span>
              )}
              {c.updateAvailable && <span className="docker-card__badge docker-card__badge--update">{t('DockerPage.updateAvailableBadge')}</span>}
              {c.webUiUrl && (
                <a className="docker-card__weburl" href={c.webUiUrl} target="_blank" rel="noreferrer">
                  {t('DockerPage.webUi')} &#8599;
                </a>
              )}
            </div>
            <div className="docker-card__stats">
              <span>{t('DockerPage.cpuLabel')} {c.cpuLabel}</span>
              <span>{t('DockerPage.memLabel')} {c.memLabel}</span>
              <span>{c.ports}</span>
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
                {t('DockerPage.restart')}
              </button>
            </div>
            <div className="docker-card__actions">
              <button type="button" className="btn" disabled={c.isPending} onClick={c.onViewLogs}>
                {t('DockerPage.logs')}
              </button>
              <button type="button" className="btn" disabled={c.isPending} onClick={c.onEdit}>
                {t('DockerPage.edit')}
              </button>
            </div>
            {c.updateAvailable && (
              <div className="docker-card__actions">
                <button type="button" className="btn" disabled={c.isPending} onClick={c.onUpdateNow}>
                  {t('DockerPage.updateNow')}
                </button>
              </div>
            )}
            <div className="docker-card__actions">
              <button type="button" className="btn btn--danger" disabled={c.isPending} onClick={c.onDestroy}>
                {confirmingDestroy === c.id ? t('DockerPage.confirmQuestion') : t('DockerPage.destroy')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {(dialog?.mode === 'add' || dialog?.mode === 'edit') && (
        <ContainerFormDialog
          mode={dialog.mode}
          containerId={dialog.mode === 'edit' ? dialog.containerId : undefined}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}

      {dialog?.mode === 'logs' && (
        <LogsDialog containerId={dialog.containerId} containerName={dialog.containerName} onClose={() => setDialog(null)} />
      )}

      {confirmingUpdate && (
        <>
          <div className="detail-overlay" onClick={() => setConfirmingUpdate(null)} />
          <div className="dialog">
            <div className="dialog__head">
              <div className="dialog__title">{t('DockerPage.updateDialogTitle', { name: confirmingUpdate.name })}</div>
              <button type="button" className="detail-panel__close" onClick={() => setConfirmingUpdate(null)} aria-label={t('DockerPage.close')}>
                &#10005;
              </button>
            </div>
            <div className="dialog__body">
              <p className="status-note" style={{ margin: '0 0 8px' }}>
                {t('DockerPage.updateDialogDesc')}
              </p>
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={() => setConfirmingUpdate(null)}>
                  {t('DockerPage.cancel')}
                </button>
                <button type="button" className="btn btn--danger" onClick={handleConfirmUpdate}>
                  {t('DockerPage.updateNow')}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
