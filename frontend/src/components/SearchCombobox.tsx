import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Spinner } from './ui';
import { Icon } from './icons';
import { matchesSearch } from '../lib/search';

/** A person-style leading picture for an option. */
export interface SearchComboboxAvatar {
  name: string | null;
  url: string | null;
}

/** One choice the combobox can offer. */
export interface SearchComboboxOption {
  /** What `onChange` reports and `value` / `excludeIds` refer to. */
  id: string;
  /** Main line. Searched. */
  label: string;
  /** Secondary line (email, team, role). Searched. */
  detail?: string | null;
  /** Extra text that search matches but the row doesn't show. */
  keywords?: ReadonlyArray<string | null | undefined>;
  /** Shows an avatar before the label. */
  avatar?: SearchComboboxAvatar;
  /** Heading the option is listed under (e.g. its team). Searched. */
  group?: string;
  /** Short state shown at the end of the row ("On this plan", "Offered"). */
  badge?: string | null;
}

/**
 * Server-search mode: the caller owns the query, searches with it (debounced)
 * and passes the matches back as `options`. The combobox does no filtering of
 * its own beyond `excludeIds`.
 */
export interface SearchComboboxAsync {
  query: string;
  onQueryChange: (query: string) => void;
  /** A search for the current query is in flight; previous options stay visible. */
  loading?: boolean;
  /** Every match on the server, when known. */
  total?: number | null;
  /** More matches exist than `options` holds (when the total is unknown). */
  hasMore?: boolean;
}

export interface SearchComboboxProps {
  label: string;
  /** Hide the visible label (it stays the accessible name). */
  hideLabel?: boolean;
  /** Selected option id; `''` when nothing is chosen. */
  value: string;
  onChange: (id: string) => void;
  options: readonly SearchComboboxOption[];
  /**
   * Likely answers listed first under `suggestedLabel` (e.g. people on this
   * plan) — before typing and, filtered, while typing. They are not repeated
   * among `options`.
   */
  suggested?: readonly SearchComboboxOption[];
  suggestedLabel?: string;
  /** Heading for ungrouped options when suggestions or groups are shown (e.g. "Everyone"). */
  restLabel?: string;
  /** Omit for client-side, accent-insensitive matching over `options`. */
  async?: SearchComboboxAsync;
  /** The chosen option when it may not be in `options` (server search). */
  selectedOption?: SearchComboboxOption | null;
  /** Ids to leave out of the results (e.g. people already granted). */
  excludeIds?: ReadonlySet<string>;
  /** Rows rendered at once; typing narrows the rest. */
  maxResults?: number;
  placeholder?: string;
  noMatchesText?: string;
  /** Accessible name of the clear button. */
  clearLabel?: (name: string) => string;
  disabled?: boolean;
  /** Id of the text input (defaults to a generated one). */
  id?: string;
}

/** Default rows rendered at once. */
export const SEARCH_COMBOBOX_MAX_RESULTS = 50;

const NO_OPTIONS: readonly SearchComboboxOption[] = [];

interface ComboboxSection {
  key: string;
  heading: string | null;
  options: SearchComboboxOption[];
}

interface ComboboxResults {
  sections: ComboboxSection[];
  /** Options in display order, capped — what the keyboard moves through. */
  flat: SearchComboboxOption[];
  /** Every match before the cap. */
  matched: number;
}

const optionMatches = (query: string, option: SearchComboboxOption): boolean =>
  matchesSearch(query, [option.label, option.detail, option.group, ...(option.keywords ?? [])]);

/**
 * Type-to-search picker that stays usable with hundreds of options:
 * suggestions before typing, accent-insensitive matching (or server search),
 * group headings, keyboard navigation and an honest cap on rendered rows.
 */
