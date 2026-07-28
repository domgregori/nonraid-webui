import { config } from '../config.js';
import type { UsersClient } from './client.js';
import { MockUsersClient } from './mockClient.js';
import { RealUsersClient } from './realClient.js';

/** No silent switch to mock data. Mock runs only when USERS_MODE=mock is set by hand. */
export function createUsersClient(): UsersClient {
  return config.usersMode === 'mock' ? new MockUsersClient() : new RealUsersClient();
}

export type { UsersClient } from './client.js';
export { UsersService } from './service.js';
export type { ShareAccessEntry } from './service.js';
export * from './types.js';
