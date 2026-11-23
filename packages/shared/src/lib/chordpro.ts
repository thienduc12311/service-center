/**
 * ChordPro parsing, transposition and rendering.
 *
 * Used to display, transpose and renotate chord charts on both clients, and to
 * normalise a pasted chart — which usually arrives as chords on one line and
 * lyrics on the next — into inline ChordPro.
 */

import { FLAT_KEYS, SHARP_KEYS } from './constants.js';

export interface ParsedChord {
  root: string;
  suffix: string;
  /** The bass note after `/` when it is one (`G/B` → `B`); null otherwise. */
  bass: string | null;
  /**
   * Everything after the first `/`, verbatim (`B`, `Bb7`, `Q`); null without
   * a slash. Text past a recognised bass note, or an unrecognised bass, is
   * kept as written rather than dropped.
   */
  slash: string | null;
}

export interface ChordPosition {
  /** Character offset into the line's lyrics where the chord sits. */
  index: number;
  chord: string;
}

/** Inline text formatting a chart can ask for with `<b>`, `<i>` and `<u>`. */
export type ChordProTextStyle = 'bold' | 'italic' | 'underline';

/** One formatted stretch of a line's lyrics, as `[start, end)` character offsets. */
export interface ChordProTextMark {
  start: number;
  end: number;
  style: ChordProTextStyle;
}

export interface ChordProLine {
  lyrics: string;
  chords: ChordPosition[];
  /** Formatted stretches of `lyrics`; absent when the line is plain. */
  marks?: ChordProTextMark[];
  /**
   * `note` for a `{ note }` / `{{ note }}` line: an instruction to the band,
   * printed as written — its brackets are not lifted into a chord row.
   */
  kind?: 'note';
  /** A `{{ … }}` note: printed on chord charts, left off the lyrics sheet. */
  chartsOnly?: boolean;
}

/** Where a `COLUMN_BREAK` or `PAGE_BREAK` asked the printed chart to move on. */
export type ChordProBreak = 'column' | 'page';

export interface ChordProSection {
  /**
   * `verse`, `chorus`, `bridge`, `tab`, any other `start_of_*` name, a heading
   * line's type (`pre_chorus`, `tag`, `intro`, …), or `none` for loose lines.
   */
  type: string;
  label: string | null;
  lines: ChordProLine[];
  /** The printed chart starts this section in a new column or on a new page. */
  breakBefore?: ChordProBreak;
}

export interface ChordProSong {
  directives: Record<string, string>;
  title: string | null;
  key: string | null;
  tempo: number | null;
  sections: ChordProSection[];
}

const ROOT_RE = /^[A-G][#b]?/;
const CHORD_TOKEN_RE =
  /^[A-G][#b]?(maj|min|m|dim|aug|sus|add|M|Δ|°|ø)?[0-9#b+\-()majinsudpowerAdd]*(\/[A-G][#b]?)?$/;
/** Tokens that legitimately appear on a chord line without being chords. */
const CHORD_LINE_NOISE_RE = /^(\||\|\||:\||\|:|x\d+|\(?\d+x\)?|N\.?C\.?|-|\/+)$/i;

export const parseChord = (token: string): ParsedChord | null => {
  const slashAt = token.indexOf('/');
  const chordPart = slashAt === -1 ? token : token.slice(0, slashAt);
  const slash = slashAt === -1 ? null : token.slice(slashAt + 1);
  if (!chordPart) return null;
  const rootMatch = ROOT_RE.exec(chordPart);
  if (!rootMatch) return null;
  const root = rootMatch[0];
  const suffix = chordPart.slice(root.length);
  const bass = slash ? (ROOT_RE.exec(slash)?.[0] ?? null) : null;
  return { root, suffix, bass, slash };
};

/** `/bass` for output: a recognised bass note goes through `note`, the rest is kept verbatim. */
const slashText = (chord: ParsedChord, note: (bass: string) => string | null): string => {
  if (chord.slash === null) return '';
  if (!chord.bass) return `/${chord.slash}`;
  const mapped = note(chord.bass);
  return mapped === null ? `/${chord.slash}` : `/${mapped}${chord.slash.slice(chord.bass.length)}`;
};

export const isChordToken = (token: string): boolean =>
  CHORD_TOKEN_RE.test(token) && parseChord(token) !== null;

const noteIndex = (note: string): number => {
  const sharp = SHARP_KEYS.indexOf(note as (typeof SHARP_KEYS)[number]);
  if (sharp >= 0) return sharp;
  const flat = FLAT_KEYS.indexOf(note as (typeof FLAT_KEYS)[number]);
  return flat;
};

const shiftNote = (note: string, semitones: number, prefer: 'sharps' | 'flats'): string => {
  const idx = noteIndex(note);
  if (idx < 0) return note;
  const next = (((idx + semitones) % 12) + 12) % 12;
  return (prefer === 'flats' ? FLAT_KEYS : SHARP_KEYS)[next] ?? note;
};

export const transposeChord = (
  token: string,
  semitones: number,
  prefer: 'sharps' | 'flats' = 'sharps',
): string => {
  const parsed = parseChord(token);
  if (!parsed || semitones === 0) return token;
  const root = shiftNote(parsed.root, semitones, prefer);
  return `${root}${parsed.suffix}${slashText(parsed, (bass) => shiftNote(bass, semitones, prefer))}`;
};

/** Semitone distance from one key to another; null when either is unknown. */
export const semitonesBetween = (from: string, to: string): number | null => {
  const strip = (k: string) => k.replace(/m(in)?$/i, '').trim();
  const a = noteIndex(strip(from));
  const b = noteIndex(strip(to));
  if (a < 0 || b < 0) return null;
  return (((b - a) % 12) + 12) % 12;
};

/** Rewrites every [chord] and the `{key: …}` directive in a ChordPro document. */
export const transposeChordPro = (
  source: string,
  semitones: number,
  prefer: 'sharps' | 'flats' = 'sharps',
): string => {
  if (semitones === 0) return source;
  // `{key: G}` / `{k: Am}` describe the song's key, so they move with the chords.
  const withKey = source.replace(/\{(\s*(?:key|k)\s*:\s*)([^}\s]+)(\s*)\}/gi, (match, head: string, key: string, tail: string) => {
    const transposed = transposeChord(key, semitones, prefer);
    return transposed === key ? match : `{${head}${transposed}${tail}}`;
  });
  return mapChords(withKey, (token) => transposeChord(token, semitones, prefer));
};

/**
 * Rewrites each `[chord]` with `map`, skipping text inside `<t>…</t>`, which
 * is printed as written. `map` returning the token keeps it exactly as typed;
 * returning null removes it.
 */
const mapChords = (source: string, map: (token: string) => string | null): string =>
  source
    .split(/(\r?\n)/)
    .map((line) => (isBracketedHeading(line) ? line : mapLineChords(line, map)))
    .join('');

/** A `[Bridge]` heading line: its brackets mark a section, not a chord. */
const isBracketedHeading = (line: string): boolean => {
  const text = withoutFormatting(line).trim();
  return text.startsWith('[') && parseSectionHeading(text) !== null;
};

const mapLineChords = (source: string, map: (token: string) => string | null): string =>
  source
    .split(/(<t>.*?<\/t>)/i)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/\[([^\]]+)\]/g, (match, token: string) => {
            const next = map(token);
            if (next === null) return '';
            return next === token ? match : `[${next}]`;
          }),
    )
    .join('');

