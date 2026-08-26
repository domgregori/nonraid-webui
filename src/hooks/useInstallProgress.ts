import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import type { CreateContainerProgress } from '../types/dockerApi';

export interface PullLogLine {
  id: string;
  status: string;
}

/**
 * Shared install/recreate progress state for the Apps install dialog and the
 * Docker tab's Add/Edit Container dialog - both stream the same
 * `CreateContainerProgress` protocol (see api/progressStream.ts). One
 * persistent line per image layer, updated in place as its status changes
 * (mirrors `docker pull`'s own multi-layer rendering), rather than a
 * scrolling firehose of every single tick - a real pull can emit well over a
 * hundred of those for one small image.
 */
export function useInstallProgress() {
  const [progress, setProgress] = useState<CreateContainerProgress | null>(null);
  const [log, setLog] = useState<PullLogLine[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const reset = () => {
    setProgress(null);
    setLog([]);
  };

  const onProgress = (p: CreateContainerProgress) => {
    setProgress(p);
    if (!p.layerId) return;
    const status = p.layerStatus ?? p.message;
    const layerId = p.layerId;
    setLog((prev) => {
      const idx = prev.findIndex((line) => line.id === layerId);
      if (idx === -1) return [...prev, { id: layerId, status }];
      if (prev[idx].status === status) return prev;
      const next = [...prev];
      next[idx] = { id: layerId, status };
      return next;
    });
  };

  return { progress, log, logRef, onProgress, reset };
}

/** Label for the disabled primary button while `stage === 'installing'`. Called from both the
 *  Docker and Apps install dialogs, each bound to their own namespace's `t` - the `common:` prefix
 *  resolves this against the shared `common` namespace regardless of which namespace `t` defaults to. */
export function installButtonLabel(t: TFunction, progress: CreateContainerProgress | null): string {
  if (progress?.phase === 'removing') return t('common:installButtonLabel.removing');
  return progress?.percent != null ? t('common:installButtonLabel.installingPercent', { percent: progress.percent }) : t('common:installButtonLabel.installing');
}
