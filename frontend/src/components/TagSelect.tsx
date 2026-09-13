import { useState, type KeyboardEvent } from 'react';

export interface TagSelectProps {
  /** The vocabulary offered. Callers pass one of the SONG_* constants. */
  options: readonly string[];
  value: string[];
  onChange: (value: string[]) => void;
  id?: string;
  placeholder?: string;
}

/**
 * Multi-select over a fixed vocabulary. The closed button counts the
 * selection ("2 tags") rather than listing it, so the row stays one line wide
 * however many are picked.
 */
export const TagSelect = ({ options, value, onChange, id, placeholder = 'None' }: TagSelectProps) => {
  const [open, setOpen] = useState(false);

  const toggle = (option: string) =>
    onChange(value.includes(option) ? value.filter((tag) => tag !== option) : [...value, option]);

  const label =
    value.length === 0 ? placeholder : value.length === 1 ? value[0]! : `${value.length} tags`;

  return (
    <div className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="input flex items-center justify-between text-left"
      >
        <span className={value.length ? '' : 'text-slate-400'}>{label}</span>
        <span aria-hidden="true" className="text-xs text-slate-400">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close options"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul role="listbox" aria-multiselectable="true" className="card absolute z-50 mt-1 max-h-64 w-full overflow-y-auto py-1">
            {options.map((option) => (
              <li key={option}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value.includes(option)}
                  onClick={() => toggle(option)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <span
                    aria-hidden="true"
                    className={`flex size-4 shrink-0 items-center justify-center rounded border text-[10px] text-white ${
                      value.includes(option) ? 'border-brand-600 bg-brand-600' : 'border-slate-300'
                    }`}
                  >
                    {value.includes(option) ? '✓' : ''}
                  </span>
                  {option}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

export interface TagInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  id?: string;
  placeholder?: string;
}

/** Free-form chips. Enter or comma commits the tag being typed. */
export const TagInput = ({ value, onChange, id, placeholder = 'Add Tag' }: TagInputProps) => {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const tag = draft.trim();
    // Duplicates would only clutter the chip row; the field silently ignores them.
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((current) => current !== tag))}
            aria-label={`Remove ${tag}`}
            className="text-slate-400 transition hover:text-rose-600"
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        className="input w-40"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
    </div>
  );
};