const SECTION_ALIASES: Record<string, string> = {
  soc: 'chorus',
  eoc: 'chorus',
  sov: 'verse',
  eov: 'verse',
  sob: 'bridge',
  eob: 'bridge',
  sot: 'tab',
  eot: 'tab',
};

/** The formatting tags a line may carry; `<t>` marks text that is never a chord. */
const FORMAT_TAG_RE = /^<(\/?)(b|strong|i|em|u|t)>/i;

const TAG_STYLES: Record<string, ChordProTextStyle | 'literal'> = {
  b: 'bold',
  strong: 'bold',
  i: 'italic',
  em: 'italic',
  u: 'underline',
  t: 'literal',
};

/**
 * Splits one line into its lyrics, the chords sitting in them and any
 * formatting. Tags take no room in the lyrics, so chord offsets still count
 * only the characters that are printed; inside `<t>…</t>` a `[` is just text.
 */
const parseLine = (raw: string): ChordProLine => {
  const chords: ChordPosition[] = [];
  const marks: ChordProTextMark[] = [];
  const open: Partial<Record<ChordProTextStyle, number>> = {};
  let literal = false;
  let lyrics = '';
  let i = 0;

  const close = (style: ChordProTextStyle) => {
    const start = open[style];
    if (start === undefined) return;
    if (lyrics.length > start) marks.push({ start, end: lyrics.length, style });
    delete open[style];
  };

  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '<') {
      const tag = FORMAT_TAG_RE.exec(raw.slice(i, i + 9));
      const style = tag ? TAG_STYLES[tag[2]!.toLowerCase()] : undefined;
      if (tag && style) {
        const closing = tag[1] === '/';
        if (style === 'literal') literal = !closing;
        else if (closing) close(style);
        else if (open[style] === undefined) open[style] = lyrics.length;
        i += tag[0].length;
        continue;
      }
    }
    if (ch === '[' && !literal) {
      const end = raw.indexOf(']', i);
      if (end > i) {
        chords.push({ index: lyrics.length, chord: raw.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    lyrics += ch;
    i += 1;
  }
  (['bold', 'italic', 'underline'] as const).forEach(close);

  if (marks.length === 0) return { lyrics, chords };
  marks.sort((a, b) => a.start - b.start);
  return { lyrics, chords, marks };
};

/** A line's text with its formatting tags removed, for recognising what it is. */
const withoutFormatting = (line: string): string => line.replace(/<\/?(?:b|strong|i|em|u|t)>/gi, '');

/** One run of lyrics that shares a single combination of styles. */
export interface StyledLyricRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/**
 * The lyrics between `start` and `end`, cut into runs of the same formatting,
 * for a renderer to wrap each run in the right style. A line with no marks is
 * one plain run.
 */
export const styledLyricRuns = (
  line: Pick<ChordProLine, 'lyrics' | 'marks'>,
  start = 0,
  end = line.lyrics.length,
): StyledLyricRun[] => {
  const runs: StyledLyricRun[] = [];
  const marks = line.marks ?? [];
  for (let at = start; at < end; at += 1) {
    const has = (style: ChordProTextStyle) => marks.some((m) => m.style === style && m.start <= at && at < m.end);
    const bold = has('bold');
    const italic = has('italic');
    const underline = has('underline');
    const last = runs[runs.length - 1];
    const char = line.lyrics[at] ?? '';
    if (last && last.bold === bold && last.italic === italic && last.underline === underline) last.text += char;
    else runs.push({ text: char, bold, italic, underline });
  }
  return runs;
};

/** A `{name}` or `{name: value}` line, split into its trimmed parts. */
interface ChordProDirective {
  name: string;
  value: string;
}

/**
 * Reads a directive line by slicing, not by regex: the old pattern's
 * overlapping whitespace quantifiers backtracked catastrophically on an
 * unclosed `{` followed by spaces, freezing every reader of the chart.
 */
const parseDirective = (line: string): ChordProDirective | null => {
  if (line.length < 3 || !line.startsWith('{') || !line.endsWith('}')) return null;
  const body = line.slice(1, -1);
  const colon = body.indexOf(':');
  const name = (colon === -1 ? body : body.slice(0, colon)).trim();
  if (!name || name.includes('}')) return null;
  return { name, value: colon === -1 ? '' : body.slice(colon + 1).trim() };
};

// ------------------------------------------------------ section headings ----

/**
 * Section names a heading line may use, in the forms charts are written with
 * (`VERSE 1`, `Pre-Chorus`, `Tag:`, `[Bridge]`). Each maps to the section
 * type it starts; the label shown is always the heading as written.
 */
const SECTION_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^pre[- ]?chorus$/, 'pre_chorus'],
  [/^post[- ]?chorus$/, 'post_chorus'],
  [/^chorus$/, 'chorus'],
  [/^refrain$/, 'chorus'],
  [/^verse$/, 'verse'],
  [/^bridge$/, 'bridge'],
  [/^tag$/, 'tag'],
  [/^intro$/, 'intro'],
  [/^outro$/, 'outro'],
  [/^ending$/, 'ending'],
  [/^coda$/, 'ending'],
  [/^instrumental$/, 'instrumental'],
  [/^interlude$/, 'interlude'],
  [/^turnaround$/, 'turnaround'],
  [/^vamp$/, 'vamp'],
  [/^break$/, 'break'],
];

