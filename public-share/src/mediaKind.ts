export type MediaKind = 'image' | 'video' | 'audio' | 'pdf';

// Client-side mirror of @nonraid/shared/media-kind's own extension table, kept deliberately
// separate rather than importing that package here - it's written against node:path and this is
// a browser bundle, and the real security decision (what Content-Type gets served, refusing
// HTML-adjacent formats) already lives authoritatively on the server in that shared module. This
// version only decides which button/viewer to show; the server independently re-checks every
// request against its own allowlist regardless of what this guesses.
const EXTENSION_KIND: Record<string, MediaKind> = {
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.avif': 'image',
  '.bmp': 'image',
  '.ico': 'image',
  '.mp4': 'video',
  '.m4v': 'video',
  '.webm': 'video',
  '.ogv': 'video',
  '.mov': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.oga': 'audio',
  '.m4a': 'audio',
  '.flac': 'audio',
  '.pdf': 'pdf',
};

export function mediaKind(fileName: string): MediaKind | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  return EXTENSION_KIND[fileName.slice(dot).toLowerCase()] ?? null;
}
