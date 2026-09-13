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
  bass: string | null;
}

export interface ChordPosition {
  /** Character offset into the line's lyrics where the chord sits. */
  index: number;
  chord: string;
}

export interface ChordProLine {
  lyrics: string;
  chords: ChordPosition[];
}

export interface ChordProSection {
  /** `verse`, `chorus`, `bridge`, `tab`, or `none` for loose lines. */
  type: string;
  label: string | null;
  lines: ChordProLine[];
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
  const [chordPart, bassPart] = token.split('/');
  if (!chordPart) return null;
  const rootMatch = ROOT_RE.exec(chordPart);
  if (!rootMatch) return null;
  const root = rootMatch[0];
  const suffix = chordPart.slice(root.length);
  const bass = bassPart && ROOT_RE.test(bassPart) ? bassPart : null;
  return { root, suffix, bass };
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
  const bass = parsed.bass ? `/${shiftNote(parsed.bass, semitones, prefer)}` : '';
  return `${root}${parsed.suffix}${bass}`;
};

/** Semitone distance from one key to another; null when either is unknown. */
export const semitonesBetween = (from: string, to: string): number | null => {
  const strip = (k: string) => k.replace(/m(in)?$/i, '').trim();
  const a = noteIndex(strip(from));
  const b = noteIndex(strip(to));
  if (a < 0 || b < 0) return null;
  return (((b - a) % 12) + 12) % 12;
};

/** Rewrites every [chord] in a ChordPro document, leaving directives alone. */
export const transposeChordPro = (
  source: string,
  semitones: number,
  prefer: 'sharps' | 'flats' = 'sharps',
): string => {
  if (semitones === 0) return source;
  return source.replace(/\[([^\]]+)\]/g, (match, token: string) => {
    const transposed = transposeChord(token, semitones, prefer);
    return transposed === token ? match : `[${transposed}]`;
  });
};

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

const parseLine = (raw: string): ChordProLine => {
  const chords: ChordPosition[] = [];
  let lyrics = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '[') {
      const close = raw.indexOf(']', i);
      if (close > i) {
        chords.push({ index: lyrics.length, chord: raw.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    lyrics += ch;
    i += 1;
  }
  return { lyrics, chords };
};

export const parseChordPro = (source: string): ChordProSong => {
  const directives: Record<string, string> = {};
  const sections: ChordProSection[] = [];
  let current: ChordProSection = { type: 'none', label: null, lines: [] };

  const pushCurrent = () => {
    if (current.lines.length > 0 || current.type !== 'none') sections.push(current);
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const directive = /^\{\s*([^:}]+?)\s*(?::\s*(.*?))?\s*\}$/.exec(line.trim());

    if (directive) {
      const rawName = (directive[1] ?? '').toLowerCase();
      const value = directive[2] ?? '';
      const name = SECTION_ALIASES[rawName] ?? rawName;

      if (rawName.startsWith('start_of_') || rawName === 'soc' || rawName === 'sov' || rawName === 'sob' || rawName === 'sot') {
        pushCurrent();
        current = {
          type: rawName.startsWith('start_of_') ? rawName.replace('start_of_', '') : name,
          label: value || null,
          lines: [],
        };
      } else if (rawName.startsWith('end_of_') || rawName === 'eoc' || rawName === 'eov' || rawName === 'eob' || rawName === 'eot') {
        pushCurrent();
        current = { type: 'none', label: null, lines: [] };
      } else {
        directives[rawName] = value;
      }
      continue;
    }

    if (line.startsWith('#')) continue; // comment
    current.lines.push(parseLine(line));
  }
  pushCurrent();

  const tempo = Number(directives.tempo);
  return {
    directives,
    title: directives.title ?? directives.t ?? null,
    key: directives.key ?? null,
    tempo: Number.isFinite(tempo) && tempo > 0 ? tempo : null,
    sections: sections.filter((s) => s.lines.some((l) => l.lyrics.trim() || l.chords.length) || s.type !== 'none'),
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

const SECTION_HEADING_RE =
  /^\s*\[?\s*((?:intro|verse|pre[- ]?chorus|chorus|bridge|tag|outro|instrumental|interlude|refrain|ending|turnaround)\s*\d*)\s*\]?\s*:?\s*$/i;

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

    const heading = SECTION_HEADING_RE.exec(line);
    if (heading?.[1]) {
      closeSection();
      const label = heading[1].trim();
      const type = /chorus/i.test(label) && !/pre/i.test(label)
        ? 'chorus'
        : /bridge/i.test(label)
          ? 'bridge'
          : /verse/i.test(label)
            ? 'verse'
            : 'part';
      openSection = type;
      out.push(`{start_of_${type}: ${label}}`);
      continue;
    }

    if (!line.trim()) {
      out.push('');
      continue;
    }

    if (isChordLine(line)) {
      const next = lines[i + 1] ?? '';
      // A chord line followed by lyrics merges into one inline line.
      if (next.trim() && !isChordLine(next) && !SECTION_HEADING_RE.test(next)) {
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
  let result = '';
  let cursor = 0;
  for (const { index, chord } of placements) {
    const at = Math.min(Math.max(index, cursor), lyrics.length);
    result += lyrics.slice(cursor, at) + `[${chord}]`;
    cursor = at;
  }
  result += lyrics.slice(cursor);
  return result;
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

  const bassDegree = chord.bass ? degreeOf(chord.bass, tonic.root) : null;
  const bass = bassDegree === null ? '' : `/${NUMBER_DEGREES[bassDegree]}`;
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

  const bassDegree = chord.bass ? degreeOf(chord.bass, tonic.root) : null;
  const bass = bassDegree === null ? '' : `/${NUMBER_DEGREES[bassDegree]}`;
  return `${numeral}${suffix}${bass}`;
};

/** Removes every `[chord]` from a document, leaving the lyrics and directives. */
export const stripChords = (source: string): string =>
  source
    .split(/\r?\n/)
    .map((line) => (/^\s*\{.*\}\s*$/.test(line) ? line : line.replace(/\[[^\]]*\]/g, '')))
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
  return source.replace(/\[([^\]]+)\]/g, (match, token: string) => {
    const converted = convert(token, key);
    return converted === token ? match : `[${converted}]`;
  });
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

  const prefer = preferredAccidental(targetKey ?? sourceKey);
  const transposed = transposeChordPro(source, shift, prefer);
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
  if (!sourceKey) return { chordpro: source, key: null, semitones: 0, notation };
  return {
    chordpro: convertChordProNotation(source, sourceKey, notation),
    key: null,
    semitones: 0,
    notation,
  };
};