/** A heading is a short line; anything longer is a lyric that starts with "verse". */
const MAX_HEADING_LENGTH = 40;

/** `VERSE 1`, `Chorus 2`, `Verse 3a`, `CHORUS 2x`, `Tag (x3)` — name, number, repeat. */
const HEADING_RE = /^([a-z]+(?:[- ][a-z]+)?)(?:\s*\d{1,2}[a-z]?)?(?:\s*\(?(?:x\s?\d{1,2}|\d{1,2}\s?x)\)?)?$/i;

/** A heading line's label and the section type it starts. */
export interface SectionHeading {
  /** The heading as written, minus brackets and a trailing colon. */
  label: string;
  /** `verse`, `chorus`, `pre_chorus`, `tag`, … */
  type: string;
}

/**
 * Reads a `VERSE 1`, `Chorus:`, `[Bridge]` or `Tag (2x)` heading line, or
 * null when the line is anything else. Brackets and the colon are peeled off
 * first and the line is length-capped, so the one regex that remains has
 * nothing to backtrack across (it used to hang on `verse` + 50 000 spaces).
 */
export const parseSectionHeading = (line: string): SectionHeading | null => {
  let text = line.trim();
  if (text.length > MAX_HEADING_LENGTH + 4) return null;
  if (text.endsWith(':')) text = text.slice(0, -1).trimEnd();
  if (text.startsWith('[')) text = text.slice(1).trimStart();
  if (text.endsWith(']')) text = text.slice(0, -1).trimEnd();
  if (text.endsWith(':')) text = text.slice(0, -1).trimEnd();
  if (!text || text.length > MAX_HEADING_LENGTH) return null;

  const match = HEADING_RE.exec(text);
  const name = match?.[1]?.toLowerCase();
  if (!name) return null;
  const entry = SECTION_NAMES.find(([re]) => re.test(name));
  return entry ? { label: text, type: entry[1] } : null;
};

/**
 * A short all-caps line that is not a row of chords is a heading even when its
 * name is not one we know (`SPONTANEOUS`, `ĐIỆP KHÚC`). Letters, digits,
 * spaces and `-&'()` only, so a shouted lyric with punctuation
 * (`HOLY, HOLY, HOLY!`) is not mistaken for one.
 */
