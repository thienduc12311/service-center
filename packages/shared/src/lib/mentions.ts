/**
 * `@` mentions in discussion text (chat messages and item comments), shared by
 * the website and the native app. A mention is plain `@Full Name` text in the
 * body; the server separately stores who was mentioned. These helpers find the
 * `@query` being typed, filter the people it could mean, insert a pick, decide
 * which picks are still intact at send time, and split text for highlighting.
 */

/** Anything that can be mentioned: a person id and the name shown after `@`. */
export interface MentionTarget {
  person_id: string;
  name: string;
}

/** The `@query` the caret is in: `start` is the `@`, `end` is the caret. */
export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

/** Text after inserting a mention, and where the caret goes next. */
export interface MentionInsertion {
  text: string;
  caret: number;
}

/** Where one intact `@Name` sits in a text (`end` is exclusive). */
export interface MentionRange<T extends MentionTarget> {
  start: number;
  end: number;
  target: T;
}

export type MentionSegment<T extends MentionTarget> =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; target: T };

/** Longest `@query` considered (two long names and change). */
export const MENTION_QUERY_MAX = 60;
/** Rows a mention picker shows before it scrolls. */
export const MENTION_PICKER_ROWS = 6;

const isWhitespace = (char: string): boolean => /\s/.test(char);

/** Letters in any script and digits; cased letters cover Vietnamese. */
const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && (char.toLowerCase() !== char.toUpperCase() || /[0-9_]/.test(char));

/** Lower case without accents, so "nguyen" finds "Nguyễn" and "duc" finds "Đức". */
export const normalizeMentionText = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/**
 * The `@query` ending at `caret`, or null when the caret is not in one. The `@`
 * must start the text or follow whitespace (so `foo@bar.com` does not count),
 * and the query may hold spaces (full names) but no line break or second `@`.
 */
export const findMentionQuery = (text: string, caret: number): MentionQuery | null => {
  const end = Math.min(Math.max(caret, 0), text.length);
  for (let index = end - 1; index >= 0 && end - index <= MENTION_QUERY_MAX + 1; index -= 1) {
    const char = text[index]!;
    if (char === '\n' || char === '\r') return null;
    if (char !== '@') continue;
    const before = text[index - 1];
    if (before !== undefined && !isWhitespace(before)) return null;
    return { start: index, end, query: text.slice(index + 1, end) };
  }
  return null;
};

/**
 * Like `findMentionQuery`, but null once the caret is past a finished mention
 * (an already picked `@Name` followed by a space or punctuation), so the picker
 * closes after a pick instead of offering the same person again.
 */
export const activeMentionQuery = (text: string, caret: number, picked: readonly MentionTarget[]): MentionQuery | null => {
  const query = findMentionQuery(text, caret);
  if (!query) return null;
  const finished = picked.some((target) =>
    query.query.length > target.name.length
    && query.query.startsWith(target.name)
    && !isWordChar(query.query[target.name.length]));
  return finished ? null : query;
};

/**
 * The candidates a query could mean, best first: names that start with it, then
 * names with a later word that starts with it. An empty query matches everyone.
 */
export const filterMentionCandidates = <T extends MentionTarget>(candidates: readonly T[], query: string): T[] => {
  const wanted = normalizeMentionText(query).trim();
  if (!wanted) return [...candidates];
  const leading: T[] = [];
  const later: T[] = [];
  for (const candidate of candidates) {
    const name = normalizeMentionText(candidate.name);
    if (name.startsWith(wanted)) leading.push(candidate);
    else if (name.includes(` ${wanted}`)) later.push(candidate);
  }
  return [...leading, ...later];
};

/** Replaces the `@query` with `@Name ` and puts the caret after the space. */
export const insertMention = (text: string, query: MentionQuery, name: string): MentionInsertion => {
  const after = text.slice(query.end);
  const inserted = `@${name}${after.startsWith(' ') ? '' : ' '}`;
  const caret = query.start + inserted.length + (after.startsWith(' ') ? 1 : 0);
  return { text: `${text.slice(0, query.start)}${inserted}${after}`, caret };
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every intact `@Name` of the given targets, in order, without overlaps. The
 * `@` must not follow a letter or digit, and the name must not run on into one
 * (`@Ann` is not inside `@Anna`). Longer names win where names share a start.
 */
export const findMentionRanges = <T extends MentionTarget>(text: string, targets: readonly T[]): Array<MentionRange<T>> => {
  const byName = new Map<string, T>();
  for (const target of targets) if (target.name.trim() && !byName.has(target.name)) byName.set(target.name, target);
  if (byName.size === 0) return [];
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`@(${names.map(escapeRegExp).join('|')})`, 'g');
  const found: Array<MentionRange<T>> = [];
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    if (isWordChar(text[start - 1]) || isWordChar(text[end])) {
      pattern.lastIndex = start + 1;
      continue;
    }
    found.push({ start, end, target: byName.get(match[1]!)! });
  }
  return found;
};

/** Ids of the picked people whose `@Name` is still intact in the text, once each. */
export const resolveMentionIds = (text: string, picked: readonly MentionTarget[]): string[] =>
  [...new Set(findMentionRanges(text, picked).map((mention) => mention.target.person_id))];

/** The text cut into plain runs and `@Name` runs of the given targets. */
export const splitMentions = <T extends MentionTarget>(text: string, targets: readonly T[]): Array<MentionSegment<T>> => {
  const segments: Array<MentionSegment<T>> = [];
  let cursor = 0;
  for (const mention of findMentionRanges(text, targets)) {
    if (mention.start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, mention.start) });
    segments.push({ kind: 'mention', text: text.slice(mention.start, mention.end), target: mention.target });
    cursor = mention.end;
  }
  if (cursor < text.length || segments.length === 0) segments.push({ kind: 'text', text: text.slice(cursor) });
  return segments;
};
