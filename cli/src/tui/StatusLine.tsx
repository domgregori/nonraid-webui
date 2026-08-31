import { Text } from 'ink';

// Shared bottom-of-screen line every screen renders: a poll error (red), an action result message
// (yellow), or a "working…" indicator while an action is in flight - same three states the
// original single-screen App.tsx had, factored out so each screen doesn't repeat the JSX.
interface Props {
  error?: string | null;
  message?: string | null;
  busy?: boolean;
}

export function StatusLine({ error, message, busy }: Props) {
  if (error) return <Text color="red">error: {error}</Text>;
  if (busy) return <Text dimColor>working…</Text>;
  if (message) return <Text color="yellow">{message}</Text>;
  return null;
}
