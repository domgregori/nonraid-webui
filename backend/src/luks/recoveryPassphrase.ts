import { randomInt } from 'node:crypto';

// A small, fixed diceware-style wordlist - short, common, unambiguous-to-write-down English words
// (no near-homophones, nothing that reads ambiguously handwritten). Not meant to be
// cryptographically exhaustive on its own; see WORD_COUNT below for the actual entropy budget this
// buys once several are combined.
const WORDLIST = [
  'anchor', 'apple', 'arrow', 'autumn', 'banana', 'basket', 'beacon', 'bishop', 'blanket', 'bottle',
  'branch', 'bridge', 'bronze', 'candle', 'canvas', 'canyon', 'carbon', 'cattle', 'cedar', 'chalk',
  'chimney', 'cinder', 'circle', 'clover', 'coffee', 'comet', 'copper', 'coral', 'cotton', 'crater',
  'cricket', 'crimson', 'crystal', 'dagger', 'dawn', 'desert', 'diamond', 'dolphin', 'dragon', 'eagle',
  'ember', 'engine', 'falcon', 'feather', 'fennel', 'ferry', 'fiddle', 'flame', 'flute', 'forest',
  'fossil', 'fountain', 'garden', 'garnet', 'ginger', 'glacier', 'goblet', 'granite', 'gravel', 'harbor',
  'harvest', 'hazel', 'heron', 'hollow', 'honey', 'hunter', 'iguana', 'indigo', 'island', 'ivory',
  'jacket', 'jasmine', 'jester', 'jungle', 'kettle', 'kitten', 'ladder', 'lagoon', 'lantern', 'laurel',
  'lentil', 'lilac', 'linen', 'lizard', 'lobster', 'locket', 'lumber', 'magnet', 'mallet', 'maple',
  'marble', 'marlin', 'meadow', 'melon', 'mirror', 'mitten', 'monarch', 'mustang', 'nectar', 'nickel',
  'nimbus', 'noodle', 'oasis', 'oatmeal', 'olive', 'onyx', 'opal', 'orbit', 'orchid', 'osprey',
  'otter', 'oyster', 'paddle', 'panther', 'parcel', 'pebble', 'pepper', 'petal', 'pigeon', 'pillow',
  'pirate', 'plank', 'plaza', 'pocket', 'poplar', 'poppy', 'possum', 'pretzel', 'puzzle', 'quartz',
  'quilt', 'rabbit', 'raisin', 'rally', 'ranch', 'raven', 'reef', 'ribbon', 'ridge', 'ripple',
  'rocket', 'rooster', 'saddle', 'saffron', 'salmon', 'sapling', 'satin', 'sequoia', 'shadow', 'shovel',
  'silver', 'sketch', 'sliver', 'sonnet', 'sparrow', 'spider', 'sponge', 'spruce', 'squid', 'stable',
  'stallion', 'starling', 'stone', 'sunset', 'swallow', 'tackle', 'tangerine', 'tapestry', 'tavern', 'thistle',
  'thunder', 'timber', 'toast', 'toffee', 'topaz', 'tortoise', 'trellis', 'trumpet', 'tulip', 'tundra',
  'tunnel', 'turtle', 'umbrella', 'valley', 'velvet', 'violet', 'volcano', 'walnut', 'walrus', 'warbler',
  'weasel', 'whisker', 'willow', 'window', 'winter', 'wizard', 'wolf', 'yarn', 'yonder', 'zephyr',
] as const;

// 6 words from this ~190-word list is ~45 bits of entropy (log2(190^6) ≈ 45.6) - not as strong as a
// long random string, but this is explicitly the *recovery* slot: a human-memorable, "write this
// down on paper" secondary key alongside whichever real secret (a typed passphrase, or the stored
// keyfile) guards day-to-day unlock, not the primary line of defense. Six words keeps it copyable
// by hand without a wall of noise.
const WORD_COUNT = 6;

/** Generates a fresh recovery passphrase - shown to the admin exactly once by the format wizard,
 *  never persisted anywhere in plaintext (only as a LUKS key slot, which isn't reversible back into
 *  the passphrase itself). Uses node:crypto's randomInt (CSPRNG-backed), not Math.random. */
export function generateRecoveryPassphrase(): string {
  const words: string[] = [];
  for (let i = 0; i < WORD_COUNT; i++) {
    words.push(WORDLIST[randomInt(WORDLIST.length)]!);
  }
  return words.join('-');
}
