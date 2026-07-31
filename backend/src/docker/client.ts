import type {
  CreateContainerOptions,
  CreateContainerProgressCallback,
  DockerCommandResult,
  DockerContainerSummary,
} from './types.js';

export interface DockerClient {
  readonly mode: 'real' | 'mock';
  listContainers(): Promise<DockerContainerSummary[]>;
  startContainer(id: string): Promise<DockerCommandResult>;
  stopContainer(id: string): Promise<DockerCommandResult>;
  restartContainer(id: string): Promise<DockerCommandResult>;
  createContainer(options: CreateContainerOptions, onProgress?: CreateContainerProgressCallback): Promise<DockerCommandResult>;
}
