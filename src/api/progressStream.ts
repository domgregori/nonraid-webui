import { API_BASE_URL } from './config';
import type { CreateContainerProgress, DockerCommandResult } from '../types/dockerApi';

/**
 * Reads a newline-delimited JSON progress stream — the protocol shared by
 * the Apps install endpoint and the Docker tab's create/recreate endpoints
 * (see backend/src/routes/apps.ts and backend/src/routes/docker.ts). A
 * plain image pull can take long enough that a single blocking response
 * reads as hung, so these stream `{type:'progress',...}` ticks and finish
 * with `{type:'done', result}` or `{type:'error', message}`.
 */
export async function streamNdjson(
  url: string,
  init: RequestInit,
  onProgress: (p: CreateContainerProgress) => void,
): Promise<DockerCommandResult> {
  const res = await fetch(`${API_BASE_URL}${url}`, init);
  if (!res.body) throw new Error(`Request failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      const event = JSON.parse(line) as
        | ({ type: 'progress' } & CreateContainerProgress)
        | { type: 'done'; result: DockerCommandResult }
        | { type: 'error'; message: string };

      if (event.type === 'progress') {
        const { type: _type, ...progress } = event;
        onProgress(progress);
      } else if (event.type === 'done') return event.result;
      else throw new Error(event.message);
    }
  }

  throw new Error('Stream ended without a result');
}
