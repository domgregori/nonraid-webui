import { API_BASE_URL } from './config';

/**
 * Reads a newline-delimited JSON progress stream - the protocol shared by
 * the Apps install endpoint, the Docker tab's create/recreate endpoints, and
 * the LXC tab's create endpoint (see backend/src/routes/apps.ts,
 * backend/src/routes/docker.ts, backend/src/routes/lxc.ts). A pull/download
 * can take long enough that a single blocking response reads as hung, so
 * these stream `{type:'progress',...}` ticks and finish with
 * `{type:'done', result}` or `{type:'error', message}`. Generic over the
 * progress tick shape and final result shape since Docker and LXC's create
 * flows report different fields.
 */
export async function streamNdjson<TProgress, TResult>(
  url: string,
  init: RequestInit,
  onProgress: (p: TProgress) => void,
): Promise<TResult> {
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
        | ({ type: 'progress' } & TProgress)
        | { type: 'done'; result: TResult }
        | { type: 'error'; message: string };

      if (event.type === 'progress') {
        const { type: _type, ...progress } = event;
        onProgress(progress as TProgress);
      } else if (event.type === 'done') return event.result;
      else throw new Error(event.message);
    }
  }

  throw new Error('Stream ended without a result');
}