export const SearchCombobox = ({
  label,
  hideLabel = false,
  value,
  onChange,
  options,
  suggested = NO_OPTIONS,
  suggestedLabel,
  restLabel,
  async,
  selectedOption,
  excludeIds,
  maxResults = SEARCH_COMBOBOX_MAX_RESULTS,
  placeholder,
  noMatchesText,
  clearLabel,
  disabled = false,
  id,
}: SearchComboboxProps) => {
  const { t } = useTranslation('common');
  const baseId = useId();
  const inputId = id ?? `${baseId}-input`;
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const [localQuery, setLocalQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [focusTarget, setFocusTarget] = useState<'input' | 'change' | null>(null);

  const query = async ? async.query : localQuery;
  const setQuery = (next: string) => (async ? async.onQueryChange(next) : setLocalQuery(next));

  const selected =
    value === ''
      ? null
      : (selectedOption?.id === value ? selectedOption : null) ??
        options.find((option) => option.id === value) ??
        suggested.find((option) => option.id === value) ??
        null;
  const showChip = selected !== null && !editing;

  const results = useMemo<ComboboxResults>(() => {
    const searching = query.trim().length > 0;
    const keep = (option: SearchComboboxOption) =>
      !excludeIds?.has(option.id) && (async || !searching || optionMatches(query, option));
    const suggestedIds = new Set(suggested.map((option) => option.id));
    // Server results already match the query; lift the suggested ones among them.
    const suggestedPool = async && searching ? options.filter((option) => suggestedIds.has(option.id)) : suggested;
    const suggestedMatches = suggestedPool.filter(keep);
    const rest = options.filter((option) => !suggestedIds.has(option.id) && keep(option));

    const groups = new Map<string, SearchComboboxOption[]>();
    for (const option of rest) {
      const key = option.group ?? '';
      const members = groups.get(key);
      if (members) members.push(option);
      else groups.set(key, [option]);
    }
    const hasNamedGroups = [...groups.keys()].some((key) => key !== '');
    const all: ComboboxSection[] = [];
    if (suggestedMatches.length > 0) {
      all.push({ key: 'suggested', heading: suggestedLabel ?? null, options: suggestedMatches });
    }
    for (const [key, members] of groups) {
      const heading = key !== '' ? key : suggestedMatches.length > 0 || hasNamedGroups ? (restLabel ?? null) : null;
      all.push({ key: `group:${key}`, heading, options: members });
    }

    const sections: ComboboxSection[] = [];
    const flat: SearchComboboxOption[] = [];
    let matched = 0;
    for (const section of all) {
      matched += section.options.length;
      const room = maxResults - flat.length;
      if (room <= 0) continue;
      const shown = section.options.slice(0, room);
      flat.push(...shown);
      sections.push({ ...section, options: shown });
    }
    return { sections, flat, matched };
  }, [async, excludeIds, maxResults, options, query, restLabel, suggested, suggestedLabel]);

  const { sections, flat, matched } = results;
  const active = Math.min(highlight, Math.max(flat.length - 1, 0));

  useEffect(() => {
    if (focusTarget === 'input') inputRef.current?.focus();
    if (focusTarget === 'change') changeRef.current?.focus();
    if (focusTarget) setFocusTarget(null);
  }, [focusTarget]);

  useEffect(() => {
    if (open) document.getElementById(`${baseId}-opt-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open, baseId]);

  const close = () => {
    setOpen(false);
    if (editing) {
      setEditing(false);
      setQuery('');
    }
  };

  const choose = (option: SearchComboboxOption) => {
    onChange(option.id);
    setQuery('');
    setOpen(false);
    setEditing(false);
    setHighlight(0);
    setFocusTarget('change');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight(Math.min(active + 1, Math.max(flat.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight(Math.max(active - 1, 0));
    } else if (event.key === 'Enter' && open) {
      const option = flat[active];
      if (option) {
        event.preventDefault();
        choose(option);
      }
    } else if (event.key === 'Escape' && (open || editing)) {
      // Close the list (or stop changing) without also closing a surrounding modal.
      event.preventDefault();
      const wasEditing = editing;
      close();
      if (wasEditing) setFocusTarget('change');
    }
  };

  const hint = (() => {
    if (async && typeof async.total === 'number' && async.total > flat.length) {
      return t('list.showingOfRefine', { shown: flat.length, total: async.total });
    }
    if (!async && matched > flat.length) return t('list.showingOfRefine', { shown: flat.length, total: matched });
    if (async && (async.hasMore || matched > flat.length)) return t('list.refineSearch', { shown: flat.length });
    return null;
  })();

  const fallbackName = t('fallback.unnamed');
  let rowIndex = -1;

  return (
    <div className="relative">
      <label className={hideLabel ? 'sr-only' : 'label'} htmlFor={showChip ? undefined : inputId}>
        {label}
      </label>

      {showChip ? (
        <div className="input flex items-center gap-2 !py-1.5">
          {selected.avatar && <Avatar name={selected.avatar.name} url={selected.avatar.url} size="sm" />}
          <button
            ref={changeRef}
            type="button"
            className="min-w-0 flex-1 truncate text-left disabled:cursor-not-allowed"
            aria-label={t('combobox.change', { label, name: selected.label || fallbackName })}
            disabled={disabled}
            onClick={() => {
              setEditing(true);
              setOpen(true);
              setFocusTarget('input');
            }}
          >
            <span>{selected.label || fallbackName}</span>
            {(selected.group || selected.detail) && (
              <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                {[selected.group, selected.detail].filter(Boolean).join(' · ')}
              </span>
            )}
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label={clearLabel ? clearLabel(selected.label || fallbackName) : t('combobox.clear', { name: selected.label || fallbackName })}
            disabled={disabled}
            onClick={() => {
              onChange('');
              setFocusTarget('input');
            }}
          >
            <Icon name="close" className="size-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
          />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            autoComplete="off"
            className="input !pl-9"
            placeholder={placeholder ?? (selected ? selected.label : t('combobox.placeholder'))}
            value={query}
            disabled={disabled}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && flat[active] ? optionId(active) : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={close}
            onKeyDown={onKeyDown}
          />
          {async?.loading && (
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-slate-400">
              <Spinner className="size-4" />
            </span>
          )}
        </div>
      )}

      {open && !showChip && (
        <div
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-app-border bg-white shadow-lg dark:bg-slate-900"
          // Keep focus in the input so a click (or a scrollbar drag) lands before blur closes the list.
          onMouseDown={(event) => event.preventDefault()}
        >
          <div id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto py-1">
            {flat.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                {async?.loading ? t('states.loading') : (noMatchesText ?? t('combobox.noMatches'))}
              </p>
            ) : (
              sections.map((section) => {
                const headingId = `${baseId}-${section.key}`;
                const rows = section.options.map((option) => {
                  rowIndex += 1;
                  const index = rowIndex;
                  return (
                    <div
                      key={option.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === active}
                      className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm ${
                        index === active ? 'bg-brand-50 dark:bg-brand-500/15' : ''
                      }`}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => choose(option)}
                    >
                      {option.avatar && <Avatar name={option.avatar.name} url={option.avatar.url} size="sm" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-900 dark:text-white">
                          {option.label || fallbackName}
                        </span>
                        {option.detail && (
                          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{option.detail}</span>
                        )}
                      </span>
                      {option.badge && (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {option.badge}
                        </span>
                      )}
                    </div>
                  );
                });
                return section.heading ? (
                  <div key={section.key} role="group" aria-labelledby={headingId}>
                    <div
                      id={headingId}
                      role="presentation"
                      className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
                    >
                      {section.heading}
                    </div>
                    {rows}
                  </div>
                ) : (
                  <div key={section.key} role="presentation">
                    {rows}
                  </div>
                );
              })
            )}
          </div>
          {hint && (
            <p className="border-t border-app-border px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
          )}
        </div>
      )}
    </div>
  );
};
