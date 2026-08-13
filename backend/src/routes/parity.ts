import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import type { NmdClient } from '../nmd/index.js';
import type { ParityCheckAction } from '../nmd/types.js';
import { notifyEvent } from '../settings/notify.js';
import type { SettingsStore } from '../settings/store.js';

const VALID_ACTIONS: ParityCheckAction[] = ['CORRECT', 'NOCORRECT', 'PAUSE', 'RESUME', 'CANCEL'];

const ACTIVITY_MESSAGE: Record<ParityCheckAction, { text: string; color: 'blue' | 'amber' }> = {
  CORRECT: { text: 'Parity check started', color: 'blue' },
  NOCORRECT: { text: 'Parity check started (non-correcting)', color: 'blue' },
  PAUSE: { text: 'Parity check paused', color: 'amber' },
  RESUME: { text: 'Parity check resumed', color: 'blue' },
  CANCEL: { text: 'Parity check cancelled', color: 'amber' },
};

// Only the actions that actually begin a check - not pause/resume/cancel - count as "started" for
// notification purposes.
const START_ACTIONS = new Set<ParityCheckAction>(['CORRECT', 'NOCORRECT']);

export function parityRouter(nmd: NmdClient, activity: ActivityStore, settingsStore: SettingsStore): Router {
  const router = Router();

  router.post('/parity/:action', async (req, res) => {
    const action = req.params.action.toUpperCase() as ParityCheckAction;
    if (!VALID_ACTIONS.includes(action)) {
      res.status(400).json({ error: `Invalid action. Expected one of: ${VALID_ACTIONS.join(', ')}` });
      return;
    }
    try {
      const result = await nmd.parityCheck(action);
      const { text, color } = ACTIVITY_MESSAGE[action];
      const isStart = START_ACTIONS.has(action);
      activity.log(text, color, isStart ? 'parityStarted' : undefined).catch(() => {});
      if (isStart) {
        notifyEvent(settingsStore, 'parityStarted', 'NonRAID: parity check started', text);
      }
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
