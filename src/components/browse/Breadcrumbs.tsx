interface BreadcrumbsProps {
  path: string;
  onNavigate: (path: string) => void;
}

export function Breadcrumbs({ path, onNavigate }: BreadcrumbsProps) {
  const segments = path.split('/').filter(Boolean);

  return (
    <div className="breadcrumbs">
      {segments.map((seg, i) => {
        const target = '/' + segments.slice(0, i + 1).join('/');
        return (
          <span key={target} className="breadcrumbs__item">
            {i > 0 && <span className="breadcrumbs__sep">/</span>}
            <button type="button" className="breadcrumbs__segment" onClick={() => onNavigate(target)}>
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );
}
