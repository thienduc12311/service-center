import type { AdminCreateChurchRequest } from '@service-center/shared';

/** The "New church" form as typed: all text until it is sent. */
export interface CreateChurchDraft {
  name: string;
  slug: string;
  /** False until the admin edits the slug; until then it follows the name. */
  slugEdited: boolean;
  timezone: string;
  owner_email: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state_province: string;
  postal_code: string;
  country: string;
  member_count: string;
}

export const emptyCreateChurchDraft = (timezone: string): CreateChurchDraft => ({
  name: '',
  slug: '',
  slugEdited: false,
  timezone,
  owner_email: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state_province: '',
  postal_code: '',
  country: '',
  member_count: '',
});

/** Blank optional fields go as null; an unparseable member count is sent as typed so the schema reports it. */
export const createChurchRequestFrom = (draft: CreateChurchDraft): AdminCreateChurchRequest => {
  const optional = (value: string): string | null => (value.trim() ? value.trim() : null);
  const count = draft.member_count.trim();
  return {
    name: draft.name.trim(),
    slug: draft.slug.trim(),
    timezone: draft.timezone,
    owner_email: draft.owner_email.trim(),
    address_line1: optional(draft.address_line1),
    address_line2: optional(draft.address_line2),
    city: optional(draft.city),
    state_province: optional(draft.state_province),
    postal_code: optional(draft.postal_code),
    country: optional(draft.country),
    member_count: count ? Number(count) : null,
  };
};
