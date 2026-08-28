import { Command } from 'commander';
import { resolveClient } from '../context.js';
import { printTable, runAction } from '../output.js';
import type { ActivityEntry, LogQueryResult, LogSourceRow, MetricSeries } from '../api/types.js';

export function registerActivityCommand(program: Command): void {
  program
    .command('activity')
    .description('show the in-app activity feed')
    .option('-n, --limit <n>', 'max entries to show')
    .action(
      runAction(async (opts: { limit?: string }) => {
        const client = await resolveClient();
        const query = opts.limit ? `?limit=${encodeURIComponent(opts.limit)}` : '';
        const entries = await client.get<ActivityEntry[]>(`/activity${query}`);
        printTable(
          ['TIME', 'TEXT'],
          entries.map((e) => [new Date(e.timestamp).toISOString(), e.text]),
        );
      }),
    );
}

export function registerLogsCommand(program: Command): void {
  const logs = program.command('logs').description('tail system log sources (journalctl-backed)');

  logs
    .command('sources')
    .description('list available log source ids')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const sources = await client.get<LogSourceRow[]>('/logs/sources');
        printTable(
          ['ID', 'LABEL'],
          sources.map((s) => [s.id, s.label]),
        );
      }),
    );

  logs
    .command('tail <sourceId>')
    .description('tail a log source')
    .option('--lines <n>', 'number of lines from the end')
    .option('--window <window>', 'time window, e.g. 1h/24h/7d (ignored if --since given)')
    .option('--since <cursor>', 'cursor from a previous response, to fetch what followed it')
    .action(
      runAction(async (sourceId: string, opts: { lines?: string; window?: string; since?: string }) => {
        const client = await resolveClient();
        const params = new URLSearchParams();
        if (opts.lines) params.set('tail', opts.lines);
        if (opts.since) params.set('since', opts.since);
        else if (opts.window) params.set('window', opts.window);
        const qs = params.toString();
        const result = await client.get<LogQueryResult>(`/logs/${encodeURIComponent(sourceId)}${qs ? `?${qs}` : ''}`);
        process.stdout.write(result.logs);
        if (!result.logs.endsWith('\n')) process.stdout.write('\n');
      }),
    );
}

export function registerMetricsCommand(program: Command): void {
  program
    .command('metrics <metrics>')
    .description('historical time-series metrics, comma-separated (e.g. cpu_percent,mem_used_bytes)')
    .option('--range <range>', '1h | 24h | 7d | 30d', '24h')
    .action(
      runAction(async (metrics: string, opts: { range: string }) => {
        const client = await resolveClient();
        const { series } = await client.get<{ series: MetricSeries[] }>(`/metrics?metrics=${encodeURIComponent(metrics)}&range=${encodeURIComponent(opts.range)}`);
        for (const s of series) {
          console.log(`${s.metric} [${s.key}] - ${s.points.length} point(s)`);
          const last = s.points[s.points.length - 1];
          if (last) console.log(`  latest: ${new Date(last.ts).toISOString()} = ${last.value}`);
        }
      }),
    );
}
