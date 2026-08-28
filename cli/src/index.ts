#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { registerArrayCommand, registerDiskCommand, registerParityCommand } from './commands/array.js';
import { registerDockerCommand } from './commands/docker.js';
import { registerLxcCommand } from './commands/lxc.js';
import { registerTuiCommand } from './commands/tui.js';
import { registerShareCommand } from './commands/shares.js';
import { registerUserCommand, registerGroupCommand } from './commands/users.js';
import { registerSystemCommand } from './commands/system.js';
import { registerServiceCommand } from './commands/services.js';
import { registerSmartCommand } from './commands/smart.js';
import { registerActivityCommand, registerLogsCommand, registerMetricsCommand } from './commands/activity.js';
import { registerCacheCommand } from './commands/cache.js';
import { registerRcloneCommand } from './commands/rclone.js';
import { runAction } from './output.js';

// Read the version from package.json rather than hardcoding it a second time here - this file
// works the same way whether run compiled (dist/index.js) or straight from source via tsx
// (src/index.ts), since package.json is one directory up from both.
const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

const program = new Command();

program.name('nonraid-tool').description("Command-line client for nonraid-webui's REST API.").version(pkg.version);

// A `version` subcommand alongside the standard -V/--version flag - some scripts/muscle memory
// reach for one or the other. Same output as --version, not a separate "richer" report.
program
  .command('version')
  .description('print the CLI version')
  .action(() => console.log(pkg.version));

program
  .command('login')
  .description('log in with username/password and mint a local API token')
  .option('--host <url>', 'backend URL, e.g. http://nonraid.lan')
  .option('--insecure', 'skip TLS certificate verification (self-signed cert)')
  .action(runAction(loginCommand));

program
  .command('logout')
  .description('forget the locally saved token')
  .option('--revoke', 're-authenticate and revoke the token server-side too')
  .action(runAction(logoutCommand));

registerArrayCommand(program);
registerDiskCommand(program);
registerParityCommand(program);
registerDockerCommand(program);
registerLxcCommand(program);
registerShareCommand(program);
registerUserCommand(program);
registerGroupCommand(program);
registerSystemCommand(program);
registerServiceCommand(program);
registerSmartCommand(program);
registerActivityCommand(program);
registerLogsCommand(program);
registerMetricsCommand(program);
registerCacheCommand(program);
registerRcloneCommand(program);
registerTuiCommand(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error((err as Error).message ?? err);
  process.exitCode = 1;
});
