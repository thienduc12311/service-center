import { useState, type ReactNode } from 'react';
import { keyGridFor, type KeyQuality } from '@service-center/shared';

export interface KeyGridProps {
  quality: KeyQuality;
  /** The key currently chosen, so it can be highlighted. */
  value: string | null;
  onSelect: (key: string) => void;
}

/**
 * The twelve keys laid out one letter per row, flats on the left and sharps on
 * the right. Musicians read a key off its letter, so the grid beats a list.
 */
export const KeyGrid = ({ quality, value, onSelect }: KeyGridProps) => (
  <div className="grid grid-cols-3 border-t border-slate-200">
    {keyGridFor(quality).map((row, rowIndex) =>
      row.map((key, columnIndex) =>
        key === null ? (
          // Nobody writes B# or Cb, so the cell stays an empty spacer.
          <div key={`${rowIndex}-${columnIndex}`} className="border-b border-r border-slate-200 bg-slate-50" />
        ) : (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-pressed={value === key}
            className={`border-b border-r border-slate-200 px-2 py-2 text-sm transition
              ${value === key ? 'bg-brand-600 font-semibold text-white' : 'hover:bg-slate-100'}
              ${columnIndex === 0 || columnIndex === 2 ? 'font-medium' : ''}`}
          >
            {key}
          </button>
        ),
      ),
    )}
  </div>
);

export interface KeyQualityTabsProps {
  value: KeyQuality;
  onChange: (quality: KeyQuality) => void;
}

/**
 * The Major / Minor switch that decides which twelve keys the grid below it
 * offers. Shared by the key field and the chart's key picker so the two can
 * never drift apart.
 */
export const KeyQualityTabs = ({ value, onChange }: KeyQualityTabsProps) => (
  <div className="flex gap-1 p-2">
    {(['major', 'minor'] as const).map((option) => (
      <button
        key={option}
        type="button"
        onClick={() => onChange(option)}
        aria-pressed={value === option}
        className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition ${
          value === option
            ? 'bg-brand-600 text-white'
            : 'text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50'
        }`}
      >
        {option}
      </button>
    ))}
  </div>
);

export interface KeySelectProps {
  value: string | null;
  onChange: (key: string | null) => void;
  /** Shown on the closed button when nothing is chosen. */
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  /** Extra choices rendered under the grid, e.g. the chart notations. */
  footer?: (close: () => void) => ReactNode;
  /** Top row that clears the selection. Omitted when not given. */
  resetLabel?: string;
}

/**
 * A key field: a select-looking button that opens the grid, with a Major /
 * Minor toggle above it.
 */
export const KeySelect = ({
  value,
  onChange,
  placeholder = 'Select a key',
  id,
  disabled = false,
  footer,
  resetLabel,
}: KeySelectProps) => {
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<KeyQuality>(value?.endsWith('m') ? 'minor' : 'major');
  const close = () => setOpen(false);

  return (
    <div className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`input flex items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-50
          ${open ? 'border-brand-500 ring-2 ring-brand-100' : ''}`}
      >
        <span className={value ? '' : 'text-slate-400'}>{value ?? placeholder}</span>
        <span aria-hidden="true" className="text-xs text-slate-400">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close key picker"
            className="fixed inset-0 z-40 cursor-default"
            onClick={close}
          />
          <div className="card absolute z-50 mt-1 w-64 overflow-hidden p-0">
            {resetLabel && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  close();
                }}
                className="block w-full px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {resetLabel}
              </button>
            )}

            <KeyQualityTabs value={quality} onChange={setQuality} />

            <KeyGrid
              quality={quality}
              value={value}
              onSelect={(key) => {
                onChange(key);
                close();
              }}
            />

            {footer?.(close)}
          </div>
        </>
      )}
    </div>
  );
};
