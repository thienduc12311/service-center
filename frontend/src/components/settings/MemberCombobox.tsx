import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../ui';
import { Icon } from '../icons';
import { matchesSearch } from '../../lib/search';

/** One person the picker can offer. */
export interface MemberOption {
  /** Profile (user) id — what grants and access checks are keyed by. */
  id: string;
  name: string | null;
  avatarUrl: string | null;
  /** Secondary line, e.g. an email or role. Also searched. */
  detail?: string | null;
}

export interface MemberComboboxProps {
  options: readonly MemberOption[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** Hide the visible label (it stays the accessible name). */
  hideLabel?: boolean;
  placeholder?: string;
  /** Ids to leave out of the results (e.g. people already granted). */
  excludeIds?: ReadonlySet<string>;
  disabled?: boolean;
}

/** Results rendered at once; typing narrows the rest. */
const MAX_RESULTS = 50;

/**
 * Type-to-search member picker that stays usable with hundreds of people:
 * accent-insensitive matching on name and detail, keyboard navigation, and a
 * capped result list instead of one giant `<select>`.
 */
export const MemberCombobox = ({
  options,
  value,
  onChange,
  label,
  hideLabel = false,
  placeholder,
  excludeIds,
  disabled = false,
}: MemberComboboxProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const baseId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const selected = options.find((option) => option.id === value) ?? null;
  const unnamed = t('common:fallback.unnamed');

  const matches = useMemo(
    () =>
      options.filter(
        (option) => !excludeIds?.has(option.id) && matchesSearch(query, [option.name, option.detail]),
      ),
    [options, excludeIds, query],
  );
  const shown = matches.slice(0, MAX_RESULTS);
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  const choose = (option: MemberOption) => {
    onChange(option.id);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) => Math.min(index + 1, Math.max(shown.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open) {
      const option = shown[highlight];
      if (option) {
        event.preventDefault();
        choose(option);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <label className={hideLabel ? 'sr-only' : 'label'} htmlFor={`${baseId}-input`}>
        {label}
      </label>

      {selected ? (
        <div className="input flex items-center gap-2 !py-1.5">
          <Avatar name={selected.name} url={selected.avatarUrl} size="sm" />
          <span className="min-w-0 flex-1 truncate">{selected.name ?? unnamed}</span>
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label={t('memberPicker.clear', { name: selected.name ?? unnamed })}
            disabled={disabled}
            onClick={() => {
              onChange('');
              // Let React swap the chip for the input before focusing it.
              requestAnimationFrame(() => inputRef.current?.focus());
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
            id={`${baseId}-input`}
            type="text"
            role="combobox"
            autoComplete="off"
            className="input !pl-9"
            placeholder={placeholder ?? t('memberPicker.placeholder')}
            value={query}
            disabled={disabled}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && shown[highlight] ? optionId(highlight) : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            // Delay so a click on an option lands before the list closes.
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown}
          />
        </div>
      )}

      {open && !selected && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-app-border bg-white shadow-lg dark:bg-slate-900">
          <ul id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-500">{t('memberPicker.noMatches')}</li>
            ) : (
              shown.map((option, index) => (
                <li
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === highlight}
                  className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm ${
                    index === highlight ? 'bg-brand-50 dark:bg-brand-500/15' : ''
                  }`}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                >
                  <Avatar name={option.name} url={option.avatarUrl} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900 dark:text-white">
                      {option.name ?? unnamed}
                    </span>
                    {option.detail && <span className="block truncate text-xs text-slate-500">{option.detail}</span>}
                  </span>
                </li>
              ))
            )}
          </ul>
          {matches.length > shown.length && (
            <p className="border-t border-app-border px-3 py-1.5 text-xs text-slate-500">
              {t('memberPicker.more', { shown: shown.length, total: matches.length })}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
