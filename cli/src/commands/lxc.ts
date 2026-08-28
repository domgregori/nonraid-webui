import { Command } from 'commander';
import { resolveClient } from '../context.js';
import { printTable, runAction } from '../output.js';
import type { CommandResult, LxcContainerSummary } from '../api/types.js';

export function registerLxcCommand(program: Command): void {
  const lxc = program.command('lxc').description('LXC container operations');

  lxc
    .command('ls')
    .description('list containers')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const containers = await client.get<LxcContainerSummary[]>('/lxc/containers');
        printTable(
          ['NAME', 'STATE', 'AUTOSTART', 'IPS'],
          containers.map((c) => [c.name, c.state, c.autostart ? 'yes' : 'no', c.ips.join(', ') || '-']),
        );
      }),
    );

  lxc
    .command('start <name>')
    .description('start a container')
    .action(
      runAction(async (name: string) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>(`/lxc/containers/${encodeURIComponent(name)}/start`);
        console.log(result.message);
      }),
    );

  lxc
    .command('stop <name>')
    .description('stop a container')
    .option('-f, --force', 'kill instead of a graceful shutdown')
    .action(
      runAction(async (name: string, opts: { force?: boolean }) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>(`/lxc/containers/${encodeURIComponent(name)}/stop`, { force: !!opts.force });
        console.log(result.message);
      }),
    );
}
