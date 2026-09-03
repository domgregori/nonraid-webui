import { useTranslation } from 'react-i18next';
import type { UseBrowseSearch } from '../../hooks/useBrowseSearch';

interface SearchBarProps {
  search: UseBrowseSearch;
}

/** Always visible above the listing (not swapped out for the bulk action bar the way the New
 *  Folder/Upload toolbar is) - searching and having a multi-select active aren't mutually
 *  exclusive concerns the way "what's the toolbar for" is. */
export function SearchBar({ search }: SearchBarProps) {
  const { t } = useTranslation('browse');

  return (
    <div className="browse-search-bar">
      <input
        type="text"
        className="history-input"
        placeholder={t('SearchBar.placeholder')}
        value={search.query}
        onChange={(e) => search.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') search.run();
        }}
      />
      <select className="history-input" value={search.scope} onChange={(e) => search.setScope(e.target.value as 'here' | 'everywhere')}>
        <option value="here">{t('SearchBar.scopeHere')}</option>
        <option value="everywhere">{t('SearchBar.scopeEverywhere')}</option>
      </select>
      <label className="browse-search-bar__regex">
        <input type="checkbox" checked={search.regex} onChange={(e) => search.setRegex(e.target.checked)} />
        {t('SearchBar.regex')}
      </label>
      {search.searching ? (
        <button type="button" className="btn" onClick={search.cancel}>
          {t('SearchBar.cancel')}
        </button>
      ) : (
        <button type="button" className="btn" disabled={!search.query.trim()} onClick={search.run}>
          {t('SearchBar.search')}
        </button>
      )}
      {search.active && (
        <button type="button" className="btn" onClick={search.clear}>
          {t('SearchBar.clear')}
        </button>
      )}
      {search.active && !search.searching && !search.error && (
        <span className="browse-search-bar__status">
          {search.truncated ? t('SearchBar.resultCountTruncated', { count: search.results.length }) : t('SearchBar.resultCount', { count: search.results.length })}
        </span>
      )}
      {search.searching && <span className="browse-search-bar__status">{t('SearchBar.searching')}</span>}
      {search.error && <span className="browse-search-bar__status browse-search-bar__status--error">{search.error}</span>}
    </div>
  );
}
