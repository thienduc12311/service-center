import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { avatarColor, initials } from '../lib/format';
import { useErrorText } from '../i18n';
import { usePopupMenu } from '../hooks/usePopupMenu';
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

/** Which ends of a horizontally scrolling strip have content out of view. */
export interface ScrollOverflow {
  start: boolean;
  end: boolean;
}

const NO_OVERFLOW: ScrollOverflow = { start: false, end: false };

/** Fades a strip's hidden ends, so a clipped item reads as "scroll for more". */
export const overflowMask = ({ start, end }: ScrollOverflow): string | undefined =>
  start || end
    ? `linear-gradient(to right, ${start ? 'transparent, #000 2.5rem' : '#000'}, ${end ? '#000 calc(100% - 2.5rem), transparent' : '#000'})`
    : undefined;

/** Measures whether a horizontally scrolling element hides content past either end; re-measures when `itemCount` changes. */
const useScrollOverflow = (ref: RefObject<HTMLElement | null>, itemCount: number): ScrollOverflow => {
  const [overflow, setOverflow] = useState<ScrollOverflow>(NO_OVERFLOW);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const start = element.scrollLeft > 1;
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setOverflow((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [ref, itemCount]);
  return overflow;
};

/**
 * Underlined, horizontally scrolling tab strip for switching page sections.
 * When the tabs don't fit, each hidden end fades out (the scroll cue) and the
 * selected tab is scrolled into view.
 */
export function Tabs<T extends string>({ items, value, onChange, label, className = '' }: TabsProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const overflow = useScrollOverflow(ref, items.length);
  const mask = overflowMask(overflow);

  useLayoutEffect(() => {
    const strip = ref.current;
    const active = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !active) return;
    const bounds = strip.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    if (tab.left < bounds.left) strip.scrollLeft -= bounds.left - tab.left + 40;
    else if (tab.right > bounds.right) strip.scrollLeft += tab.right - bounds.right + 40;
  }, [value]);

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      data-overflow-start={overflow.start || undefined}
      data-overflow-end={overflow.end || undefined}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      className={`scrollbar-none -mx-1 flex gap-1 overflow-x-auto border-b border-app-border px-1 ${className}`}
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

export interface ErrorNoticeProps {
  error: unknown;
  /** Offers a "Try again" action, e.g. a failed list query's `refetch`. */
  onRetry?: () => void;
  /** Shows the retry action as busy (and disabled) while it runs. */
  retrying?: boolean;
}

/** Shows any thrown value as localized, user-safe text (never raw database/provider errors). */
export const ErrorNotice = ({ error, onRetry, retrying = false }: ErrorNoticeProps) => {
  const errorText = useErrorText();
  const { t } = useTranslation();
  if (!error) return null;
  const message = errorText(error);
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30"
    >
      <Icon name="alert" className="mt-px size-4" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry} className="-my-1">
          {t('actions.retry')}
        </Button>
      )}
    </div>
  );
};

/** The query fields `ListErrorNotice` reads; any TanStack Query result fits. */
export interface ListQueryState {
  error: unknown;
  data: unknown;
  isFetching: boolean;
  /** Offline: the request waits for the connection (TanStack `fetchStatus === 'paused'`). */
  isPaused: boolean;
  /** The rows shown belong to an earlier key (e.g. the previous search), kept while the new one loads. */
  isPlaceholderData: boolean;
  refetch: () => unknown;
}

/**
 * True when a list query is waiting for the connection and has nothing of its
 * own to show: no rows yet, or only the previous search's rows. TanStack
 * pauses (not fails) an offline fetch, so it has neither data nor an error.
 */
export const listOffline = (query: Pick<ListQueryState, 'data' | 'isPaused' | 'isPlaceholderData'>): boolean =>
  query.isPaused && (query.data === undefined || query.isPlaceholderData);

/**
 * True when a list did not load: it failed before it loaded any data, or it
 * is paused offline. Show `ListErrorNotice`, never the empty state.
 */
export const listFailed = (query: Pick<ListQueryState, 'error' | 'data' | 'isPaused' | 'isPlaceholderData'>): boolean =>
  (Boolean(query.error) && query.data === undefined) || listOffline(query);

/**
 * A list that did not load: the localized error (or an offline notice) plus
 * "Try again". Render it in place of the list's empty state, which would
 * otherwise claim there is nothing to show when the list simply did not load.
 * An offline list also loads by itself once the connection returns.
 */
export const ListErrorNotice = ({ query }: { query: ListQueryState }) => {
  const { t } = useTranslation();
  if (listOffline(query)) {
    return (
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25"
      >
        <Icon name="alert" className="mt-px size-4" />
        <span className="min-w-0 flex-1">{t('states.offlineList')}</span>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()} className="-my-1">
          {t('actions.retry')}
        </Button>
      </div>
    );
  }
  return <ErrorNotice error={query.error} retrying={query.isFetching} onRetry={() => void query.refetch()} />;
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

/**
 * How wide the dialog is. `wide` is for the two-pane dialogs, e.g. Sequence;
 * `side` is a full-height panel on the right (a bottom sheet on phones) for
 * reviewing one record beside the list it came from.
 */
type ModalSize = 'default' | 'wide' | 'side';

const MODAL_WIDTHS: Record<ModalSize, string> = {
  default: 'max-w-lg',
  wide: 'max-w-3xl',
  side: 'sm:max-w-md',
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',');

interface ModalStackEntry {
  dialog: HTMLDivElement | null;
  opener: HTMLElement | null;
}