const ALL_CAPS_HEADING_RE = /^[\p{Lu}\p{N}][\p{Lu}\p{M}\p{N} '&()\-]*$/u;

const isAllCapsLine = (line: string): boolean => {
  const text = line.trim();
  return (
    text.length <= MAX_HEADING_LENGTH &&
    /\p{Lu}/u.test(text) &&
    ALL_CAPS_HEADING_RE.test(text) &&
    !isChordLine(text)
  );
};

/** A custom all-caps heading, labelled as written. */
const customHeading = (line: string): SectionHeading => {
  const label = line.trim();
  return parseSectionHeading(label) ?? { label, type: 'part' };
};

/** `{comment: …}` and its short and styled forms, which charts often use as headings. */
const COMMENT_DIRECTIVES = new Set(['comment', 'c', 'comment_italic', 'ci', 'comment_box', 'cb', 'highlight']);

/** Explicit sections whose lines are verbatim, so a heading-like line inside stays a line. */
const VERBATIM_SECTIONS = new Set(['tab', 'grid']);

/**
 * ChordPro directives this app reads or knows to keep out of the printed chart.
 * A brace line naming anything else is a note to the band: `{ Repeat 2x }`.
 */
const KNOWN_DIRECTIVES = new Set([
  'title', 't', 'subtitle', 'st', 'artist', 'composer', 'lyricist', 'arranger', 'author',
  'copyright', 'album', 'year', 'key', 'k', 'time', 'tempo', 'duration', 'capo', 'meta',
  'ccli', 'ccli_license', 'sorttitle', 'columns', 'col', 'pagetype', 'diagrams', 'grid', 'g',
  'no_grid', 'ng', 'titles', 'chordfont', 'chordsize', 'chordcolour', 'chordcolor',
  'textfont', 'textsize', 'textcolour', 'textcolor', 'define', 'chord', 'transpose', 'new_song', 'ns',
]);

const isKnownDirective = (name: string): boolean =>
  KNOWN_DIRECTIVES.has(name) ||
  COMMENT_DIRECTIVES.has(name) ||
  name in SECTION_ALIASES ||
  name.startsWith('start_of_') ||
  name.startsWith('end_of_') ||
  name.startsWith('x_') ||
  BREAK_DIRECTIVES[name] !== undefined;

/** The ChordPro spellings of a column or page break. */
const BREAK_DIRECTIVES: Record<string, ChordProBreak> = {
  column_break: 'column',
  colb: 'column',
  new_page: 'page',
  np: 'page',
  new_physical_page: 'page',
  npp: 'page',
};

/** `COLUMN_BREAK` or `PAGE_BREAK` on a line of its own, in any case. */
const breakLine = (text: string): ChordProBreak | null => {
  const upper = text.trim().toUpperCase();
  if (upper === 'COLUMN_BREAK') return 'column';
  if (upper === 'PAGE_BREAK') return 'page';
  return null;
};

/** A `{{ … }}` line's inner text, or null. Read by slicing, like `parseDirective`. */
const chartsOnlyBody = (line: string): string | null =>
  line.length >= 4 && line.startsWith('{{') && line.endsWith('}}') ? line.slice(2, -2).trim() : null;

/** A key change partway through a song. */
export interface ChordProKeyChange {
  /**
   * `transpose`: the chords below are written in the song's key and are
   * printed this many semitones higher. `redefine`: the chords below are
   * already written in the new key; numbers and numerals count from it.
   */
  kind: 'transpose' | 'redefine';
  semitones: number;
}

/** `TRANSPOSE KEY +2`, `REDEFINE KEY -1`: the line on its own, any case. */
const KEY_CHANGE_RE = /^(transpose|redefine)\s+key\s*([+-])\s*(\d{1,2})$/i;

export const parseKeyChange = (line: string): ChordProKeyChange | null => {
  const text = line.trim();
  if (text.length > 30) return null;
  const match = KEY_CHANGE_RE.exec(text);
  if (!match) return null;
  const amount = Number(match[3]) * (match[2] === '-' ? -1 : 1);
  return { kind: match[1]!.toLowerCase() === 'transpose' ? 'transpose' : 'redefine', semitones: amount };
};

/**
 * Lines that steer the chart rather than being printed in it — directives,
 * notes, breaks and key changes. A custom heading may follow one.
 */
const isControlLine = (text: string): boolean =>
  parseDirective(text) !== null || chartsOnlyBody(text) !== null || breakLine(text) !== null || parseKeyChange(text) !== null;

/**
 * Whether the line at `index` is an all-caps custom heading. It has to open a
 * stanza (first line, or after a blank line, a control line or another
 * heading) and be followed by something that is not more all-caps text —
 * otherwise a song typed entirely in capitals would turn every stanza's first
 * line into a heading.
 */
const isCustomHeadingAt = (lines: readonly string[], index: number): boolean => {
  const line = withoutFormatting(lines[index] ?? '');
  if (!isAllCapsLine(line)) return false;

  const previous = (lines[index - 1] ?? '').trim();
  if (previous && !isControlLine(previous) && !parseSectionHeading(withoutFormatting(previous))) return false;

  for (let next = index + 1; next < lines.length; next += 1) {
    const text = (lines[next] ?? '').trim();
    if (!text || isControlLine(text)) continue;
    // Chords, inline or on their own row, are the section's body.
    if (parseSectionHeading(withoutFormatting(text))) return true;
    const lyric = parseLine(text).lyrics.trim();
    return !lyric || !isAllCapsLine(lyric) || isChordLine(text);
  }
  return true;
};

/** A note line: its text kept exactly as typed, brackets and all. */
const noteLine = (text: string, chartsOnly: boolean): ChordProLine => {
  const { lyrics, marks } = parseLine(text.replace(/\[/g, '<t>[').replace(/\]/g, ']</t>'));
  return { lyrics, chords: [], ...(marks ? { marks } : {}), kind: 'note', ...(chartsOnly ? { chartsOnly } : {}) };
};

export const parseChordPro = (source: string): ChordProSong => {
  const directives: Record<string, string> = {};
  const sections: ChordProSection[] = [];
  let current: ChordProSection = { type: 'none', label: null, lines: [] };
  let pendingBreak: ChordProBreak | null = null;

  const pushCurrent = () => {
    // The blank lines around a section only separate it from its neighbours.
    const isBlank = (l: ChordProLine) => !l.lyrics.trim() && l.chords.length === 0 && l.kind !== 'note';
    let start = 0;
    let end = current.lines.length;
    while (start < end && isBlank(current.lines[start]!)) start += 1;
    while (end > start && isBlank(current.lines[end - 1]!)) end -= 1;
    current.lines = current.lines.slice(start, end);
    if (current.lines.length > 0 || current.type !== 'none') sections.push(current);
    // A break in front of nothing waits for whatever comes next.
    else if (current.breakBefore) pendingBreak = current.breakBefore;
  };

  const startSection = (type: string, label: string | null) => {
    pushCurrent();
    current = { type, label, lines: [], ...(pendingBreak ? { breakBefore: pendingBreak } : {}) };
    pendingBreak = null;
  };

  /** A break ends the section here; what follows carries on without a heading. */
  const breakHere = (kind: ChordProBreak) => {
    pushCurrent();
    // Two breaks in a row: a page break outranks a column break.
    const breakBefore: ChordProBreak = pendingBreak === 'page' ? 'page' : kind;
    current = { type: 'none', label: null, lines: [], breakBefore };
    pendingBreak = null;
  };

  const rawLines = source.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = (rawLines[i] ?? '').trimEnd();
    const trimmed = line.trim();

    // `{{ note }}` and `{{ PAGE_BREAK }}` belong to chord charts only.
    const chartsOnly = chartsOnlyBody(trimmed);
    if (chartsOnly !== null) {
      const kind = breakLine(chartsOnly);
      if (kind) breakHere(kind);
      else if (chartsOnly) current.lines.push(noteLine(chartsOnly, true));
      continue;
    }

    const directive = parseDirective(trimmed);
    if (directive) {
      const rawName = directive.name.toLowerCase();
      const { value } = directive;
      const name = SECTION_ALIASES[rawName] ?? rawName;

      if (rawName.startsWith('start_of_') || rawName === 'soc' || rawName === 'sov' || rawName === 'sob' || rawName === 'sot') {
        startSection(rawName.startsWith('start_of_') ? rawName.replace('start_of_', '') : name, value || null);
      } else if (rawName.startsWith('end_of_') || rawName === 'eoc' || rawName === 'eov' || rawName === 'eob' || rawName === 'eot') {
        startSection('none', null);
      } else if (BREAK_DIRECTIVES[rawName]) {
        breakHere(BREAK_DIRECTIVES[rawName]);
      } else if (COMMENT_DIRECTIVES.has(rawName)) {
        // `{c: Verse 1}` is how SongSelect and most ChordPro files mark a
        // section; any other comment is a note printed in the chart.
        const heading = parseSectionHeading(value);
        if (heading) startSection(heading.type, heading.label);
        else if (value) current.lines.push(noteLine(value, false));
      } else if (isKnownDirective(rawName)) {
        directives[rawName] = value;
      } else {
        current.lines.push(noteLine(trimmed.slice(1, -1).trim(), false));
      }
      continue;
    }

    if (line.startsWith('#')) continue; // comment

    const kind = breakLine(trimmed);
    if (kind) {
      breakHere(kind);
      continue;
    }
    // Applied by `renderChordProChart`; never printed.
    if (parseKeyChange(trimmed)) continue;

    // A `VERSE 1` / `CHORUS` / `[Tag]` line on its own starts a section.
    const plain = withoutFormatting(line);
    const heading = VERBATIM_SECTIONS.has(current.type)
      ? null
      : (parseSectionHeading(plain) ?? (isCustomHeadingAt(rawLines, i) ? customHeading(plain) : null));
    if (heading) {
      startSection(heading.type, heading.label);
      continue;
    }

    current.lines.push(parseLine(line));
  }
  pushCurrent();

  const tempo = Number(directives.tempo);
  return {
    directives,
    title: directives.title ?? directives.t ?? null,
    key: directives.key ?? null,
    tempo: Number.isFinite(tempo) && tempo > 0 ? tempo : null,
    sections: sections.filter(
      (s) => s.lines.some((l) => l.lyrics.trim() || l.chords.length || l.kind === 'note') || s.type !== 'none',
    ),
  };
};

