// Mirrors backend/src/settings/types.ts's StorageLocation. Keep in sync.
export interface StorageLocation {
  mode: 'boot' | 'array' | 'cache' | 'custom';
  diskSlot: number | null;
  customPath: string | null;
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

// Mirrors backend/src/docker/storagePath.ts's DockerStorageInfo - 'custom' covers both a data-root
// this app didn't set (e.g. hand-edited outside the boot/array/cache convention) and one an admin
// typed directly (see StorageLocationField's own doc comment for why there's no separate "pool"
// picker mode).
export interface DockerStorageInfo {
  mode: 'boot' | 'array' | 'cache' | 'custom';
  diskSlot: number | null;
  path: string;
}
