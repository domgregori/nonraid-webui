// Mirrors backend/src/system/benchmark.ts's BenchmarkResult/BenchmarkSample. Keep in sync.
export interface BenchmarkSample {
  elapsedSeconds: number;
  mbPerSecond: number;
}

export interface BenchmarkResult {
  mbPerSecond: number;
  elapsedSeconds: number;
  sizeMb: number;
  samples: BenchmarkSample[];
}
