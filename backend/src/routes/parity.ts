import { Router } from 'express';
import type { NmdClient } from '../nmd/index.js';
import type { ParityCheckAction } from '../nmd/types.js';

const VALID_ACTIONS: ParityCheckAction[] = ['CORRECT', 'NOCORRECT', 'PAUSE', 'RESUME', 'CANCEL'];

export function parityRouter(nmd: NmdClient): Router {
  const router = Router();

  router.post('/parity/:action', async (req, res) => {
    const action = req.params.action.toUpperCase() as ParityCheckAction;
    if (!VALID_ACTIONS.includes(action)) {
      res.status(400).json({ error: `Invalid action. Expected one of: ${VALID_ACTIONS.join(', ')}` });
      return;
    }
    try {
      res.json(await nmd.parityCheck(action));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
