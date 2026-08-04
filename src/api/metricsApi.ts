import { request } from './request';
import type { MetricName, MetricRange, MetricsQueryResult } from '../types/metricsApi';

export const metricsApi = {
  query: (metrics: MetricName[], range: MetricRange) =>
    request<MetricsQueryResult>(`/api/metrics?metrics=${metrics.join(',')}&range=${range}`),
};
