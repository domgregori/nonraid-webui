import { findDistroIcon } from './distroIcons';

interface DistroIconProps {
  /** null for a container created before distro tracking existed, or one whose template couldn't
   *  be matched against the bundled set - falls back to fallbackLabel's first letter instead. */
  distribution: string | null;
  /** What to letter-badge from when there's no bundled icon - defaults to `distribution` itself
   *  (e.g. a hand-typed "Custom…" value), but callers with a null distribution (an existing
   *  container with no recorded distro) should pass the container's own name instead. */
  fallbackLabel?: string;
  size?: number;
}

/** Falls back to a plain letter mark for a distro outside the bundled set (e.g. a "Custom…"
 *  distribution/release typed by hand, or an existing container with no recorded distro at all) -
 *  same fallback pattern as apps/AppIcon.tsx. */
export function DistroIcon({ distribution, fallbackLabel, size = 24 }: DistroIconProps) {
  const icon = distribution ? findDistroIcon(distribution) : null;

  if (icon) {
    return (
      <svg className="app-card__icon" width={size} height={size} viewBox="-3.5 -3.5 31 31" role="img" aria-label={icon.title}>
        <path d={icon.path} fill={`#${icon.hex}`} />
      </svg>
    );
  }

  const letter = (fallbackLabel ?? distribution ?? '').trim().charAt(0).toUpperCase();
  return (
    <div className="app-card__icon app-card__icon--fallback" style={{ width: size, height: size }}>
      {letter || '?'}
    </div>
  );
}
