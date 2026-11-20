import { findMentionRanges, type MentionTarget } from './mentions.js';

/**
 * Light formatting for discussion text (chat messages and item comments),
 * shared by the website and the native app: `**bold**`, `*italic*` or
 * `_italic_`, `~~strike~~`, `` `code` `` and bare http(s) links, alongside
 * `@Name` mentions. The text is only cut into styled runs; nothing is ever
 * interpreted as HTML, so typed markup such as `<b>` stays literal text.
 * Formatting never crosses a line break, and unmatched markers stay as typed.
 */

export interface MessageTextStyle {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
}

export type MessageRun<T extends MentionTarget> =
  | { kind: 'text'; text: string; style: MessageTextStyle }
  | { kind: 'mention'; text: string; target: T; style: MessageTextStyle }
  | { kind: 'link'; text: string; href: string; style: MessageTextStyle };

type Marker = '**' | '*' | '_' | '~~';
type ToggledStyle = 'bold' | 'italic' | 'strike';

const MARKER_STYLE: Record<Marker, ToggledStyle> = { '**': 'bold', '*': 'italic', _: 'italic', '~~': 'strike' };

/** Something formatting cannot reach into: a code span, a mention or a link. */
type Atom<T extends MentionTarget> =
  | { kind: 'code'; start: number; end: number; text: string }
  | { kind: 'mention'; start: number; end: number; text: string; target: T }
  | { kind: 'link'; start: number; end: number; text: string };

interface Delimiter {
  kind: 'delimiter';
  marker: Marker;
  canOpen: boolean;
  canClose: boolean;
  /** Set when paired: `open` turns the style on here, `close` turns it off. */
  role?: 'open' | 'close';
}

type Piece<T extends MentionTarget> = { kind: 'plain'; text: string } | Delimiter | Atom<T>;

const PLAIN: MessageTextStyle = { bold: false, italic: false, strike: false, code: false };

const isSpace = (char: string | undefined): boolean => char === undefined || /\s/.test(char);
/** Letters in any script and digits, so `snake_case` is not italic. */
const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && (char.toLowerCase() !== char.toUpperCase() || /[0-9]/.test(char));