/** Renders a line as two rows: chords positioned above their lyrics. */
export const renderLineAsText = (line: ChordProLine): { chordRow: string; lyricRow: string } => {
  if (line.chords.length === 0) return { chordRow: '', lyricRow: line.lyrics };
  let chordRow = '';
  for (const { index, chord } of line.chords) {
    if (chordRow.length > index) chordRow += ' ';
    chordRow = chordRow.padEnd(index, ' ') + chord;
  }
  return { chordRow, lyricRow: line.lyrics };
};

// ------------------------------------------------------- pasted charts ----

/**
 * A line is treated as a chord line when every meaningful token on it parses
 * as a chord. `G   C   D` is a chord line; `Amazing grace how sweet` is not.
 */
export const isChordLine = (line: string): boolean => {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  let chords = 0;
  for (const token of tokens) {
    if (CHORD_LINE_NOISE_RE.test(token)) continue;
    if (!isChordToken(token)) return false;
    chords += 1;
  }
  return chords > 0;
};

/**
 * Converts a plain "chords above lyrics" chart — the shape most charts are
 * copied from — into inline ChordPro, preserving each chord's column.
 */
export const chordLinesToChordPro = (
  rawText: string,
  meta: { title?: string | null; key?: string | null; tempo?: number | null } = {},
): string => {
  const lines = rawText.replace(/\t/g, '    ').split(/\r?\n/);
  const out: string[] = [];

  if (meta.title) out.push(`{title: ${meta.title}}`);
  if (meta.key) out.push(`{key: ${meta.key}}`);
  if (meta.tempo) out.push(`{tempo: ${meta.tempo}}`);
  if (out.length) out.push('');

  let openSection: string | null = null;
  const closeSection = () => {
    if (openSection) {
      out.push(`{end_of_${openSection}}`);
      out.push('');
      openSection = null;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    const heading = parseSectionHeading(line) ?? (isCustomHeadingAt(lines, i) ? customHeading(line) : null);
    if (heading) {
      closeSection();
      openSection = heading.type;
      out.push(`{start_of_${heading.type}: ${heading.label}}`);
      continue;
    }

    if (!line.trim()) {
      out.push('');
      continue;
    }

    if (isChordLine(line)) {
      const next = lines[i + 1] ?? '';
      // A chord line followed by lyrics merges into one inline line.
      if (next.trim() && !isChordLine(next) && parseSectionHeading(next) === null) {
        out.push(mergeChordAndLyricLine(line, next));
        i += 1;
      } else {
        // Instrumental — chords with no words under them.
        out.push(
          line
            .trim()
            .split(/\s+/)
            .map((t) => (isChordToken(t) ? `[${t}]` : t))
            .join(' '),
        );
      }
      continue;
    }

    out.push(line.trimEnd());
  }

  closeSection();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
};

/** Splices chords into the lyric line at the column where each chord started. */
export const mergeChordAndLyricLine = (chordLine: string, lyricLine: string): string => {
  const placements: Array<{ index: number; chord: string }> = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(chordLine)) !== null) {
    if (CHORD_LINE_NOISE_RE.test(match[0])) continue;
    placements.push({ index: match.index, chord: match[0] });
  }

  const lyrics = lyricLine.replace(/\s+$/, '');
  // Formatting tags take no room on the page, so a chord's column counts only
  // the characters that are printed: `<b>Holy</b>` puts column 2 at `l`.
  const printed = printedOffsets(lyrics);
  const rawAt = (column: number): number => printed[column] ?? lyrics.length;

  let result = '';
  let cursor = 0;
  for (const { index, chord } of placements) {
    const at = Math.max(rawAt(index), cursor);
    result += lyrics.slice(cursor, at) + `[${chord}]`;
    cursor = at;
  }
  result += lyrics.slice(cursor);
  return result;
};

