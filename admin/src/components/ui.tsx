/**
 * The admin app's building blocks, following frontend/src/components/ui.tsx
 * (same classes and tokens) without its i18n layer: admin UI text is English.
 */
import { useEffect, useId, useRef } from 'react';
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../lib/errors';
import { Icon, type IconName } from './icons';

/* -------------------------------------------------------------------------
 * Actions
 * ---------------------------------------------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700 focus-visible:outline-brand-600 active:bg-brand-700',
  secondary:
    'bg-white text-slate-700 shadow-sm shadow-slate-900/5 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
  danger: 'bg-app-danger text-white shadow-sm shadow-rose-600/20 hover:bg-app-danger-pressed',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
};

const ICON_SIZES: Record<ButtonSize, string> = { sm: 'size-3.5', md: 'size-4', lg: 'size-[18px]' };

export const buttonClasses = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string =>
  `button inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium outline-offset-2 transition
   focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]}`;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** A leading glyph; the label stays the accessible name. */
  icon?: IconName;
}

export const Button = ({
  variant = 'primary',
  size = 'md',
  className = '',
  loading = false,
  icon,
  type = 'button',
  children,
  ...props
}: ButtonProps) => (
  <button {...props} type={type} disabled={props.disabled || loading} className={`${buttonClasses(variant, size)} ${className}`}>
    {loading ? <Spinner className={ICON_SIZES[size]} /> : icon ? <Icon name={icon} className={ICON_SIZES[size]} /> : null}
    {children}
  </button>
);

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Required: an icon alone has no accessible name. */
  label: string;
  size?: 'sm' | 'md';
}

export const IconButton = ({ icon, label, size = 'md', className = '', ...props }: IconButtonProps) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    {...props}
    className={`inline-grid shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900
      focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-40
      dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white ${size === 'sm' ? 'size-8' : 'size-9'} ${className}`}
  >
    <Icon name={icon} className={size === 'sm' ? 'size-4' : 'size-[18px]'} />
  </button>
);

export interface SpinnerProps {
  className?: string;
}

export const Spinner = ({ className = 'size-5' }: SpinnerProps) => (
  <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
  </svg>
);

/* -------------------------------------------------------------------------
 * Data display
 * ---------------------------------------------------------------------- */

export type BadgeTone = 'green' | 'red' | 'amber' | 'brand' | 'slate';

const BADGE_TONES: Record<BadgeTone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-500/25',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600/40',
};

export interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
}

export const Badge = ({ tone, children }: BadgeProps) => (
  <span
    className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}
  >
    {children}
  </span>
);

export type StatTone = 'brand' | 'green' | 'amber' | 'rose' | 'slate';

const STAT_TONES: Record<StatTone, string> = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-200',
  green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export interface StatCardProps {
  label: string;
  value: ReactNode;
  icon: IconName;
  tone?: StatTone;
  hint?: ReactNode;
  /** Makes the whole tile a link. */
  to?: string;
}

export const StatCard = ({ label, value, icon, tone = 'brand', hint, to }: StatCardProps) => {
  const body = (
    <div className="flex items-start gap-3 p-4">
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${STAT_TONES[tone]}`}>
        <Icon name={icon} className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">{value}</p>
        {hint && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="card card-interactive block">
      {body}
    </Link>
  ) : (
    <div className="card">{body}</div>
  );
};

export interface DetailItem {
  label: string;
  value: ReactNode;
}

export interface DetailListProps {
  items: readonly DetailItem[];
  className?: string;
}

/** Label/value pairs in a responsive grid; empty values show a dash. */
export const DetailList = ({ items, className = '' }: DetailListProps) => (
  <dl className={`grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
    {items.map((item) => (
      <div key={item.label} className="min-w-0">
        <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{item.label}</dt>
        <dd className="mt-0.5 break-words text-slate-900 dark:text-slate-100">
          {item.value === null || item.value === undefined || item.value === '' ? (
            <span className="text-slate-400">—</span>
          ) : (
            item.value
          )}
        </dd>
      </div>
    ))}
  </dl>
);

/* -------------------------------------------------------------------------
 * Structure
 * ---------------------------------------------------------------------- */

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** A "back" link shown above the title, for detail pages. */
  back?: { to: string; label: string };
}

