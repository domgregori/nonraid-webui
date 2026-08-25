// import.meta.env.PROD is Vite's own build-mode flag (true for `vite build`,
// false for the dev server) - no env var needed to get this right. A
// production build defaults to same-origin relative fetches, since the
// backend serves the built frontend from its own origin in that deployment
// shape (see tools/systemd/nonraid-webui.service). VITE_API_BASE_URL still
// overrides either default if ever needed.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? '' : 'http://localhost');
