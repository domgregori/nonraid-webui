import { useEffect, useState } from 'react';
import { useSettings } from '../../hooks/useSettings';
import { useSystemStats } from '../../hooks/useSystemStats';

/** Live clock next to the logo/title - purely a display convenience, so it fetches settings/stats
 *  on its own (see useSettings' own doc comment) rather than needing a shared context. Ticks every
 *  15s, plenty for a minute-resolution display without a per-second re-render on every page. */
export function HeaderClock() {
  const { settings } = useSettings();
  const stats = useSystemStats();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

  const hour12 = settings?.timeFormat !== '24h';
  // Explicit timeZone, not the browser's own - this clock is the NAS's configured timezone, which
  // won't generally match wherever the browser happens to be. Falls back to the browser's zone only
  // until the first /system poll lands.
  return (
    <span className="header__clock">
      {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12, timeZone: stats?.timezone })}
    </span>
  );
}
