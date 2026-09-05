import type { AssignmentStatus, PlanStatus } from '@service-center/shared';

export const initials = (name: string | null | undefined, fallback = '?'): string => {
  if (!name?.trim()) return fallback;
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
};

export const assignmentTone: Record<AssignmentStatus, string> = {
  confirmed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  declined: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  unconfirmed: 'bg-amber-50 text-amber-700 ring-amber-600/20',
};

export const planTone: Record<PlanStatus, string> = {
  draft: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  published: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  archived: 'bg-slate-100 text-slate-400 ring-slate-400/20',
};

/** Deterministic colour per person, so avatars stay stable between renders. */
export const avatarColor = (seed: string): string => {
  const palette = [
    'bg-brand-100 text-brand-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-sky-100 text-sky-700',
    'bg-rose-100 text-rose-700',
    'bg-violet-100 text-violet-700',
  ];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length]!;
};
