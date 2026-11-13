import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { GlobalSearchKind } from '@service-center/shared';
import { useGlobalSearch } from '../hooks/queries';
import { ErrorNotice, Modal, Spinner } from './ui';
import { Icon } from './icons';

/** Waits for typing to pause before searching. */
const useDebounced = (value: string, delayMs: number): string => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};

/**
 * Searches people, teams, positions, plans, songs and files. Results come
 * only from records the signed-in person could open anyway; "more" never
 * reveals how many hidden matches exist.
 */
export const GlobalSearch = () => {
  const { t } = useTranslation(['home', 'common']);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 250);
  const results = useGlobalSearch(open ? debounced : '');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const searching = debounced.trim().length >= 2;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-xl text-slate-500 transition hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500
          max-md:w-9 max-md:justify-center max-md:hover:bg-slate-100 md:w-64 md:bg-white md:px-3 md:shadow-sm md:shadow-slate-900/5 md:ring-1 md:ring-inset md:ring-slate-200
          md:hover:ring-slate-300 dark:text-slate-400 dark:hover:text-white max-md:dark:hover:bg-slate-800 md:dark:bg-slate-900 md:dark:ring-slate-700"
        aria-label={t('common:actions.search')}
        title={t('search.button')}
      >
        <Icon name="search" className="size-[18px] md:size-4" />
        <span className="hidden flex-1 truncate text-left text-sm md:block">{t('search.placeholder')}</span>
        <kbd className="hidden rounded-md bg-slate-100 px-1.5 py-0.5 font-sans text-[11px] font-medium text-slate-500 md:block dark:bg-slate-800 dark:text-slate-400">
          ⌘K
        </kbd>
      </button>
      {/* Portaled: the sticky header's backdrop blur would otherwise become the
          containing block for the fixed dialog and clip it. */}
      {createPortal(
        <Modal open={open} title={t('common:actions.search')} onClose={close}>
          <div className="space-y-3">
            <input
              autoFocus
              aria-label={t('search.inputLabel')}
              className="input"
              placeholder={t('search.placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ErrorNotice error={results.error} />
            {!searching ? (
              <p className="text-sm text-slate-500">{t('search.minLength')}</p>
            ) : results.isFetching && !results.data ? (
              <div className="flex justify-center py-4">
                <Spinner />
              </div>
            ) : (results.data?.groups.length ?? 0) === 0 ? (
              <p className="text-sm text-slate-500">{t('search.nothingFound')}</p>
            ) : (
              <div className="max-h-96 space-y-3 overflow-y-auto">
                {results.data?.groups.map((group) => (
                  <section key={group.kind}>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {t(`search.groups.${group.kind satisfies GlobalSearchKind}`)}
                    </h3>
                    <ul>
                      {group.hits.map((hit) => (
                        <li key={`${hit.kind}-${hit.id}`}>
                          <button
                            type="button"
                            className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                            onClick={() => {
                              close();
                              navigate(hit.href);
                            }}
                          >
                            <span>
                              {hit.title}
                              {hit.archived && <span className="ml-2 text-xs text-amber-700">{t('search.archived')}</span>}
                            </span>
                            {hit.subtitle && <span className="truncate text-xs text-slate-500">{hit.subtitle}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {group.has_more && (
                      <p className="px-2 text-xs text-slate-500">{t('search.moreMatches')}</p>
                    )}
                  </section>
                ))}
              </div>
            )}
          </div>
        </Modal>,
        document.body,
      )}
    </>
  );
};
