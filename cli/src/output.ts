import chalk from 'chalk';
import { ApiError } from './api/client.js';

// Deliberately no table-drawing dependency - this is a handful of narrow columns for a curated
// command set, not a general data-grid. Pads with plain spaces; degrades fine when piped (no box
// characters to break `| grep`/`| awk` usage).
export function printTable(columns: string[], rows: string[][]): void {
  const widths = columns.map((col, i) => Math.max(col.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ');
  console.log(chalk.bold(line(columns)));
  for (const row of rows) console.log(line(row));
}

export function printError(err: unknown): void {
  if (err instanceof ApiError) {
    console.error(chalk.red(`Error (${err.status}): ${err.message}`));
  } else {
    console.error(chalk.red(`Error: ${(err as Error).message ?? String(err)}`));
  }
}

// Every command's action wraps its body in this - keeps exit-code/error-formatting logic in one
// place instead of a try/catch repeated at every call site. Generic over the action's own
// arguments so it works both for commander's zero-arg handlers and ones that receive
// positional/option args (e.g. `disk spin-down <slot>`, `login --host ...`).
export function runAction<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => void {
  return (...args: A) => {
    fn(...args).catch((err: unknown) => {
      printError(err);
      process.exitCode = 1;
    });
  };
}
