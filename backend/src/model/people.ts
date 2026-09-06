import type {
  MemberStatus,
  OrgRole,
  OrganizationMemberRow,
  PersonDetail,
  PersonInvitationRow,
  PersonRow,
  ProfileRow,
  RosterPerson,
} from '@service-center/shared';

/** An active `organization_members` row joined to its `profiles` row. */
export interface ActiveMemberRow {
  role: OrgRole;
  status: MemberStatus;
  profile: ProfileRow;
}

export const personDisplayName = (person: Pick<PersonRow, 'first_name' | 'last_name'>): string =>
  [person.first_name, person.last_name].filter(Boolean).join(' ');

/**
 * Unifies today's has-login members with no-login roster entries, without a
 * backfill migration: a `people` row enriches the matching active member
 * when its `profile_id` is linked, or stands alone when it isn't. A `people`
 * row whose `profile_id` no longer matches an active member (e.g. removed)
 * is dropped, matching the existing silent exclusion of inactive members.
 */
export const mergeRoster = (
  members: ActiveMemberRow[],
  people: PersonRow[],
  pendingInvitations: Array<Pick<PersonInvitationRow, 'person_id'>>,
): RosterPerson[] => {
  const peopleByProfileId = new Map(
    people.filter((p): p is PersonRow & { profile_id: string } => p.profile_id !== null).map((p) => [p.profile_id, p]),
  );
  const pendingPersonIds = new Set(pendingInvitations.map((invitation) => invitation.person_id));

  const linked: RosterPerson[] = members
    .filter((member) => member.profile)
    .map((member) => {
      const person = peopleByProfileId.get(member.profile.id) ?? null;
      return {
        id: member.profile.id,
        person_id: person?.id ?? null,
        profile_id: member.profile.id,
        has_login: true,
        full_name: member.profile.full_name,
        email: member.profile.email,
        phone: member.profile.phone,
        avatar_url: member.profile.avatar_url,
        role: member.role,
        status: member.status,
        campus: person?.campus ?? null,
        invite_pending: false,
      };
    });

  const standalone: RosterPerson[] = people
    .filter((person) => person.profile_id === null)
    .map((person) => ({
      id: person.id,
      person_id: person.id,
      profile_id: null,
      has_login: false,
      full_name: personDisplayName(person),
      email: person.email,
      phone: person.phone,
      avatar_url: person.avatar_url,
      role: null,
      status: 'no_account' as const,
      campus: person.campus,
      invite_pending: pendingPersonIds.has(person.id),
    }));

  return [...linked, ...standalone].sort((a, b) =>
    (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? ''),
  );
};

export const toPersonDetail = (
  person: PersonRow,
  profile: ProfileRow | null,
  membership: Pick<OrganizationMemberRow, 'role' | 'status'> | null,
  pendingInvitation: Pick<PersonInvitationRow, 'id' | 'email' | 'role' | 'expires_at'> | null,
  redactMedicalNote: boolean,
): PersonDetail => ({
  ...person,
  medical_note: redactMedicalNote ? null : person.medical_note,
  profile,
  membership,
  pending_invitation: pendingInvitation,
});

/** Best-effort split for converting a legacy `profiles.full_name` into first/last. */
export const splitFullName = (fullName: string | null): { first_name: string; last_name: string | null } => {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return { first_name: 'Unnamed', last_name: null };
  const [first = trimmed, ...rest] = trimmed.split(/\s+/);
  return { first_name: first, last_name: rest.length ? rest.join(' ') : null };
};
