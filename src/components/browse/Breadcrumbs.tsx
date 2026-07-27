interface BreadcrumbsProps {
  share: string;
  path: string;
  onNavigate: (path: string) => void;
}

export function Breadcrumbs({ share, path, onNavigate }: BreadcrumbsProps) {
  const segments = path ? path.split('/') : [];

  return (
    <div className="breadcrumbs">
      <button type="button" className="breadcrumbs__segment" onClick={() => onNavigate('')}>
        {share}
      </button>
      {segments.map((seg, i) => {
        const target = segments.slice(0, i + 1).join('/');
        return (
          <span key={target} className="breadcrumbs__item">
            <span className="breadcrumbs__sep">/</span>
            <button type="button" className="breadcrumbs__segment" onClick={() => onNavigate(target)}>
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );
}
