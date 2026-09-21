import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Separate, minimal build from the main admin SPA (src/, the ~880KB app) - a deliberate, small
// public-facing surface with no admin routes/secrets to audit, per the plan's own reasoning
// (README.md's "Project layout" documents this split). Dev proxy targets share-server directly
// (its own port, not the admin backend's).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8877',
    },
  },
});
