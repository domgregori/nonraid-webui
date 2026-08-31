import { useState } from 'react';
import { useInput } from 'ink';

// Up/down selection over a list of `length` items, as its own hook (calls useInput internally)
// so a screen only wires its own action key(s) - matching the original App.tsx's selection
// pattern, factored out for reuse across every list-based screen.
export function useListNav(length: number): [number, (i: number) => void] {
  const [selected, setSelected] = useState(0);
  useInput((_input, key) => {
    if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelected((i) => Math.min(Math.max(length - 1, 0), i + 1));
  });
  return [Math.min(selected, Math.max(length - 1, 0)), setSelected];
}
