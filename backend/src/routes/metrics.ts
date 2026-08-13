import { Router } from 'express';
import { METRIC_NAMES, type MetricName, type MetricsService } from '../metrics/index.js';

const RANGE_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function isMetricName(v: string): v is MetricName {
  return (METRIC_NAMES as string[]).includes(v);
}

export function metricsRouter(metrics: MetricsService): Router {
  const router = Router();

  // GET /metrics?metrics=cpu_percent,mem_used_bytes&range=24h
  // Batches multiple metrics in one request - the History page loads several charts at once.
  router.get('/metrics', (req, res) => {
    const range = typeof req.query.range === 'string' ? req.query.range : '24h';
    const rangeMs = RANGE_MS[range];
    if (!rangeMs) {
      res.status(400).json({ error: `range must be one of: ${Object.keys(RANGE_MS).join(', ')}` });
      return;
    }

    const requested = typeof req.query.metrics === 'string' ? req.query.metrics.split(',').filter(Boolean) : [];
    if (requested.length === 0) {
      res.status(400).json({ error: 'metrics query param is required (comma-separated).' });
      return;
    }
    const invalid = requested.filter((m) => !isMetricName(m));
    if (invalid.length > 0) {
      res.status(400).json({ error: `Unknown metric(s): ${invalid.join(', ')}. Valid: ${METRIC_NAMES.join(', ')}` });
      return;
    }

    const sinceMs = Date.now() - rangeMs;
    const series = requested.flatMap((m) => metrics.query(m as MetricName, sinceMs));
    res.json({ series });
  });

  return router;
}
