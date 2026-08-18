import { useEffect, useState } from 'react';
import { useSettings } from '../../hooks/useSettings';

/** Live clock next to the logo/title - purely a display convenience, so it fetches settings on its
 *  own (see useSettings' own doc comment) rather than needing a shared context. Ticks every 15s,
 *  plenty for a minute-resolution display without a per-second re-render on every page. */
export function HeaderClock() {
  const { settings } = useSettings();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

  const hour12 = settings?.timeFormat !== '24h';
  return <span className="header__clock">{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12 })}</span>;
}
