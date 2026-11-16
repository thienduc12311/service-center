/**
 * Church applications as both clients show them: which state the applicant
 * is in, and the form's editable draft. See docs/plans/super-admin-dashboard.md.
 */
import type { ChurchApplication } from '../types/platform-admin.js';
import type { SubmitChurchApplicationRequest } from '../schemas/platform-admin.js';

/** What the applicant sees, from their applications (newest first). */
export type ChurchApplicationView =
  | { kind: 'form'; prefill: ChurchApplication | null }
  | { kind: 'pending'; application: ChurchApplication }
  | { kind: 'rejected'; application: ChurchApplication }
  | { kind: 'approved'; application: ChurchApplication };

/**
 * A pending request always wins. Otherwise the newest decision is shown:
 * a rejection (with its reason, and the form prefilled to try again), or an
 * approval while the person has no church yet. Anything else is a blank form.
 */
export const churchApplicationView = (
  applications: readonly ChurchApplication[],
  options: { hasChurch: boolean },
): ChurchApplicationView => {
  const pending = applications.find((application) => application.status === 'pending');
  if (pending) return { kind: 'pending', application: pending };
  const newest = applications[0];
  if (newest?.status === 'rejected') return { kind: 'rejected', application: newest };
  if (newest?.status === 'approved' && !options.hasChurch) return { kind: 'approved', application: newest };
  return { kind: 'form', prefill: null };
};

/** The form's values as typed: every field is text until it is sent. */
export interface ChurchApplicationDraft {
  church_name: string;
  leader_name: string;
  contact_phone: string;
  website: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state_province: string;
  postal_code: string;
  country: string;
  expected_member_count: string;
  timezone: string;
  note: string;
}

export const emptyChurchApplicationDraft = (timezone: string): ChurchApplicationDraft => ({
  church_name: '',
  leader_name: '',
  contact_phone: '',
  website: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state_province: '',
  postal_code: '',
  country: '',
  expected_member_count: '',
  timezone,
  note: '',
});

export const churchApplicationDraftFrom = (application: ChurchApplication): ChurchApplicationDraft => ({
  church_name: application.church_name,
  leader_name: application.leader_name,
  contact_phone: application.contact_phone ?? '',
  website: application.website ?? '',
  address_line1: application.address_line1 ?? '',
  address_line2: application.address_line2 ?? '',
  city: application.city,
  state_province: application.state_province ?? '',
  postal_code: application.postal_code ?? '',
  country: application.country,
  expected_member_count: application.expected_member_count === null ? '' : String(application.expected_member_count),
  timezone: application.timezone,
  note: application.note ?? '',
});

/** Blank optional fields are sent as null; the server trims and validates again. */
export const churchApplicationRequestFrom = (draft: ChurchApplicationDraft): SubmitChurchApplicationRequest => {
  const optional = (value: string): string | null => (value.trim() ? value.trim() : null);
  const count = draft.expected_member_count.trim();
  return {
    church_name: draft.church_name.trim(),
    leader_name: draft.leader_name.trim(),
    contact_phone: optional(draft.contact_phone),
    website: optional(draft.website),
    address_line1: optional(draft.address_line1),
    address_line2: optional(draft.address_line2),
    city: draft.city.trim(),
    state_province: optional(draft.state_province),
    postal_code: optional(draft.postal_code),
    country: draft.country.trim(),
    expected_member_count: count && Number.isFinite(Number(count)) ? Math.max(0, Math.trunc(Number(count))) : null,
    timezone: draft.timezone.trim(),
    note: optional(draft.note),
  };
};

/** At or past this share of the quota, owners and admins see a warning. */
export const storageQuotaState = (fractionUsed: number, warningFraction: number): 'ok' | 'warning' | 'full' =>
  fractionUsed >= 1 ? 'full' : fractionUsed >= warningFraction ? 'warning' : 'ok';
