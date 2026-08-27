import { request } from './request';
import type { ApplyResult, ChangelogResult, UpdateComponent, UpdateStatus } from '../types/updateApi';

export const updateApi = {
  /** Cheap, never touches the network - whatever the last check found. Safe to call on every
   *  Settings load. */
  getStatus: () => request<UpdateStatus>('/api/update/status'),
  /** The only call that actually hits GitHub - "Check for updates" button. */
  checkNow: () => request<UpdateStatus>('/api/update/check', { method: 'POST' }),
  /** On demand only (the "Changelog" link) - not part of the polled status check. */
  getChangelog: (component: UpdateComponent, tag: string) =>
    request<ChangelogResult>(`/api/update/changelog?component=${component}&tag=${encodeURIComponent(tag)}`),
  /** "Update Now" - see backend/src/update/apply.ts for exactly what each component runs. */
  applyUpdate: (component: UpdateComponent) =>
    request<ApplyResult>('/api/update/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ component }),
    }),
};
