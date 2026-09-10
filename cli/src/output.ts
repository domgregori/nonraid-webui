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

// --- JSON output mode (global --json flag, wired up in index.ts) ---------------------------------
// Set once by index.ts's preAction hook, read by emit() below. A module-level flag rather than
// threading an option through every command's signature - the flag is process-global by nature
// (one invocation, one output format).
let jsonMode = false;

export function setJsonMode(on: boolean): void {
  jsonMode = on;
}

/**
 * Every command routes its final output through this. In normal mode it just runs `human()` (the
 * existing table/text formatting). With `--json`, it prints `data` as pretty JSON instead and
 * `human()` is never called - so the JSON is exactly the API's own response shape (or a small
 * `{ ok, message }` for action commands that don't return structured data), with no formatting
 * applied. Commands that genuinely stream raw bytes (e.g. `logs tail`) pass their structured
 * result as `data` and keep the raw write inside `human()`.
 */
export function emit(data: unknown, human: () => void): void {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    human();
  }
}

export function printError(err: unknown): void {
  if (jsonMode) {
    const status = err instanceof ApiError ? err.status : null;
    const message = err instanceof ApiError ? err.message : ((err as Error).message ?? String(err));
    console.error(JSON.stringify({ error: message, ...(status !== null ? { status } : {}) }, null, 2));
    return;
  }
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
