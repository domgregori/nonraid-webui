// Mirrors backend/src/activity/types.ts. Keep in sync.
export type ActivityColor = 'blue' | 'green' | 'amber' | 'red';

export interface ActivityEntry {
  id: string;
  timestamp: number; // unix ms
  text: string;
  color: ActivityColor;
}
