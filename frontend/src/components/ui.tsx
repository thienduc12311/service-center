import { useEffect, useId, useState } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { avatarColor, initials } from '../lib/format';
import { useErrorText } from '../i18n';
import { Icon, type IconName } from './icons';

/* -------------------------------------------------------------------------
 * Actions
 * ---------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

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
  children,
  ...props
}: ButtonProps) => (
  <button
    {...props}
    disabled={props.disabled || loading}
    className={`button inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium
      outline-offset-2 transition focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50
      ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
  >
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

/** A square, borderless target for a single glyph (toolbars, row actions). */
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

export const Spinner = ({ className = 'size-5' }: { className?: string }) => (
  <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
  </svg>
);

/* -------------------------------------------------------------------------
 * Data display
 * ---------------------------------------------------------------------- */

export const Badge = ({ tone, children }: { tone: string; children: ReactNode }) => (
  <span
    className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}
  >
    {children}
  </span>
);

export const Avatar = ({
  name,
  url,
  size = 'md',
}: {
  name: string | null | undefined;
  url?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) => {
  const dimensions = { sm: 'size-7 text-xs', md: 'size-9 text-sm', lg: 'size-12 text-base' }[size];
  if (url) {
    return (
      <img
        src={url}
        alt={name ?? ''}
        className={`${dimensions} shrink-0 rounded-full object-cover ring-2 ring-white dark:ring-slate-900`}
      />
    );
  }
  return (
    <span
      className={`${dimensions} ${avatarColor(name ?? '?')} inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-2 ring-white dark:ring-slate-900`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
};

export interface DateTileProps {
  /** ISO instant or date. */
  value: string;
  /** Muted styling, for past dates. */
  muted?: boolean;
  className?: string;
}

/** A calendar-page tile (month over day) that anchors a dated row or card. */
export const DateTile = ({ value, muted = false, className = '' }: DateTileProps) => {
  const { i18n } = useTranslation();
  const date = new Date(value);
  const month = new Intl.DateTimeFormat(i18n.language, { month: 'short' }).format(date);
  const day = new Intl.DateTimeFormat(i18n.language, { day: 'numeric' }).format(date);
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(date);
  return (
    <div
      aria-hidden="true"
      className={`flex w-14 shrink-0 flex-col items-center overflow-hidden rounded-xl text-center ring-1 ring-inset ${
        muted
          ? 'bg-slate-50 ring-slate-200 dark:bg-slate-800/50 dark:ring-slate-700'
          : 'bg-brand-50 ring-brand-100 dark:bg-brand-500/10 dark:ring-brand-500/25'
      } ${className}`}
    >
      <span
        className={`w-full py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
          muted ? 'bg-slate-200/70 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300' : 'bg-brand-600 text-white'
        }`}
      >
        {month}
      </span>
      <span
        className={`pt-1 text-xl leading-none font-semibold tabular-nums ${
          muted ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white'
        }`}
      >
        {day}
      </span>
      <span className="pb-1.5 pt-0.5 text-[10px] font-medium uppercase text-slate-500 dark:text-slate-400">{weekday}</span>
    </div>
  );
};

type StatTone = 'brand' | 'green' | 'amber' | 'rose' | 'slate';

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
  /** Short supporting copy under the value. */
  hint?: ReactNode;
  /** Makes the whole tile a link. */
  to?: string;
}

/** A headline number with its label, for dashboard and report summaries. */
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

/* -------------------------------------------------------------------------
 * Structure
 * ---------------------------------------------------------------------- */

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Small context line above the title (a section or count). */
  eyebrow?: ReactNode;
  /** A "back" link shown above the title, for detail pages. */
  back?: { to: string; label: string };
}

export const PageHeader = ({ title, subtitle, actions, eyebrow, back }: PageHeaderProps) => (
  <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 sm:mb-8">
    <div className="min-w-0 max-w-3xl">
      {back && (
        <Link
          to={back.to}
          className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-brand-700 dark:text-slate-400 dark:hover:text-brand-200"
        >
          <Icon name="chevronLeft" className="size-4" />
          {back.label}
        </Link>
      )}
      {eyebrow && <p className="section-label mb-1.5 text-brand-600 dark:text-brand-200">{eyebrow}</p>}
      <h1 className="text-2xl font-semibold tracking-tight text-balance text-slate-900 sm:text-[28px] sm:leading-9 dark:text-white">
        {title}
      </h1>
      {subtitle && <p className="mt-1.5 text-sm text-pretty text-slate-500 sm:text-[15px] dark:text-slate-400">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

export interface SectionHeaderProps {
  title: string;
  /** A count or short note beside the title. */
  meta?: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
}

/** Heading for a block of cards or rows within a page. */
export const SectionHeader = ({ title, meta, action, id, className = '' }: SectionHeaderProps) => (
  <div className={`mb-3 flex min-h-8 items-center justify-between gap-3 ${className}`}>
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

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Inner padding: `none` for cards that are a list of rows. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const CARD_PADDING: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export const Card = ({ padding = 'md', className = '', ...props }: CardProps) => (
  <div {...props} className={`card ${CARD_PADDING[padding]} ${className}`} />
);

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional count shown after the label. */
  count?: number;
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

/** Underlined, horizontally scrolling tab strip for switching page sections. */
export function Tabs<T extends string>({ items, value, onChange, label, className = '' }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`scrollbar-thin -mx-1 flex gap-1 overflow-x-auto border-b border-app-border px-1 ${className}`}
    >
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

export interface SegmentedProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

/** Pill-style switch for a small set of mutually exclusive filters. */
export function Segmented<T extends string>({ items, value, onChange, label, className = '' }: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex rounded-xl bg-slate-100 p-1 ring-1 ring-inset ring-slate-200/60 dark:bg-slate-800/70 dark:ring-slate-700/60 ${className}`}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(item.value)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition
              focus-visible:outline-2 focus-visible:outline-brand-500 ${
                active
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
          >
            {item.label}
            {item.count !== undefined && <span className="text-xs text-slate-400 tabular-nums">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * States
 * ---------------------------------------------------------------------- */

export const EmptyState = ({
  title,
  description,
  action,
  icon = 'sparkle',
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: IconName;
  /** Smaller, borderless variant for use inside an existing card. */
  compact?: boolean;
}) => (
  <div
    className={`flex flex-col items-center text-center ${
      compact ? 'gap-1.5 px-4 py-8' : 'card gap-2 border-dashed px-6 py-14'
    }`}
  >
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

/** Shows any thrown value as localized, user-safe text (never raw database/provider errors). */
export const ErrorNotice = ({ error }: { error: unknown }) => {
  const errorText = useErrorText();
  if (!error) return null;
  const message = errorText(error);
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30"
    >
      <Icon name="alert" className="mt-px size-4" />
      <span className="min-w-0">{message}</span>
    </div>
  );
};

type NoticeTone = 'info' | 'warning' | 'success';

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

/** An inline callout for non-error guidance or warnings. */
export const Notice = ({
  tone = 'info',
  children,
  className = '',
}: {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
}) => (
  <div
    role={tone === 'warning' ? 'alert' : 'status'}
    className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${NOTICE_TONES[tone].box} ${className}`}
  >
    <Icon name={NOTICE_TONES[tone].icon} className="mt-px size-4" />
    <div className="min-w-0">{children}</div>
  </div>
);

export const Loading = ({ label }: { label?: string }) => {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-slate-400">
      <Spinner />
      <span className="text-sm">{label ?? t('states.loading')}</span>
    </div>
  );
};

/** Placeholder rows shown while a list loads, so the layout doesn't jump. */
export const SkeletonList = ({ rows = 3 }: { rows?: number }) => {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('states.loading')} className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="card flex animate-pulse items-center gap-4 p-4">
          <div className="size-12 rounded-xl bg-slate-100 dark:bg-slate-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/3 rounded bg-slate-100 dark:bg-slate-800" />
            <div className="h-3 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
          </div>
        </div>
      ))}
    </div>
  );
};

