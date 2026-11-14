import type { OrgRole } from '@service-center/shared';

/** Badge colours per church role, shared by the access list and panel. */
export const ROLE_TONES: Record<OrgRole, string> = {
  owner: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300',
  admin: 'bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-500/10 dark:text-brand-200',
  scheduler: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300',
  member: 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300',
};
