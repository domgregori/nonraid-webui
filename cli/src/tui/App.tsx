import { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { ApiClient } from '../api/client.js';
import { ArrayScreen } from './screens/ArrayScreen.js';
import { CacheScreen } from './screens/CacheScreen.js';
import { DisksScreen } from './screens/DisksScreen.js';
import { DockerScreen } from './screens/DockerScreen.js';
import { LxcScreen } from './screens/LxcScreen.js';
import { RcloneScreen } from './screens/RcloneScreen.js';
import { SharesScreen } from './screens/SharesScreen.js';
import { SystemScreen } from './screens/SystemScreen.js';
import { UsersScreen } from './screens/UsersScreen.js';

interface Props {
  client: ApiClient;
  host: string;
}

// One tab per resource area the plain CLI already covers - each screen owns its own polling/
// selection/action-key handling (see the shared usePolling/useListNav hooks), the shell here is
// just the header/tab bar and which one is currently mounted. Digits 1-9 jump directly to a tab;
// no screen's own action keys use a digit, so there's no conflict switching mid-list-selection.
const TABS = [
  { key: '1', label: 'Array', Screen: ArrayScreen },
  { key: '2', label: 'Disks', Screen: DisksScreen },
  { key: '3', label: 'Docker', Screen: DockerScreen },
  { key: '4', label: 'LXC', Screen: LxcScreen },
  { key: '5', label: 'Shares', Screen: SharesScreen },
  { key: '6', label: 'Users', Screen: UsersScreen },
  { key: '7', label: 'System', Screen: SystemScreen },
  { key: '8', label: 'Cache', Screen: CacheScreen },
  { key: '9', label: 'Rclone', Screen: RcloneScreen },
] as const;

export function App({ client, host }: Props) {
  const { exit } = useApp();
  const [activeIndex, setActiveIndex] = useState(0);

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
      return;
    }
    if (key.tab) {
      setActiveIndex((i) => (key.shift ? (i - 1 + TABS.length) % TABS.length : (i + 1) % TABS.length));
      return;
    }
    const jump = TABS.findIndex((t) => t.key === input);
    if (jump !== -1) setActiveIndex(jump);
  });

  const Active = TABS[activeIndex]!.Screen;

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderColor="cyan" flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color="cyan">
            nonraid-tool — {host}
          </Text>
          <Text dimColor>1-9 / Tab switch · q quit</Text>
        </Box>
        <Box>
          {TABS.map((t, i) =>
            i === activeIndex ? (
              <Text key={t.key} bold color="black" backgroundColor="cyan">
                {' '}
                {t.key}:{t.label}{' '}
              </Text>
            ) : (
              <Text key={t.key} dimColor>
                {' '}
                {t.key}:{t.label}{' '}
              </Text>
            ),
          )}
        </Box>
      </Box>
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Active client={client} />
      </Box>
    </Box>
  );
}
