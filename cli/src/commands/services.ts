import { Command } from 'commander';
import { resolveClient } from '../context.js';
import { printTable, runAction } from '../output.js';
import type { CommandResult, ServiceRow } from '../api/types.js';

export function registerServiceCommand(program: Command): void {
  const service = program.command('service').description('managed systemd services');

  service
    .command('ls')
    .description('list services and their state')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const rows = await client.get<ServiceRow[]>('/services');
        printTable(
          ['ID', 'LABEL', 'STATE'],
          rows.map((r) => [r.id, r.label, r.state]),
        );
      }),
    );

  service
    .command('start <id>')
    .description('start a service')
    .action(
      runAction(async (id: string) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>(`/services/${encodeURIComponent(id)}/start`);
        console.log(result.message);
      }),
    );

  service
    .command('stop <id>')
    .description('stop a service')
    .action(
      runAction(async (id: string) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>(`/services/${encodeURIComponent(id)}/stop`);
        console.log(result.message);
      }),
    );

  service
    .command('restart <id>')
    .description("restart a service (id 'webui' self-restarts nonraid-webui)")
    .action(
      runAction(async (id: string) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>(`/services/${encodeURIComponent(id)}/restart`);
        console.log(result.message);
      }),
    );
}
