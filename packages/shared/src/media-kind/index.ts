import path from 'node:path';

export type MediaKind = 'image' | 'video' | 'audio' | 'pdf';

/**
 * A deliberate allowlist, not "whatever the OS mime database says" - this drives an *inline*
 * response (no Content-Disposition: attachment, meant to be embedded in an <img>/<video>/<audio>/
 * <iframe> in the same origin as the app itself). Extension-based Content-Type detection (what
 * Express's own `send`/`res.sendFile` does by default) is fine for genuinely inert media, but
 * would be a real same-origin XSS vector for anything HTML-adjacent - an uploaded `evil.svg`
 * (SVG can carry <script>, and directly navigating/framing one executes it, even though an <img>
 * tag alone happens not to) or `evil.html` would otherwise get served with a Content-Type that
 * makes it interpretable as a live web page. Deliberately no `.svg`, `.html`, `.htm`, `.xhtml`,
 * `.xml`, or anything else a browser might execute - if it's not in this table, the caller should
 * refuse to serve it inline at all (force a download instead), not fall back to guessing.
 *
 * Shared by both the admin Browse viewer (`backend/src/routes/browse.ts`) and the public share
 * viewer (`share-server/src/routes/shares.ts`) so the two never drift into allowing different
 * things inline - one table, one security decision, reused everywhere this matters.
 */
const EXTENSION_MAP: Record<string, { kind: MediaKind; contentType: string }> = {
  // Images
  '.jpg': { kind: 'image', contentType: 'image/jpeg' },
  '.jpeg': { kind: 'image', contentType: 'image/jpeg' },
  '.png': { kind: 'image', contentType: 'image/png' },
  '.gif': { kind: 'image', contentType: 'image/gif' },
  '.webp': { kind: 'image', contentType: 'image/webp' },
  '.avif': { kind: 'image', contentType: 'image/avif' },
  '.bmp': { kind: 'image', contentType: 'image/bmp' },
  '.ico': { kind: 'image', contentType: 'image/x-icon' },
  // Video
  '.mp4': { kind: 'video', contentType: 'video/mp4' },
  '.m4v': { kind: 'video', contentType: 'video/mp4' },
  '.webm': { kind: 'video', contentType: 'video/webm' },
  '.ogv': { kind: 'video', contentType: 'video/ogg' },
  '.mov': { kind: 'video', contentType: 'video/quicktime' },
  // Audio
  '.mp3': { kind: 'audio', contentType: 'audio/mpeg' },
  '.wav': { kind: 'audio', contentType: 'audio/wav' },
  '.oga': { kind: 'audio', contentType: 'audio/ogg' },
  '.m4a': { kind: 'audio', contentType: 'audio/mp4' },
  '.flac': { kind: 'audio', contentType: 'audio/flac' },
  // Documents
  '.pdf': { kind: 'pdf', contentType: 'application/pdf' },
};

/** null means "not something this app will ever serve inline" - the caller's job to fall back to
 *  a plain attachment download, never to guess a Content-Type of its own for the rejected case. */
export function resolveInlineMedia(fileName: string): { kind: MediaKind; contentType: string } | null {
  const ext = path.extname(fileName).toLowerCase();
  return EXTENSION_MAP[ext] ?? null;
}
