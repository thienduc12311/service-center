import type {
  CreateGuestInput,
  IdentityReconciliation,
  PersonIdentityReconciliationRow,
  RosterPerson,
  GlobalSearchGroup,
  GlobalSearchHit,
  GlobalSearchKind,
  PersonRosterEvent,
  PersonRosterEventRow,
  PersonTagCatalogRow,
  PersonTagGroupRow,
  RosterBulkPreview,
  RosterBulkPreviewRow,
  RosterTagCatalog,
} from '@service-center/shared';

/** Counts the preview rows the client must review before applying. */
export const summarizeBulkPreview = (rows: readonly RosterBulkPreviewRow[]): RosterBulkPreview => ({
  rows: [...rows],
  changes: rows.filter((row) => row.outcome === 'change').length,
  unchanged: rows.filter((row) => row.outcome === 'unchanged').length,
  errors: rows.filter((row) => row.outcome === 'error').length,
});

/**
 * Every tag in use plus every catalogued tag, with its group and how many
 * people carry it. A catalogued tag nobody carries yet still appears (0).
 */
export const buildTagCatalog = (
  groups: readonly PersonTagGroupRow[],
  catalog: readonly Pick<PersonTagCatalogRow, 'tag' | 'group_id'>[],
  usedTags: readonly string[],
): RosterTagCatalog => {
  const counts = new Map<string, number>();
  for (const tag of usedTags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const groupOf = new Map(catalog.map((entry) => [entry.tag, entry.group_id]));
  const tags = [...new Set([...counts.keys(), ...groupOf.keys()])]
    .sort((a, b) => a.localeCompare(b))
    .map((tag) => ({ tag, group_id: groupOf.get(tag) ?? null, people: counts.get(tag) ?? 0 }));
  return {
    groups: [...groups].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    tags,
  };
};

export const withActorNames = (
  rows: readonly PersonRosterEventRow[],
  names: ReadonlyMap<string, string | null>,
): PersonRosterEvent[] =>
  rows.map((row) => ({ ...row, actor_name: row.actor_id ? (names.get(row.actor_id) ?? null) : null }));

/**
 * Escapes PostgREST `ilike` wildcards and the characters that would break an
 * `or=(...)` filter, so a query is always matched literally.
 */
export const searchPattern = (query: string): string =>
  `%${query.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()"]/g, ' ').trim()}%`;

/**
 * Returns at most `limit` hits and says whether more visible matches exist.
 * Callers fetch `limit + 1` rows through the caller's own RLS, so neither the
 * hits nor `has_more` can reflect records the caller cannot open.
 */
export const toSearchGroup = (kind: GlobalSearchKind, hits: readonly GlobalSearchHit[], limit: number): GlobalSearchGroup => ({
  kind,
  hits: hits.slice(0, limit),
  has_more: hits.length > limit,
});

/** The roster entry for a guest just created from the scheduler. */
export const guestRosterPerson = (id: string, input: CreateGuestInput): RosterPerson => ({
  id,
  person_id: id,
  profile_id: null,
  has_login: false,
  full_name: [input.first_name, input.last_name].filter(Boolean).join(' '),
  email: input.email ?? null,
  phone: null,
  avatar_url: null,
  role: null,
  status: 'no_account',
  campus: null,
  invite_pending: false,
  archived: false,
});

export const withReconciliationNames = (
  rows: readonly PersonIdentityReconciliationRow[],
  names: ReadonlyMap<string, string>,
): IdentityReconciliation[] =>
  rows.map((row) => ({
    ...row,
    person_name: names.get(row.person_id) ?? 'Removed person',
    candidate_name: names.get(row.candidate_person_id) ?? 'Removed person',
  }));
