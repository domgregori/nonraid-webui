// Mirrors backend/src/system/benchmark.ts's BenchmarkResult. Keep in sync.
export interface BenchmarkResult {
  mbPerSecond: number;
  elapsedSeconds: number;
  sizeMb: number;
}
