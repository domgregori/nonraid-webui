import { config } from '../config.js';
import type { DockerClient } from './client.js';
import { MockDockerClient } from './mockClient.js';
import { RealDockerClient } from './realClient.js';

/** No silent switch to mock data. Mock runs only when DOCKER_MODE=mock is set by hand. */
export function createDockerClient(): DockerClient {
  return config.dockerMode === 'mock' ? new MockDockerClient() : new RealDockerClient();
}

export type { DockerClient } from './client.js';
export * from './types.js';