/** The offset in `line` of each character that is printed, skipping formatting tags. */
const printedOffsets = (line: string): number[] => {
  const offsets: number[] = [];
  for (let i = 0; i < line.length; ) {
    const tag = line[i] === '<' ? FORMAT_TAG_RE.exec(line.slice(i, i + 9)) : null;
    if (tag) {
      i += tag[0].length;
      continue;
    }
    offsets.push(i);
    i += 1;
  }
  return offsets;
};

/**
 * Normalises whatever was pasted into ChordPro.
 *
 * Text that already has inline `[chords]` is left exactly as typed; anything
 * else is run through `chordLinesToChordPro`, so a chart copied from a hymnal
 * or a lyrics site lands in the same format as one written by hand.
 */
export const toChordPro = (input: string): string => {
  const text = input.trim();
  if (!text) return '';
  if (/\[[^\]]+\]/.test(text)) return text;
  return text.split(/\r?\n/).some(isChordLine) ? chordLinesToChordPro(text) : text;
};

/** Best-effort key detection: the first chord usually names the key. */
export const detectKey = (chordproOrText: string): string | null => {
  const inline = /\[([^\]]+)\]/.exec(chordproOrText);
  const token = inline?.[1] ?? chordproOrText.trim().split(/\s+/).find(isChordToken);
  if (!token) return null;
  const parsed = parseChord(token);
  if (!parsed) return null;
  return /^m(?!aj)/.test(parsed.suffix) ? `${parsed.root}m` : parsed.root;
};

// ------------------------------------------------------- chart notation ----

/**
 * How a chart is written out. `chords` is the literal chart; `numbers` and
 * `numerals` are the two key-independent systems worship teams read from
 * (Nashville numbers and Roman numerals); `lyrics` drops the chords entirely.
 */
export type ChartNotation = 'chords' | 'numbers' | 'numerals' | 'lyrics';

