import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { avatarColor, initials } from '../lib/format';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600',
  secondary: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
};

export const Button = ({
  variant = 'primary',
  className = '',
  loading = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) => (
  <button
    {...props}
    disabled={props.disabled || loading}
    className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium
      transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
  >
    {loading && <Spinner className="size-4" />}
    {children}
  </button>
);

export const Spinner = ({ className = 'size-5' }: { className?: string }) => (
  <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
  </svg>
);

export const Badge = ({ tone, children }: { tone: string; children: ReactNode }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
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
    return <img src={url} alt={name ?? ''} className={`${dimensions} rounded-full object-cover`} />;
  }
  return (
    <span
      className={`${dimensions} ${avatarColor(name ?? '?')} inline-flex shrink-0 items-center justify-center rounded-full font-semibold`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
};

export const PageHeader = ({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) => (
  <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </header>
);

export const EmptyState = ({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) => (
  <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
    <p className="font-medium text-slate-800">{title}</p>
    {description && <p className="max-w-md text-sm text-slate-500">{description}</p>}
    {action && <div className="mt-3">{action}</div>}
  </div>
);

export const ErrorNotice = ({ error }: { error: unknown }) => {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-600/20">
      {message}
    </div>
  );
};

export const Loading = ({ label = 'Loading…' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
    <Spinner />
    <span className="text-sm">{label}</span>
  </div>
);

export const Modal = ({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card relative z-10 max-h-[85vh] w-full max-w-lg overflow-y-auto p-6"
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900">{title}</h2>
        {children}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};
