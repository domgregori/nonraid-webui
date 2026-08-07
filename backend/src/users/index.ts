import type { UsersClient } from './client.js';
import { RealUsersClient } from './realClient.js';

export function createUsersClient(): UsersClient {
  return new RealUsersClient();
}

export type { UsersClient } from './client.js';
export { UsersService } from './service.js';
export type { ShareAccessEntry } from './service.js';
export * from './types.js';
