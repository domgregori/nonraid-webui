import { Command } from 'commander';
import { resolveClient } from '../context.js';
import { printTable, runAction } from '../output.js';
import type { NrGroup, NrUser, ShareAccessEntry, SharePermission } from '../api/types.js';

function splitList(v?: string): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function registerUserCommand(program: Command): void {
  const user = program.command('user').description('managed local users (uid >= 20000)');

  user
    .command('ls')
    .description('list users')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const users = await client.get<NrUser[]>('/users');
        printTable(
          ['USERNAME', 'UID', 'GROUPS'],
          users.map((u) => [u.username, String(u.uid), u.groups.join(',') || '-']),
        );
      }),
    );

  user
    .command('add <username>')
    .description('create a user')
    .requiredOption('--password <password>', 'initial password')
    .option('--groups <groups>', 'comma-separated secondary group names', '')
    .action(
      runAction(async (username: string, opts: { password: string; groups?: string }) => {
        const client = await resolveClient();
        await client.post<NrUser>('/users', { username, password: opts.password, groups: splitList(opts.groups) });
        console.log(`User "${username}" created.`);
      }),
    );

  user
    .command('set <username>')
    .description('update a user - password and/or groups (omit a flag to leave it unchanged)')
    .option('--password <password>', 'new password')
    .option('--groups <groups>', 'comma-separated secondary group names (replaces the full list)')
    .action(
      runAction(async (username: string, opts: { password?: string; groups?: string }) => {
        const client = await resolveClient();
        const body: { password?: string; groups?: string[] } = {};
        if (opts.password !== undefined) body.password = opts.password;
        if (opts.groups !== undefined) body.groups = splitList(opts.groups);
        await client.put<NrUser>(`/users/${encodeURIComponent(username)}`, body);
        console.log(`User "${username}" updated.`);
      }),
    );

  user
    .command('rm <username>')
    .description('delete a user (also purges it from every share access list)')
    .action(
      runAction(async (username: string) => {
        const client = await resolveClient();
        await client.delete(`/users/${encodeURIComponent(username)}`);
        console.log(`User "${username}" deleted.`);
      }),
    );

  user
    .command('access <username>')
    .description('show per-share access for a user')
    .action(
      runAction(async (username: string) => {
        const client = await resolveClient();
        const rows = await client.get<ShareAccessEntry[]>(`/users/${encodeURIComponent(username)}/access`);
        printTable(
          ['SHARE', 'PERMISSION'],
          rows.map((r) => [r.shareName, r.permission]),
        );
      }),
    );

  user
    .command('grant <username> <shareName> <permission>')
    .description('set a user\'s access on a share: read-write | read-only | none | hidden')
    .action(
      runAction(async (username: string, shareName: string, permission: string) => {
        const client = await resolveClient();
        await client.put(`/users/${encodeURIComponent(username)}/access/${encodeURIComponent(shareName)}`, {
          permission: permission as SharePermission,
        });
        console.log(`"${username}" set to "${permission}" on share "${shareName}".`);
      }),
    );
}

export function registerGroupCommand(program: Command): void {
  const group = program.command('group').description('managed local groups (gid >= 20000)');

  group
    .command('ls')
    .description('list groups')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const groups = await client.get<NrGroup[]>('/groups');
        printTable(
          ['NAME', 'GID'],
          groups.map((g) => [g.name, String(g.gid)]),
        );
      }),
    );

  group
    .command('add <name>')
    .description('create a group')
    .action(
      runAction(async (name: string) => {
        const client = await resolveClient();
        await client.post<NrGroup>('/groups', { name });
        console.log(`Group "${name}" created.`);
      }),
    );

  group
    .command('rm <name>')
    .description('delete a group (also purges it from every share access list)')
    .action(
      runAction(async (name: string) => {
        const client = await resolveClient();
        await client.delete(`/groups/${encodeURIComponent(name)}`);
        console.log(`Group "${name}" deleted.`);
      }),
    );

  group
    .command('access <name>')
    .description('show per-share access for a group')
    .action(
      runAction(async (name: string) => {
        const client = await resolveClient();
        const rows = await client.get<ShareAccessEntry[]>(`/groups/${encodeURIComponent(name)}/access`);
        printTable(
          ['SHARE', 'PERMISSION'],
          rows.map((r) => [r.shareName, r.permission]),
        );
      }),
    );

  group
    .command('grant <name> <shareName> <permission>')
    .description('set a group\'s access on a share: read-write | read-only | none | hidden')
    .action(
      runAction(async (name: string, shareName: string, permission: string) => {
        const client = await resolveClient();
        await client.put(`/groups/${encodeURIComponent(name)}/access/${encodeURIComponent(shareName)}`, {
          permission: permission as SharePermission,
        });
        console.log(`"${name}" set to "${permission}" on share "${shareName}".`);
      }),
    );
}
