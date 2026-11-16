import type { ReactNode } from 'react';

export interface AuthLayoutProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}

/** The centred card used by sign-in, two-factor and "not authorized". */
export const AuthLayout = ({ title, subtitle, children }: AuthLayoutProps) => (
  <main className="flex min-h-full flex-col items-center justify-center px-4 py-10">
    <div className="mb-6 flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-9 rounded-xl" />
      <div className="leading-tight">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">Service Center</p>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Platform admin</p>
      </div>
    </div>
    <div className="card w-full max-w-sm p-6">
      <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h1>
      {subtitle && <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</div>}
      <div className="mt-5">{children}</div>
    </div>
  </main>
);
