import { Command } from 'commander';
import prompts from 'prompts';
import { passwordLogin, stepUpFetch } from '../api/sessionAuth.js';
import { loadConfig } from '../config.js';
import { resolveClient } from '../context.js';
import { printTable, runAction } from '../output.js';
import type { CommandResult, FormatAsLuksResult, LuksStatusResponse } from '../api/types.js';

const onCancel = () => {
  console.error('Aborted.');
  process.exit(130);
};

async function resolveHost(): Promise<string> {
  const host = process.env.NONRAID_HOST ?? (await loadConfig())?.host;
  if (!host) {
    console.error('Not logged in. Run `nonraid-tool login` first (or set NONRAID_HOST).');
    process.exit(1);
  }
  return host;
}

export function registerLuksCommand(program: Command): void {
  const luks = program.command('luks').description('LUKS disk encryption');

  luks
    .command('status')
    .description('show per-disk encryption state and the current unlock mode')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const { unlockMode, keyfileExists, disks } = await client.get<LuksStatusResponse>('/luks/status');
        console.log(`Unlock mode: ${unlockMode}  Keyfile present: ${keyfileExists ? 'yes' : 'no'}`);
        printTable(
          ['SLOT', 'ENCRYPTION', 'DEVICE'],
          disks.map((d) => [String(d.slot), d.encryption, d.device]),
        );
      }),
    );

  luks
    .command('lock <slot>')
    .description('lock an unlocked LUKS data disk')
    .action(
      runAction(async (slot: string) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>(`/luks/${slot}/lock`);
        console.log(result.message);
      }),
    );

  luks
    .command('unlock <slot>')
    .description('unlock a locked LUKS data disk (prompts for the passphrase interactively - never accepted as a flag)')
    .action(
      runAction(async (slot: string) => {
        const { passphrase } = await prompts({ type: 'password', name: 'passphrase', message: 'Passphrase' }, { onCancel });
        if (!passphrase) throw new Error('A passphrase is required.');
        const client = await resolveClient();
        const result = await client.post<CommandResult>(`/luks/${slot}/unlock`, { passphrase });
        console.log(result.message);
      }),
    );

  luks
    .command('format <slot>')
    .description('format a blank data disk as LUKS-encrypted XFS - destroys any existing data on it')
    .action(
      runAction(async (slot: string) => {
        const { passphrase, confirmPassphrase } = await prompts(
          [
            { type: 'password', name: 'passphrase', message: 'New passphrase for this disk' },
            { type: 'password', name: 'confirmPassphrase', message: 'Confirm passphrase' },
          ],
          { onCancel },
        );
        if (!passphrase) throw new Error('A passphrase is required.');
        if (passphrase !== confirmPassphrase) throw new Error('Passphrases did not match.');

        // Step-up gated server-side (see routes/luks.ts) - this needs a real session cookie, not
        // this CLI's usual Bearer token (requireStepUp re-verifies the account password+2FA
        // against a live session; see auth/service.ts's requireSession). Same reasoning
        // `logout --revoke` re-authenticates with passwordLogin() rather than reusing the saved
        // token for its own step-up-gated call.
        const host = await resolveHost();
        console.log('This mints a new LUKS passphrase and is step-up gated - confirm your admin account:');
        const { cookie, password } = await passwordLogin(host);
        const result = (await stepUpFetch(host, `/api/disks/${slot}/format-luks`, 'POST', cookie, password, { passphrase })) as FormatAsLuksResult;

        console.log(result.message);
        console.log('');
        console.log('Write this recovery passphrase down now - it will not be shown again:');
        console.log(`  ${result.recoveryPassphrase}`);
      }),
    );
}