const modalStack: ModalStackEntry[] = [];
let modalBodyOverflow: string | undefined;

const topModal = (): ModalStackEntry | undefined => modalStack.at(-1);

const isAvailableForFocus = (element: HTMLElement): boolean => {
  if (!element.isConnected || element.matches(':disabled') || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (getComputedStyle(element).visibility !== 'visible') return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (getComputedStyle(ancestor).display === 'none') return false;
  }
  return true;
};

const tabOrder = (element: HTMLElement): number => element.tabIndex || Number.POSITIVE_INFINITY;

export const tabbableElements = (dialog: HTMLElement): HTMLElement[] => {
  const candidates = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0 && isAvailableForFocus(element));

  return candidates.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || !element.name || element.checked) return true;
    return !candidates.some((other) =>
      other instanceof HTMLInputElement && other.type === 'radio' && other.checked
      && other.name === element.name && other.form === element.form
    );
  }).sort((a, b) => tabOrder(a) - tabOrder(b));
};

const focusInside = (dialog: HTMLDivElement): void => {
  (tabbableElements(dialog)[0] ?? dialog).focus({ preventScroll: true });
};

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
}

export const Modal = ({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'default',
}: ModalProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [activeEntry, setActiveEntry] = useState<ModalStackEntry | null>(null);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) {
      setActiveEntry(null);
      return;
    }

    // Register before mounting the children so their autoFocus can run
    // without the previous dialog pulling focus back.
    const entry: ModalStackEntry = {
      dialog: null,
      opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    modalStack.push(entry);

    if (modalStack.length === 1) {
      modalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    setActiveEntry(entry);

    const onKey = (event: KeyboardEvent) => {
      const dialog = entry.dialog;
      if (!dialog || topModal() !== entry || event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = tabbableElements(dialog);
      if (!elements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = elements[0];
      const last = elements.at(-1);
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first?.focus();
      }
    };

    const onFocus = (event: FocusEvent) => {
      const dialog = entry.dialog;
      if (!dialog || topModal() !== entry || dialog.contains(event.target as Node)) return;
      focusInside(dialog);
    };

    // Bubble like the previous Escape listener so an inner widget can consume
    // Escape first (for example, to close its own popup).
    window.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus, true);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus, true);

      const wasTopModal = topModal() === entry;
      const entryIndex = modalStack.indexOf(entry);
      if (entryIndex !== -1) modalStack.splice(entryIndex, 1);

      // If a parent modal disappears before a child, preserve the parent's
      // opener as the child's eventual restoration target.
      for (const remainingEntry of modalStack) {
        if (remainingEntry.opener && entry.dialog?.contains(remainingEntry.opener)) {
          remainingEntry.opener = entry.opener;
        }
      }

      if (!modalStack.length) {
        document.body.style.overflow = modalBodyOverflow ?? '';
        modalBodyOverflow = undefined;
      }

      if (!wasTopModal) return;
      const nextModal = topModal();
      const opener = entry.opener;
      if (opener && isAvailableForFocus(opener) && (!nextModal || nextModal.dialog?.contains(opener))) {
        opener.focus({ preventScroll: true });
      }
      if (nextModal?.dialog && !nextModal.dialog.contains(document.activeElement)) focusInside(nextModal.dialog);
    };
  }, [open]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!activeEntry || !dialog || !open) return;
    activeEntry.dialog = dialog;
    if (topModal() === activeEntry && !dialog.contains(document.activeElement)) focusInside(dialog);
  }, [activeEntry, open]);

  if (!open || !activeEntry) return null;
  return (
    <div
      className={`fixed inset-0 z-50 flex items-end p-0 ${
        size === 'side' ? 'sm:items-stretch sm:justify-end' : 'justify-center sm:items-center sm:p-4'
      }`}
    >
      <div
        className="animate-fade-in absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-app-border bg-app-surface
          shadow-2xl shadow-slate-950/20 ${
            size === 'side'
              ? 'animate-slide-in-right sm:max-h-none sm:rounded-none sm:border-y-0 sm:border-r-0'
              : 'animate-pop-in sm:max-h-[85vh] sm:rounded-2xl'
          } ${MODAL_WIDTHS[size]}`}
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

interface MenuProps {
  label: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  icon?: IconName;
}

/**
 * A small click-to-open menu following the W3C APG menu-button pattern
 * (see `usePopupMenu`): Enter/Space/arrows open it, arrows/Home/End move
 * between items, Escape closes and refocuses the trigger, Tab closes it.
 */
export const Menu = ({ label, children, align = 'right', icon }: MenuProps) => {
  const menu = usePopupMenu();
  const close = () => menu.close(true);

  return (
    <div {...menu.rootProps} className="relative">
      <button
        ref={menu.triggerRef}
        id={menu.triggerId}
        type="button"
        onClick={menu.toggle}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-controls={menu.open ? menu.menuId : undefined}
        className="button inline-flex h-9 items-center gap-1.5 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm shadow-slate-900/5
          ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500
          dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
      >
        {icon && <Icon name={icon} className="size-4" />}
        {label}
        <Icon name="chevronDown" className={`size-3.5 text-slate-400 transition ${menu.open ? 'rotate-180' : ''}`} />
      </button>

      {menu.open && (
        <div
          {...menu.menuProps}
          role="menu"
          className={`card animate-pop-in absolute z-50 mt-1.5 w-60 overflow-hidden p-1 text-sm shadow-lg shadow-slate-900/10 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children(close)}
        </div>
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
    tabIndex={-1}
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