export const PageHeader = ({ title, subtitle, actions, back }: PageHeaderProps) => (
  <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
    <div className="min-w-0 max-w-3xl">
      {back && (
        <Link
          to={back.to}
          className="mb-1.5 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-brand-700 dark:text-slate-400 dark:hover:text-brand-200"
        >
          <Icon name="chevronLeft" className="size-4" />
          {back.label}
        </Link>
      )}
      <h1 className="text-xl font-semibold tracking-tight text-balance text-slate-900 sm:text-2xl dark:text-white">{title}</h1>
      {subtitle && <div className="mt-1 text-sm text-pretty text-slate-500 dark:text-slate-400">{subtitle}</div>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

export interface SectionHeaderProps {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
}

export const SectionHeader = ({ title, meta, action, id, className = '' }: SectionHeaderProps) => (
  <div className={`mb-2.5 flex min-h-8 items-center justify-between gap-3 ${className}`}>
    <div className="flex min-w-0 items-center gap-2">
      <h2 id={id} className="section-label truncate">
        {title}
      </h2>
      {meta !== undefined && meta !== null && (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 tabular-nums dark:bg-slate-800 dark:text-slate-300">
          {meta}
        </span>
      )}
    </div>
    {action}
  </div>
);

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
}

const CARD_PADDING: Record<CardPadding, string> = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6' };

export const Card = ({ padding = 'md', className = '', ...props }: CardProps) => (
  <div {...props} className={`card ${CARD_PADDING[padding]} ${className}`} />
);

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

export function Tabs<T extends string>({ items, value, onChange, label, className = '' }: TabsProps<T>) {
  return (
    <div role="tablist" aria-label={label} className={`-mx-1 flex gap-1 overflow-x-auto border-b border-app-border px-1 ${className}`}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={`relative -mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 pt-1 pb-2.5 text-sm font-medium outline-none transition
              focus-visible:text-brand-700 ${
                active
                  ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-200'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-100'
              }`}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={`rounded-full px-1.5 text-xs tabular-nums ${
                  active
                    ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200'
                    : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Form fields
 * ---------------------------------------------------------------------- */

interface FieldChromeProps {
  label: ReactNode;
  /** Shown under the control in red; also marks the control invalid. */
  error?: string;
  /** Supporting text under the control. */
  hint?: ReactNode;
  className?: string;
}

export interface FieldShellProps extends FieldChromeProps {
  id: string;
  children: ReactNode;
}

/** Label above, control, then hint or error, wired up for screen readers by the callers below. */
export const FieldShell = ({ id, label, error, hint, className = '', children }: FieldShellProps) => (
  <div className={className}>
    <label htmlFor={id} className="label">
      {label}
    </label>
    {children}
    {error ? (
      <p id={`${id}-error`} className="mt-1 text-xs text-rose-600 dark:text-rose-400">
        {error}
      </p>
    ) : hint ? (
      <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {hint}
      </p>
    ) : null}
  </div>
);

const describedBy = (id: string, error: string | undefined, hint: ReactNode): string | undefined =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export type TextFieldProps = FieldChromeProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>;

export const TextField = ({ label, error, hint, className, id, ...props }: TextFieldProps) => {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} className={className}>
      <input
        {...props}
        id={fieldId}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, error, hint)}
      />
    </FieldShell>
  );
};

export type TextAreaFieldProps = FieldChromeProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>;

export const TextAreaField = ({ label, error, hint, className, id, rows = 3, ...props }: TextAreaFieldProps) => {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} className={className}>
      <textarea
        {...props}
        id={fieldId}
        rows={rows}
        className="input resize-y"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, error, hint)}
      />
    </FieldShell>
  );
};

export type SelectFieldProps = FieldChromeProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>;

export const SelectField = ({ label, error, hint, className, id, children, ...props }: SelectFieldProps) => {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} className={className}>
      <select
        {...props}
        id={fieldId}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, error, hint)}
      >
        {children}
      </select>
    </FieldShell>
  );
};

/* -------------------------------------------------------------------------
 * States
 * ---------------------------------------------------------------------- */

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: IconName;
  /** Smaller, borderless variant for use inside an existing card. */
  compact?: boolean;
}

export const EmptyState = ({ title, description, action, icon = 'sparkle', compact = false }: EmptyStateProps) => (
  <div className={`flex flex-col items-center text-center ${compact ? 'gap-1.5 px-4 py-8' : 'card gap-2 border-dashed px-6 py-12'}`}>
    <span
      className={`mb-2 grid place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-500/20 ${
        compact ? 'size-10' : 'size-12'
      }`}
    >
      <Icon name={icon} className={compact ? 'size-5' : 'size-6'} />
    </span>
    <p className="font-semibold text-slate-900 dark:text-white">{title}</p>
    {description && <p className="max-w-md text-sm text-pretty text-slate-500 dark:text-slate-400">{description}</p>}
    {action && <div className="mt-3">{action}</div>}
  </div>
);

export interface ErrorNoticeProps {
  error: unknown;
  /** Shown when the error carries no usable message. */
  fallback?: string;
  /** Offers a retry beside the message. */
  onRetry?: () => void;
  className?: string;
}

export const ErrorNotice = ({ error, fallback, onRetry, className = '' }: ErrorNoticeProps) => {
  if (!error) return null;
  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30 ${className}`}
    >
      <Icon name="alert" className="mt-px size-4" />
      <span className="min-w-0 flex-1">{errorMessage(error, fallback)}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
};

export type NoticeTone = 'info' | 'warning' | 'success';

const NOTICE_TONES: Record<NoticeTone, { box: string; icon: IconName }> = {
  info: {
    box: 'bg-brand-50 text-brand-800 ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-500/25',
    icon: 'info',
  },
  warning: {
    box: 'bg-amber-50 text-amber-900 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25',
    icon: 'alert',
  },
  success: {
    box: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/25',
    icon: 'check',
  },
};

export interface NoticeProps {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
}

export const Notice = ({ tone = 'info', children, className = '' }: NoticeProps) => (
  <div
    role={tone === 'warning' ? 'alert' : 'status'}
    className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${NOTICE_TONES[tone].box} ${className}`}
  >
    <Icon name={NOTICE_TONES[tone].icon} className="mt-px size-4" />
    <div className="min-w-0">{children}</div>
  </div>
);

export interface LoadingProps {
  label?: string;
}

export const Loading = ({ label = 'Loading…' }: LoadingProps) => (
  <div role="status" className="flex items-center justify-center gap-3 py-16 text-slate-400">
    <Spinner />
    <span className="text-sm">{label}</span>
  </div>
);

/* -------------------------------------------------------------------------
 * Overlays
 * ---------------------------------------------------------------------- */

export type ModalSize = 'default' | 'wide';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
}

export const Modal = ({ open, title, onClose, children, footer, size = 'default' }: ModalProps) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the first field (or the dialog itself) so keyboard users start inside.
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>('input, select, textarea');
    (first ?? dialog)?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="animate-fade-in absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`animate-pop-in relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-app-border bg-app-surface
          shadow-2xl shadow-slate-950/20 outline-none sm:max-h-[85vh] sm:rounded-2xl ${size === 'wide' ? 'max-w-3xl' : 'max-w-lg'}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-app-border px-5 pt-4 pb-3">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {title}
          </h2>
          <IconButton icon="close" label="Close" size="sm" onClick={onClose} className="-mr-2 -mt-0.5" />
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-app-border bg-slate-50/70 px-5 py-3 dark:bg-slate-950/40">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