/* -------------------------------------------------------------------------
 * Overlays
 * ---------------------------------------------------------------------- */

/** How wide the dialog is. `wide` is for the two-pane dialogs, e.g. Sequence. */
type ModalSize = 'default' | 'wide';

const MODAL_WIDTHS: Record<ModalSize, string> = {
  default: 'max-w-lg',
  wide: 'max-w-3xl',
};

export const Modal = ({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'default',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
}) => {
  const { t } = useTranslation();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="animate-fade-in absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`animate-pop-in relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-app-border bg-app-surface
          shadow-2xl shadow-slate-950/20 sm:max-h-[85vh] sm:rounded-2xl ${MODAL_WIDTHS[size]}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-app-border px-6 pt-5 pb-4">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {title}
          </h2>
          <IconButton icon="close" label={t('actions.close')} size="sm" onClick={onClose} className="-mr-2 -mt-1" />
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-app-border bg-slate-50/70 px-6 py-4 dark:bg-slate-950/40">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * A small click-to-open menu. The invisible backdrop is what closes it, so a
 * click anywhere else dismisses the menu without every caller wiring up its
 * own document listener.
 */
export const Menu = ({
  label,
  children,
  align = 'right',
  icon,
}: {
  label: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  icon?: IconName;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="button inline-flex h-9 items-center gap-1.5 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm shadow-slate-900/5
          ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500
          dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
      >
        {icon && <Icon name={icon} className="size-4" />}
        {label}
        <Icon name="chevronDown" className={`size-3.5 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label={t('actions.closeMenu')}
            className="fixed inset-0 z-40 cursor-default"
            onClick={close}
          />
          <div
            role="menu"
            className={`card animate-pop-in absolute z-50 mt-1.5 w-60 overflow-hidden p-1 text-sm shadow-lg shadow-slate-900/10 ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            {children(close)}
          </div>
        </>
      )}
    </div>
  );
};

export const MenuItem = ({
  onClick,
  disabled = false,
  tone = 'default',
  icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  icon?: IconName;
  children: ReactNode;
}) => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    onClick={onClick}
    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
      tone === 'danger'
        ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10'
        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
    }`}
  >
    {icon && <Icon name={icon} className="size-4 text-current opacity-70" />}
    {children}
  </button>
);

/** A labelled divider between groups of menu items. */
export const MenuSection = ({ label }: { label: string }) => (
  <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
);
