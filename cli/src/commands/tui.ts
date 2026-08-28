import { Command } from 'commander';

export function registerTuiCommand(program: Command): void {
  program
    .command('tui')
    .description('launch the interactive dashboard instead of the plain CLI')
    .action(async () => {
      const { runTui } = await import('../tui/run.js');
      await runTui();
    });
}
