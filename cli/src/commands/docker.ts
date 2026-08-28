import { Command } from 'commander';
import { resolveClient } from '../context.js';
import { printTable, runAction } from '../output.js';
import type { CommandResult, DockerContainerSummary } from '../api/types.js';

export function registerDockerCommand(program: Command): void {
  const docker = program.command('docker').description('Docker container operations');

  docker
    .command('ls')
    .description('list containers')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const containers = await client.get<DockerContainerSummary[]>('/docker/containers');
        printTable(
          ['NAME', 'STATE', 'STATUS', 'IMAGE'],
          containers.map((c) => [c.name, c.state, c.status, c.image]),
        );
      }),
    );

  docker
    .command('start <name>')
    .description('start a container (by name or id)')
    .action(
      runAction(async (name: string) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>(`/docker/containers/${encodeURIComponent(name)}/start`);
        console.log(result.message);
      }),
    );

  docker
    .command('stop <name>')
    .description('stop a container (by name or id)')
    .action(
      runAction(async (name: string) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>(`/docker/containers/${encodeURIComponent(name)}/stop`);
        console.log(result.message);
      }),
    );
}