export interface ParsedKey {
  /** Natural or accidental root, e.g. `Bb`. */
  root: string;
  minor: boolean;
}

/** Degree of each semitone above the tonic, non-diatonic steps spelled flat. */
const NUMBER_DEGREES = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'] as const;
const NUMERAL_DEGREES = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'] as const;

/** Keys conventionally written with flats, so transposing into them looks right. */
const FLAT_KEY_ROOTS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']);

/** Splits `Bbm` into its root and quality; null when the key is unreadable. */
export const parseKey = (key: string): ParsedKey | null => {
  const trimmed = key.trim();
  const rootMatch = ROOT_RE.exec(trimmed);
  if (!rootMatch) return null;
  const root = rootMatch[0];
  const rest = trimmed.slice(root.length);
  return { root, minor: /^m(in)?$/i.test(rest) };
};

/** True when a chord's quality is minor (or diminished) rather than major. */
const isMinorQuality = (suffix: string): boolean =>
  /^m(?!aj)/.test(suffix) || /^(dim|°|ø)/i.test(suffix);

/** Sharps or flats, whichever the target key is normally written with. */
export const preferredAccidental = (key: string | null | undefined): 'sharps' | 'flats' => {
  if (!key) return 'sharps';
  const parsed = parseKey(key);
  if (!parsed) return 'sharps';
  if (parsed.root.includes('b')) return 'flats';
  // A minor key borrows the accidental of its relative major (Dm → F → flats).
  const relative = parsed.minor ? shiftNote(parsed.root, 3, 'flats') : parsed.root;
  return FLAT_KEY_ROOTS.has(relative) ? 'flats' : 'sharps';
};

/** Major-key pitch classes written with flats: Db, Eb, F, Ab, Bb (F#/Gb is written F#). */
const FLAT_MAJOR_PITCHES = new Set([1, 3, 5, 8, 10]);

/** Sharps or flats for the key `semitones` away from `key`, whatever spelling it lands on. */
export const conventionalAccidental = (key: string, semitones: number): 'sharps' | 'flats' => {
  const parsed = parseKey(key);
  if (!parsed) return 'sharps';
  const pitch = noteIndex(parsed.root);
  if (pitch < 0) return 'sharps';
  // A minor key borrows its relative major's spelling (Dm → F → flats).
  const major = (((pitch + semitones + (parsed.minor ? 3 : 0)) % 12) + 12) % 12;
  return FLAT_MAJOR_PITCHES.has(major) ? 'flats' : 'sharps';
};

/** Transposes a key label, keeping its major/minor quality. */
export const transposeKey = (
  key: string,
  semitones: number,
  prefer: 'sharps' | 'flats' = 'sharps',
): string => {
  const parsed = parseKey(key);
  if (!parsed) return key;
  return `${shiftNote(parsed.root, semitones, prefer)}${parsed.minor ? 'm' : ''}`;
};

const degreeOf = (note: string, tonic: string): number | null => {
  const noteIdx = noteIndex(note);
  const tonicIdx = noteIndex(tonic);
  if (noteIdx < 0 || tonicIdx < 0) return null;
  return (((noteIdx - tonicIdx) % 12) + 12) % 12;
};

/**
 * Nashville number for one chord, e.g. `Am` in the key of C is `6m`. The tonic
 * is always `1` — a minor key counts from its own root, so Am in A minor is
 * `1m` and the C in that key is `b3`.
 */
export const chordToNumber = (token: string, key: string): string => {
  const chord = parseChord(token);
  const tonic = parseKey(key);
  if (!chord || !tonic) return token;

  const degree = degreeOf(chord.root, tonic.root);
  if (degree === null) return token;

  const bass = slashText(chord, (note) => {
    const bassDegree = degreeOf(note, tonic.root);
    return bassDegree === null ? null : NUMBER_DEGREES[bassDegree] ?? null;
  });
  return `${NUMBER_DEGREES[degree]}${chord.suffix}${bass}`;
};

/**
 * Roman numeral for one chord, e.g. `Am` in the key of C is `vi`. Case carries
 * the quality, so the redundant `m` is dropped from the suffix.
 */
export const chordToNumeral = (token: string, key: string): string => {
  const chord = parseChord(token);
  const tonic = parseKey(key);
  if (!chord || !tonic) return token;

  const degree = degreeOf(chord.root, tonic.root);
  if (degree === null) return token;

  const minor = isMinorQuality(chord.suffix);
  const base = NUMERAL_DEGREES[degree] ?? token;
  const numeral = minor ? base.toLowerCase() : base;
  const suffix = minor ? chord.suffix.replace(/^m(?!aj)(in)?/, '') : chord.suffix;

  const bass = slashText(chord, (note) => {
    const bassDegree = degreeOf(note, tonic.root);
    return bassDegree === null ? null : NUMBER_DEGREES[bassDegree] ?? null;
  });
  return `${numeral}${suffix}${bass}`;
};

/**
 * Removes every `[chord]` from a document, leaving the lyrics and directives.
 * `{{ … }}` lines are for chord charts only, so the lyrics sheet drops them.
 */
