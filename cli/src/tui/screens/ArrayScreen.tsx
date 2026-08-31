import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ApiClient } from '../../api/client.js';
import type { CommandResult, NmdStatusResponse } from '../../api/types.js';
import { formatPercent } from '../format.js';
import { StatusLine } from '../StatusLine.js';
import { usePolling } from '../usePolling.js';

interface Props {
  client: ApiClient;
}

// Array start/stop is deliberately not an action here - too large a blast radius (unmounts every
// share) for a single keypress on a status screen; `nonraid-tool array start/stop` covers it.
// Starting a parity check is the one action this screen offers, matching the web Dashboard's own
// pairing of array health with parity status.
export function ArrayScreen({ client }: Props) {
  const { data, error, refresh } = usePolling(() => client.get<NmdStatusResponse>('/status'));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const startParity = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await client.post<CommandResult>('/parity/CORRECT');
      setMessage(result.message);
      await refresh();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useInput((input) => {
    if (input === 'r') void refresh();
    if (input === 's' && !busy && data && !data.resync.active) void startParity();
  });

  const array = data?.array;
  const resync = data?.resync;

  return (
    <Box flexDirection="column">
      <Text underline>Array — r refresh{resync && !resync.active ? ', s start parity check' : ''}</Text>
      {array && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            State: <Text bold>{array.state}</Text> · {array.disks_imported}/{array.total_slots} disks imported
          </Text>
          <Text dimColor>
            missing {array.health.missing} · disabled {array.health.disabled} · replaced {array.health.replaced} · new {array.health.new} · sync errors{' '}
            {array.health.sync_errors} · disk errors {array.health.disk_errors}
          </Text>
        </Box>
      )}
      {resync && (
        <Box marginTop={1}>
          <Text>
            Parity:{' '}
            {resync.active ? (
              <Text color="cyan">
                {resync.action} {formatPercent(resync.progress_percent)} ({resync.rate_mb_s.toFixed(0)} MB/s, ETA{' '}
                {Math.round(resync.eta_seconds / 60)}m)
              </Text>
            ) : (
              <Text dimColor>idle{resync.pending ? ' (pending)' : ''}</Text>
            )}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <StatusLine error={error} message={message} busy={busy} />
      </Box>
    </Box>
  );
}
