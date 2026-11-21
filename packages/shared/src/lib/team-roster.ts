import type { TeamRosterPerson } from '../types/domain.js';

/** One displayable line of a roster row, in the order they are shown. */
export interface RosterDetailLine {
  kind: 'email' | 'phone' | 'birthday';
  value: string;
  /** `mailto:` / `tel:` target for tappable lines. */
  href: string | null;
}

/** Name when known, else email, else null (callers pick their own fallback). */
export const rosterDisplayName = (profile: TeamRosterPerson | null | undefined): string | null =>
  profile?.full_name?.trim() || profile?.email?.trim() || null;

/** Formats a `YYYY-MM-DD` date of birth in the viewer's locale; no timezone shift. */
export const formatDateOfBirth = (value: string | null | undefined, locale?: string): string | null => {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
};

/** Email, phone and date of birth lines for a roster row; absent fields are omitted. */
export const rosterDetailLines = (
  profile: TeamRosterPerson | null | undefined,
  locale?: string,
): RosterDetailLine[] => {
  if (!profile) return [];
  const lines: RosterDetailLine[] = [];
  const email = profile.email?.trim();
  const phone = profile.phone?.trim();
  const birthday = formatDateOfBirth(profile.date_of_birth, locale);
  if (email) lines.push({ kind: 'email', value: email, href: `mailto:${email}` });
  if (phone) lines.push({ kind: 'phone', value: phone, href: `tel:${phone.replace(/[^\d+]/g, '')}` });
  if (birthday) lines.push({ kind: 'birthday', value: birthday, href: null });
  return lines;
};
