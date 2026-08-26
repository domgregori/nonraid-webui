import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { PullLogLine } from '../../hooks/useInstallProgress';
import type { CreateContainerProgress } from '../../types/dockerApi';

interface InstallProgressProps {
  progress: CreateContainerProgress | null;
  log: PullLogLine[];
  logRef: RefObject<HTMLDivElement | null>;
}

export function InstallProgress({ progress, log, logRef }: InstallProgressProps) {
  const { t } = useTranslation('docker');
  return (
    <div className="apps-install-progress">
      <div className="apps-install-progress__status">{progress?.message ?? t('InstallProgress.starting')}</div>
      <div className="apps-install-progress__bar">
        <div
          className={`apps-install-progress__bar-fill${progress?.percent == null ? ' apps-install-progress__bar-fill--indeterminate' : ''}`}
          style={progress?.percent != null ? { width: `${progress.percent}%` } : undefined}
        />
      </div>
      {log.length > 0 && (
        <div className="apps-install-progress__log" ref={logRef}>
          {log.map((line) => (
            <div className="apps-install-progress__log-line" key={line.id}>
              <span className="apps-install-progress__log-id">{line.id.slice(0, 12)}</span>
              <span className="apps-install-progress__log-status">{line.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
