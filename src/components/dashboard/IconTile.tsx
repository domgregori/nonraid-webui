import type { ReactNode } from 'react';
import { useState } from 'react';

interface IconTileProps {
  name: string;
  statusLabel: string;
  statusColor: string;
  iconUrl?: string | null;
  webUiUrl?: string | null;
  /** Overrides iconUrl/img/letter-avatar entirely when provided - for a caller with its own
   *  icon source and fallback logic (e.g. LxcWidgetCard's DistroIcon, a bundled vector mark
   *  rather than a hosted image URL). */
  icon?: ReactNode;
}

/**
 * One entry in a Docker/LXC dashboard icon grid - real icon (or an
 * initial-letter fallback) + name + status. Takes a pre-derived
 * statusLabel/statusColor rather than a running boolean so callers reuse
 * the same selectors (deriveContainerViewModel / deriveLxcContainerViewModel)
 * the full Docker/LXC pages use - LXC in particular has frozen/unknown
 * states a plain running/stopped binary would misrepresent.
 */
export function IconTile({ name, statusLabel, statusColor, iconUrl, webUiUrl, icon }: IconTileProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = !icon && !!iconUrl && !imgFailed;

  return (
    <div className="icon-tile">
      <div className="icon-tile__icon">
        {icon ? (
          icon
        ) : showImg ? (
          <img src={iconUrl ?? undefined} alt="" onError={() => setImgFailed(true)} />
        ) : (
          <span className="icon-tile__avatar">{name.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="icon-tile__body">
        {webUiUrl ? (
          <a className="icon-tile__name icon-tile__name--link" href={webUiUrl} target="_blank" rel="noreferrer">
            {name}
          </a>
        ) : (
          <div className="icon-tile__name">{name}</div>
        )}
        <div className="icon-tile__status" style={{ color: statusColor }}>
          <span className="icon-tile__status-dot" style={{ background: statusColor }} />
          {statusLabel}
        </div>
      </div>
    </div>
  );
}
