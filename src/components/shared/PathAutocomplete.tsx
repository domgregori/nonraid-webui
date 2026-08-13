import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { browseApi, type PathSuggestScope } from '../../api/browseApi';

interface PathAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  scope: PathSuggestScope;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

const DEBOUNCE_MS = 150;

/**
 * Directory-only path completion, backed by GET /api/browse/suggest. `scope`
 * must match whatever root the caller's own real validation uses
 * (isAllowedBindPath's appsBindRoots for Docker/Apps binds, browseRoot for
 * anything reachable from the file browser) - suggesting a path the field
 * would then reject at submit time would be worse than no suggestions at all.
 */
export function PathAutocomplete({ value, onChange, scope, placeholder, className, disabled, autoFocus }: PathAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const requestId = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const scheduleFetch = (query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const id = ++requestId.current;
    debounceRef.current = setTimeout(() => {
      browseApi
        .suggest(query, scope)
        .then((res) => {
          if (id !== requestId.current) return; // a newer keystroke's request already landed
          setSuggestions(res.suggestions);
          setHighlighted(-1);
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setSuggestions([]);
        });
    }, DEBOUNCE_MS);
  };

  const applySuggestion = (s: string) => {
    const next = `${s}/`;
    onChange(next);
    setOpen(true);
    scheduleFetch(next); // descend into it immediately, same feel as shell tab-completion
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault();
      applySuggestion(suggestions[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="path-autocomplete" ref={containerRef}>
      <input
        className={className ?? 'history-input'}
        style={{ width: '100%' }}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          scheduleFetch(e.target.value);
        }}
        onFocus={() => {
          setOpen(true);
          scheduleFetch(value);
        }}
        onKeyDown={handleKeyDown}
      />
      {open && suggestions.length > 0 && (
        <div className="path-autocomplete__menu">
          {suggestions.map((s, i) => (
            <div
              key={s}
              className={`path-autocomplete__item${i === highlighted ? ' path-autocomplete__item--active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault(); // keep input focus so this fires before blur would close the menu
                applySuggestion(s);
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
