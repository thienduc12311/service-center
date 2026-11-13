import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface AuthLayoutProps {
  children: ReactNode;
  /** Shown in the top-right corner (e.g. the language switcher). */
  corner?: ReactNode;
  /** Hide the brand mark and app name above the card. */
  hideBrand?: boolean;
  /** Card width: `sm` for sign-in forms, `md` for richer standalone pages. */
  width?: 'sm' | 'md' | 'lg';
}

const WIDTHS: Record<NonNullable<AuthLayoutProps['width']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
};

/** The "SC" gradient logo mark used across the app shell and standalone pages. */
export const BrandMark = ({ size = 'md' }: BrandMarkProps) => (
  <span
    aria-hidden="true"
    className={`grid shrink-0 place-items-center bg-gradient-to-br from-brand-500 to-violet-700 font-bold text-white shadow-lg shadow-brand-600/30 ${
      size === 'lg' ? 'size-14 rounded-2xl text-lg' : 'size-11 rounded-xl text-base'
    }`}
  >
    SC
  </span>
);

export interface BrandMarkProps {
  size?: 'md' | 'lg';
}

/**
 * Full-page frame for screens shown outside the app shell (sign-in,
 * onboarding, invitations, public responses): a softly branded background
 * with the content centered in a single column.
 */
export const AuthLayout = ({ children, corner, hideBrand = false, width = 'sm' }: AuthLayoutProps) => {
  const { t } = useTranslation('common');
  return (
    <div className="relative isolate min-h-full overflow-hidden bg-app-canvas">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_32rem_at_50%_-10%,rgb(99_102_241/0.18),transparent_70%)] dark:bg-[radial-gradient(60rem_32rem_at_50%_-10%,rgb(99_102_241/0.22),transparent_70%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(30rem_20rem_at_100%_100%,rgb(139_92_246/0.10),transparent_70%)]"
      />
      {corner && <div className="absolute top-4 right-4 z-10">{corner}</div>}
      <div className={`mx-auto flex min-h-full w-full flex-col justify-center px-4 py-14 sm:py-20 ${WIDTHS[width]}`}>
        {!hideBrand && (
          <div className="mb-8 flex flex-col items-center text-center">
            <BrandMark size="lg" />
            <p className="mt-4 text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{t('app.name')}</p>
          </div>
        )}
        {children}
      </div>
    </div>
  );
};
