// Copied directly from src/api/progressStream.ts (~50 lines, no deps) rather than pulled from a
// shared package for one file - see the plan's own reasoning for this. Only real change: no
// API_BASE_URL constant - this app is always same-origin with share-server in production (it's
// the process that serves this bundle), and the dev server proxies /api/* to it directly (see
// vite.config.ts), so a plain relative `url` is correct in both cases.

/**
 * Reads a newline-delimited JSON progress stream - the protocol this app's upload endpoint uses
 * (see backend API.md's "Share Links" section / share-server's POST /api/shares/:token/upload).
 * Streams `{type:'progress',...}` ticks and finishes with `{type:'done', result}` or
 * `{type:'error', message}`.
 */
export async function streamNdjson<TProgress, TResult>(url: string, init: RequestInit, onProgress: (p: TProgress) => void): Promise<TResult> {
  const res = await fetch(url, init);
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

      const event = JSON.parse(line) as ({ type: 'progress' } & TProgress) | { type: 'done'; result: TResult } | { type: 'error'; message: string };

      if (event.type === 'progress') {
        const { type: _type, ...progress } = event;
        onProgress(progress as TProgress);
      } else if (event.type === 'done') return event.result;
      else throw new Error(event.message);
    }
  }

  throw new Error('Stream ended without a result');
}