export const stripChords = (source: string): string =>
  source
    .split(/\r?\n/)
    .filter((line) => chartsOnlyBody(line.trim()) === null)
    .map((line) => (/^\s*\{.*\}\s*$/.test(line) ? line : mapChords(line.replace(/\[\]/g, ''), () => null)))
    .join('\n');

/** Rewrites every `[chord]` into the requested notation. */
export const convertChordProNotation = (
  source: string,
  key: string,
  notation: ChartNotation,
): string => {
  if (notation === 'chords') return source;
  if (notation === 'lyrics') return stripChords(source);
  const convert = notation === 'numbers' ? chordToNumber : chordToNumeral;
  return mapChords(source, (token) => convert(token, key));
};

/** A stretch of a chart between key changes, and where those changes left it. */
interface KeyedLines {
  /** Semitones its chords are printed above how they are written (`TRANSPOSE KEY`). */
  transpose: number;
  /** Semitones its chords are written above the song's key (`REDEFINE KEY`). */
  redefine: number;
  lines: string[];
}

/** Cuts a chart at its `TRANSPOSE KEY` / `REDEFINE KEY` lines, dropping them. */
const splitAtKeyChanges = (source: string): KeyedLines[] => {
  const runs: KeyedLines[] = [{ transpose: 0, redefine: 0, lines: [] }];
  for (const line of source.split(/\r?\n/)) {
    const change = parseKeyChange(line);
    const last = runs[runs.length - 1]!;
    if (!change) {
      last.lines.push(line);
      continue;
    }
    runs.push({
      transpose: last.transpose + (change.kind === 'transpose' ? change.semitones : 0),
      redefine: last.redefine + (change.kind === 'redefine' ? change.semitones : 0),
      lines: [],
    });
  }
  return runs;
};

/** Applies the source key's major/minor quality to a bare target root. */
const keepQuality = (sourceKey: string | null, targetKey: string | null): string | null => {
  if (!targetKey || !sourceKey) return targetKey;
  const source = parseKey(sourceKey);
  const target = parseKey(targetKey);
  if (!source?.minor || !target || target.minor) return targetKey;
  return `${target.root}m`;
};

export interface ChartRenderOptions {
  /** The key the chart is written in. Required for `numbers` / `numerals`. */
  sourceKey?: string | null;
  /** Transpose to this key first. Ignored when it matches the source key. */
  targetKey?: string | null;
  /** Explicit shift, used when no target key is given. */
  semitones?: number;
  notation?: ChartNotation;
}

export interface RenderedChart {
  chordpro: string;
  /** The key the returned chart is in; null once it is key-independent. */
  key: string | null;
  semitones: number;
  notation: ChartNotation;
}

/**
 * The single entry point both clients and the API use: transpose, then convert
 * notation, so a chart rendered anywhere comes out byte-for-byte identical.
 */
export const renderChordProChart = (
  source: string,
  { sourceKey = null, targetKey: requestedKey = null, semitones = 0, notation = 'chords' }: ChartRenderOptions = {},
): RenderedChart => {
  // A key picker offers roots, not qualities, so "A" asked of a song in Am
  // means A minor — otherwise the chart would come back labelled as major.
  const targetKey = keepQuality(sourceKey, requestedKey);

  let shift = semitones;
  if (targetKey && sourceKey) shift = semitonesBetween(sourceKey, targetKey) ?? 0;

  // A shift alone lands on a key nobody named, so spell it the way that key is
  // conventionally written (G − 2 is F, which takes flats: Bb, not A#).
  const prefer = targetKey
    ? preferredAccidental(targetKey)
    : sourceKey && shift !== 0
      ? conventionalAccidental(sourceKey, shift)
      : preferredAccidental(sourceKey);
  // Key changes are applied here and then dropped, so the chart that comes out
  // is final: rendering it again cannot apply them twice.
  const runs = splitAtKeyChanges(source);
  const transposed = runs
    .map((run) => {
      const offset = shift + run.transpose;
      const keyChanged = run.transpose !== 0 || run.redefine !== 0;
      const runPrefer = keyChanged && sourceKey ? conventionalAccidental(sourceKey, offset + run.redefine) : prefer;
      return transposeChordPro(run.lines.join('\n'), offset, runPrefer);
    })
    .join('\n');
  const key = targetKey ?? (sourceKey && shift !== 0 ? transposeKey(sourceKey, shift, prefer) : sourceKey);

  if (notation === 'chords' || notation === 'lyrics') {
    return {
      chordpro: convertChordProNotation(transposed, key ?? '', notation),
      key: notation === 'lyrics' ? null : key,
      semitones: shift,
      notation,
    };
  }

  // Numbers and numerals are relative to the key, so transposing first would
  // be a no-op — read them off the source key instead.
  // A `TRANSPOSE KEY` moves the chords and the key together, so their numbers
  // stay put; after a `REDEFINE KEY` they count from the new key.
  if (!sourceKey) return { chordpro: runs.map((run) => run.lines.join('\n')).join('\n'), key: null, semitones: 0, notation };
  return {
    chordpro: runs
      .map((run) => convertChordProNotation(run.lines.join('\n'), run.redefine ? transposeKey(sourceKey, run.redefine) : sourceKey, notation))
      .join('\n'),
    key: null,
    semitones: 0,
    notation,
  };
};
