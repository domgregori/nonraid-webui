import { render } from 'ink';
import { resolveClient } from '../context.js';
import { loadConfig } from '../config.js';
import { App } from './App.js';

// Kept in its own module, imported dynamically by commands/tui.ts rather than at the top of
// index.ts - pulling in react/ink has a real (if small) startup cost that every plain, scriptable
// CLI invocation would otherwise pay even when nowhere near the `tui` subcommand.
export async function runTui(): Promise<void> {
  const client = await resolveClient();
  const config = await loadConfig();
  const { waitUntilExit } = render(<App client={client} host={config?.host ?? ''} />);
  await waitUntilExit();
}
