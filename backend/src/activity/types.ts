// Maps to the same four tokens the rest of the UI already uses for status
// dots/badges (src/styles/colors.ts's COLORS) - green/blue for routine
// completions, amber for pauses/warnings, red for deletions/failures.
export type ActivityColor = 'blue' | 'green' | 'amber' | 'red';

export interface ActivityEntry {
  id: string;
  timestamp: number; // unix ms
  text: string;
  color: ActivityColor;
}
