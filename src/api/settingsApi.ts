import { request } from './request';
import type { AppSettings, AppSettingsUpdate, CommandResult } from '../types/settingsApi';

export const settingsApi = {
  getSettings: () => request<AppSettings>('/api/settings'),
  updateSettings: (patch: AppSettingsUpdate) =>
    request<AppSettings>('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  testNotification: () => request<CommandResult>('/api/settings/notifications/test', { method: 'POST' }),
};