const LINK = /https?:\/\/[^\s<>]+/g;
/** Trailing characters that usually end a sentence (or a marker), not the link. */
const LINK_TAIL = /[.,;:!?'"*_~]+$/;

const trimLink = (url: string): string => {
  let trimmed = url.replace(LINK_TAIL, '');
  // Keep a closing parenthesis only when the link opened one, e.g. a Wikipedia URL.
  while (trimmed.endsWith(')') && (trimmed.match(/\(/g)?.length ?? 0) < (trimmed.match(/\)/g)?.length ?? 0)) {
    trimmed = trimmed.slice(0, -1).replace(LINK_TAIL, '');
  }
  return trimmed;
};

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean =>
  a.start < b.end && b.start < a.end;

/** Code spans first, then mentions and links outside them, in order and without overlaps. */
const findAtoms = <T extends MentionTarget>(line: string, mentions: readonly T[]): Array<Atom<T>> => {
  const atoms: Array<Atom<T>> = [];
  for (const match of line.matchAll(/`([^`]+)`/g)) {
    atoms.push({ kind: 'code', start: match.index, end: match.index + match[0].length, text: match[1]! });
  }
  const free = (range: { start: number; end: number }) => !atoms.some((atom) => overlaps(atom, range));
  for (const range of findMentionRanges(line, mentions)) {
    if (free(range)) atoms.push({ kind: 'mention', ...range, text: line.slice(range.start, range.end) });
  }
  for (const match of line.matchAll(LINK)) {
    if (isWordChar(line[match.index - 1])) continue;
    const text = trimLink(match[0]);
    const range = { start: match.index, end: match.index + text.length };
    if (text.length > 'https://'.length && free(range)) atoms.push({ kind: 'link', ...range, text });
  }
  return atoms.sort((a, b) => a.start - b.start);
};

const markerAt = (line: string, index: number): Marker | null => {
  if (line.startsWith('**', index)) return '**';
  if (line.startsWith('~~', index)) return '~~';
  const char = line[index];
  return char === '*' || char === '_' ? char : null;
};

/** Plain text between atoms, cut into text and candidate delimiters. */
const scanPlain = <T extends MentionTarget>(line: string, start: number, end: number, pieces: Array<Piece<T>>): void => {
  let text = '';
  for (let index = start; index < end;) {
    const marker = markerAt(line, index);
    if (!marker || index + marker.length > end) {
      text += line[index];
      index += 1;
      continue;
    }
    if (text) pieces.push({ kind: 'plain', text });
    text = '';
    const before = line[index - 1];
    const after = line[index + marker.length];
    const intraword = marker === '_';
    pieces.push({
      kind: 'delimiter',
      marker,
      canOpen: !isSpace(after) && !(intraword && isWordChar(before)),
      canClose: !isSpace(before) && !(intraword && isWordChar(after)),
    });
    index += marker.length;
  }
  if (text) pieces.push({ kind: 'plain', text });
};

/** Pairs each closer with the nearest same-marker opener; openers left inside the pair stay literal. */
const pairDelimiters = <T extends MentionTarget>(pieces: Array<Piece<T>>): void => {
  const open: number[] = [];
  pieces.forEach((piece, index) => {
    if (piece.kind !== 'delimiter') return;
    if (piece.canClose) {
      let at = open.length - 1;
      while (at >= 0 && (pieces[open[at]!] as Delimiter).marker !== piece.marker) at -= 1;
      const opener = at === -1 ? undefined : open[at];
      if (opener !== undefined && opener < index - 1) {
        (pieces[opener] as Delimiter).role = 'open';
        piece.role = 'close';
        open.splice(at);
        return;
      }
    }
    if (piece.canOpen) open.push(index);
  });
};

const sameStyle = (a: MessageTextStyle, b: MessageTextStyle): boolean =>
  a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.code === b.code;

const pushText = <T extends MentionTarget>(runs: Array<MessageRun<T>>, text: string, style: MessageTextStyle): void => {
  const last = runs[runs.length - 1];
  if (last?.kind === 'text' && sameStyle(last.style, style)) last.text += text;
  else runs.push({ kind: 'text', text, style });
};

const formatLine = <T extends MentionTarget>(line: string, mentions: readonly T[], runs: Array<MessageRun<T>>): void => {
  const pieces: Array<Piece<T>> = [];
  let cursor = 0;
  for (const atom of findAtoms(line, mentions)) {
    scanPlain(line, cursor, atom.start, pieces);
    pieces.push(atom);
    cursor = atom.end;
  }
  scanPlain(line, cursor, line.length, pieces);
  pairDelimiters(pieces);

  const depth: Record<ToggledStyle, number> = { bold: 0, italic: 0, strike: 0 };
  const style = (): MessageTextStyle => ({ bold: depth.bold > 0, italic: depth.italic > 0, strike: depth.strike > 0, code: false });
  for (const piece of pieces) {
    if (piece.kind === 'delimiter') {
      if (piece.role) depth[MARKER_STYLE[piece.marker]] += piece.role === 'open' ? 1 : -1;
      else pushText(runs, piece.marker, style());
    } else if (piece.kind === 'plain') {
      pushText(runs, piece.text, style());
    } else if (piece.kind === 'code') {
      runs.push({ kind: 'text', text: piece.text, style: { ...style(), code: true } });
    } else if (piece.kind === 'mention') {
      runs.push({ kind: 'mention', text: piece.text, target: piece.target, style: style() });
    } else {
      runs.push({ kind: 'link', text: piece.text, href: piece.text, style: style() });
    }
  }
};

/** The text as styled runs, with `@Name` runs for the given mentions and http(s) links. */
export const formatMessageText = <T extends MentionTarget>(text: string, mentions: readonly T[]): Array<MessageRun<T>> => {
  const runs: Array<MessageRun<T>> = [];
  text.split('\n').forEach((line, index) => {
    if (index > 0) pushText(runs, '\n', PLAIN);
    formatLine(line, mentions, runs);
  });
  if (runs.length === 0) runs.push({ kind: 'text', text: '', style: PLAIN });
  return runs;
};
