import type { DockerClient } from './client.js';
import { RealDockerClient } from './realClient.js';

export function createDockerClient(): DockerClient {
  return new RealDockerClient();
}

export type { DockerClient } from './client.js';
export * from './types.js';
