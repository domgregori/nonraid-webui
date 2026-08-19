import { useState } from 'react';

interface AppIconProps {
  name: string;
  icon: string | null;
  size?: number;
}

export function AppIcon({ name, icon, size = 40 }: AppIconProps) {
  const [failed, setFailed] = useState(false);

  if (icon && !failed) {
    return (
      <img
        className="app-card__icon"
        src={icon}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="app-card__icon app-card__icon--fallback" style={{ width: size, height: size }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
