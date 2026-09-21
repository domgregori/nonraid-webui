import type { CloudflaredStatus } from './types.js';

export interface CloudflaredClient {
  getStatus(): Promise<CloudflaredStatus>;
}
