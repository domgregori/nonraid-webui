// Mirrors backend/src/settings/types.ts's StorageLocation. Keep in sync.
export interface StorageLocation {
  mode: 'boot' | 'array' | 'cache';
  diskSlot: number | null;
}

// Mirrors the {phase, message} progress ticks both backend/src/lxc/storagePath.ts and
// backend/src/docker/storagePath.ts stream during a move.
export interface StoragePathProgress {
  phase: string;
  message: string;
}

export interface StoragePathResult {
  path: string;
}

// Mirrors backend/src/lxc/storagePath.ts's getCurrentLxcStorage return shape.
export interface LxcStorageInfo extends StorageLocation {
  path: string;
}

// Mirrors backend/src/docker/storagePath.ts's DockerStorageInfo — 'custom' covers a data-root this
// app didn't set (e.g. hand-edited outside the boot/array/cache convention).
export interface DockerStorageInfo {
  mode: 'boot' | 'array' | 'cache' | 'custom';
  diskSlot: number | null;
  path: string;
}
