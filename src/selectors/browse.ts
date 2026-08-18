import { COLORS } from '../styles/colors';
import type { BrowseLocationType } from '../types/browseApi';

/** Color/label for BrowseEntry.locationType - see that type's own doc comment in
 *  backend/src/browse/types.ts for exactly which entries get classified. */
export const LOCATION_TYPE_LABEL: Record<BrowseLocationType, string> = {
  pool: 'Pool',
  disk: 'Array Disk',
  cache: 'Cache',
  boot: 'Boot Disk',
};

export const LOCATION_TYPE_COLOR: Record<BrowseLocationType, string> = {
  pool: COLORS.blue,
  disk: COLORS.amber,
  cache: COLORS.green,
  boot: COLORS.chartPurple,
};
