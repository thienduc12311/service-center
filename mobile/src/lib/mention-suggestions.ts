import { filterMentionCandidates, type MentionCandidate } from '@service-center/shared';

/** People offered for an empty `@` (before any letters are typed). */
export const MENTION_SUGGESTION_LIMIT = 20;

/**
 * The people an `@query` offers. Typed letters filter every candidate (best
 * match first, as the website does). An empty `@` offers at most
 * `MENTION_SUGGESTION_LIMIT` people, those in `priorityIds` first (in that
 * order: e.g. who spoke most recently in this conversation), then the rest
 * in their given order — typing a letter or two reaches anyone else.
 */
export const mentionSuggestions = (
  candidates: readonly MentionCandidate[],
  query: string,
  priorityIds: readonly string[] = [],
  limit: number = MENTION_SUGGESTION_LIMIT,
): MentionCandidate[] => {
  if (query.trim()) return filterMentionCandidates(candidates, query);
  const byId = new Map(candidates.map((candidate) => [candidate.person_id, candidate]));
  const first = [...new Set(priorityIds)].flatMap((id) => {
    const candidate = byId.get(id);
    return candidate ? [candidate] : [];
  });
  const firstIds = new Set(first.map((candidate) => candidate.person_id));
  return [...first, ...candidates.filter((candidate) => !firstIds.has(candidate.person_id))].slice(0, limit);
};

/** Authors of `messages`, most recent first, once each (messages are oldest first, as a thread shows them). */
export const recentAuthorIds = (messages: readonly { author_person_id: string | null }[]): string[] => {
  const ids: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const id = messages[index]?.author_person_id;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
};
