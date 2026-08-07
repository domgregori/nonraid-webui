import type {
  ContainerDetail,
  CreateContainerOptions,
  CreateContainerProgressCallback,
  DockerCommandResult,
  DockerContainerSummary,
} from './types.js';

export interface DockerClient {
  listContainers(): Promise<DockerContainerSummary[]>;
  inspectContainer(id: string): Promise<ContainerDetail>;
  startContainer(id: string): Promise<DockerCommandResult>;
  stopContainer(id: string): Promise<DockerCommandResult>;
  restartContainer(id: string): Promise<DockerCommandResult>;
  removeContainer(id: string, options?: { force?: boolean }): Promise<DockerCommandResult>;
  createContainer(options: CreateContainerOptions, onProgress?: CreateContainerProgressCallback): Promise<DockerCommandResult>;
  getContainerLogs(id: string, tail?: number): Promise<string>;
}
