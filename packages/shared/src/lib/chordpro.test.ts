import { describe, expect, it } from 'vitest';
import {
  chordLinesToChordPro,
  chordToNumber,
  chordToNumeral,
  convertChordProNotation,
  parseKey,
  preferredAccidental,
  renderChordProChart,
  stripChords,
  toChordPro,
  transposeKey,
  detectKey,
  isChordLine,
  mergeChordAndLyricLine,
  parseChordPro,
  parseKeyChange,
  styledLyricRuns,
  semitonesBetween,
  transposeChord,
  transposeChordPro,
} from './chordpro.js';

describe('isChordLine', () => {
  it('recognises a line of chords', () => {
    expect(isChordLine('G    C     D')).toBe(true);
    expect(isChordLine('  Am7  F/A   Bbsus4 ')).toBe(true);
    expect(isChordLine('| G | C | D | x2')).toBe(true);
  });

  it('rejects lyrics', () => {
    expect(isChordLine('Amazing grace how sweet the sound')).toBe(false);
    expect(isChordLine('')).toBe(false);
    // "A" alone is a chord, but the rest of the words are not.
    expect(isChordLine('A wretch like me')).toBe(false);
  });
});

describe('mergeChordAndLyricLine', () => {
  it('places chords at the column they appeared in', () => {
    const chords = 'G            C        G';
    const lyrics = 'Amazing grace how sweet the sound';
    // Chords sit at columns 0, 13 and 22 of the chord line, so they splice in
    // after "Amazing grace", " how swee" and the remainder.
    expect(mergeChordAndLyricLine(chords, lyrics)).toBe(
      '[G]Amazing grace[C] how swee[G]t the sound',
    );
  });

  it('counts columns by printed characters, skipping formatting tags', () => {
    expect(mergeChordAndLyricLine('  G     C', '<b>Holy</b> holy')).toBe('<b>Ho[G]ly</b> hol[C]y');
  });

  it('appends chords that run past the end of the lyric', () => {
    expect(mergeChordAndLyricLine('        D', 'Short')).toBe('Short[D]');
  });
});

describe('chordLinesToChordPro', () => {
  it('converts a chords-above-lyrics chart into inline ChordPro', () => {
    const input = [
      'Verse 1',
      'G            C        G',
      'Amazing grace how sweet the sound',
      '                        D',
      'That saved a wretch like me',
    ].join('\n');

    const output = chordLinesToChordPro(input, { title: 'Amazing Grace', key: 'G' });

    expect(output).toContain('{title: Amazing Grace}');
    expect(output).toContain('{key: G}');
    expect(output).toContain('{start_of_verse: Verse 1}');
    expect(output).toContain('{end_of_verse}');
    expect(output).toContain('[G]Amazing grace[C] how swee[G]t the sound');
    expect(output).toContain('That saved a wretch like[D] me');
  });

  it('recognises section headings in their bracket and colon forms', () => {
    const out = chordLinesToChordPro('[Verse 1]\nla\nChorus:\nla\n[ Pre-Chorus ] :\nla\nverse]\nla\n[Bridge 2:]\nla');

    expect(out).toContain('{start_of_verse: Verse 1}');
    expect(out).toContain('{start_of_chorus: Chorus}');
    expect(out).toContain('{start_of_pre_chorus: Pre-Chorus}');
    expect(out).toContain('{start_of_verse: verse}');
    expect(out).not.toContain('Bridge 2:}');
  });

  // SEC: a crafted heading-like line used to backtrack exponentially.
  it('scans a hostile heading-like line in linear time', () => {
    const started = performance.now();
    chordLinesToChordPro(`verse${' '.repeat(50_000)}x`);
    chordLinesToChordPro(`[ chorus ${' '.repeat(50_000)}] ${' '.repeat(50_000)}: x`);

    expect(performance.now() - started).toBeLessThan(500);
  });

  it('keeps instrumental chord lines as bare chords', () => {
    const output = chordLinesToChordPro('G C D\n\n');
    expect(output).toContain('[G] [C] [D]');
  });
});

describe('transposition', () => {
  it('shifts roots and bass notes', () => {
    expect(transposeChord('G', 2)).toBe('A');
    expect(transposeChord('Am7', 3)).toBe('Cm7');
    expect(transposeChord('D/F#', 1, 'flats')).toBe('Eb/G');
    expect(transposeChord('notachord', 2)).toBe('notachord');
  });

  it('wraps around the octave', () => {
    expect(transposeChord('B', 1)).toBe('C');
    expect(transposeChord('C', -1, 'sharps')).toBe('B');
  });

  it('computes the distance between keys', () => {
    expect(semitonesBetween('G', 'A')).toBe(2);
    expect(semitonesBetween('A', 'G')).toBe(10);
    expect(semitonesBetween('Am', 'Cm')).toBe(3);
    expect(semitonesBetween('H', 'G')).toBeNull();
  });

  it('rewrites a whole chart but leaves directives alone', () => {
    const source = '{title: Test}\n[G]Amazing [C]grace';
    expect(transposeChordPro(source, 2)).toBe('{title: Test}\n[A]Amazing [D]grace');
  });

  it('rewrites the {key: …} directive with the chords (W7-JRN-D4)', () => {
    expect(transposeChordPro('{key: G}\n[G]Amazing', 2)).toBe('{key: A}\n[A]Amazing');
    expect(transposeChordPro('{k:Am}\n[Am]x', 3, 'flats')).toBe('{k:Cm}\n[Cm]x');
    expect(transposeChordPro('{KEY: Bb}', 2, 'flats')).toBe('{KEY: C}');
    expect(transposeChordPro('{key: G}', 0)).toBe('{key: G}');
  });
});

describe('parseChordPro', () => {
  it('splits directives, sections and chord positions', () => {
    const song = parseChordPro(
      '{title: Amazing Grace}\n{key: G}\n{start_of_verse: Verse 1}\nA[G]mazing grace\n{end_of_verse}',
    );

    expect(song.title).toBe('Amazing Grace');
    expect(song.key).toBe('G');
    expect(song.sections).toHaveLength(1);
    expect(song.sections[0]?.type).toBe('verse');
    expect(song.sections[0]?.label).toBe('Verse 1');
    expect(song.sections[0]?.lines[0]?.lyrics).toBe('Amazing grace');
    expect(song.sections[0]?.lines[0]?.chords).toEqual([{ index: 1, chord: 'G' }]);
  });

  it('reads directive names and values with surrounding spaces', () => {
    const song = parseChordPro('{  Title :  Grace: Amazing  }\n{ key:G }\n{ tempo }\n{title: a}b}');

    expect(song.directives).toEqual({ title: 'a}b', key: 'G', tempo: '' });
  });

  it('treats malformed braces as lyrics', () => {
    const song = parseChordPro('{a}b}\n{: x}\n{unclosed');

    expect(song.directives).toEqual({});
    expect(song.sections[0]?.lines.map((line) => line.lyrics)).toEqual(['{a}b}', '{: x}', '{unclosed']);
  });

  // SEC: a crafted line used to backtrack for seconds to minutes and freeze every reader.
  it('parses a hostile unclosed directive in linear time', () => {
    const started = performance.now();
    parseChordPro(`{${' '.repeat(50_000)}x`);
    parseChordPro(`{${' '.repeat(50_000)}x${' '.repeat(50_000)}:${' '.repeat(50_000)}`);

    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('section headings', () => {
  const outline = (source: string) =>
    parseChordPro(source).sections.map((section) => ({
      type: section.type,
      label: section.label,
      lines: section.lines.map((line) => line.lyrics),
    }));

  it('starts a section at a VERSE / CHORUS / BRIDGE / TAG line in an inline chart', () => {
    const chart = 'VERSE 1\n[G]Amazing [C]grace\n\nCHORUS\n[D]My chains\n\nBRIDGE\nla\n\nTAG\nlo';

    expect(outline(chart)).toEqual([
      { type: 'verse', label: 'VERSE 1', lines: ['Amazing grace'] },
      { type: 'chorus', label: 'CHORUS', lines: ['My chains'] },
      { type: 'bridge', label: 'BRIDGE', lines: ['la'] },
      { type: 'tag', label: 'TAG', lines: ['lo'] },
    ]);
  });

  it('recognises headings in a lyrics-only chart', () => {
    expect(outline('Verse 1\nla\nChorus\nlo').map((s) => s.label)).toEqual(['Verse 1', 'Chorus']);
  });

  it('reads a bracketed heading as a heading, not a chord', () => {
    const [section] = parseChordPro('[Bridge]\n[G]la').sections;

    expect(section?.type).toBe('bridge');
    expect(section?.label).toBe('Bridge');
    expect(section?.lines).toEqual([{ lyrics: 'la', chords: [{ index: 0, chord: 'G' }] }]);
  });

  it('accepts colons, numbers, letters and repeat markers', () => {
    const chart = ['Verse 2:', 'a', 'PRE-CHORUS', 'b', 'Chorus 2x', 'c', 'Tag (x3)', 'd', 'Verse 1a', 'e', 'Intro', 'f'].join('\n');

    expect(outline(chart).map(({ type, label }) => [type, label])).toEqual([
      ['verse', 'Verse 2'],
      ['pre_chorus', 'PRE-CHORUS'],
      ['chorus', 'Chorus 2x'],
      ['tag', 'Tag (x3)'],
      ['verse', 'Verse 1a'],
      ['intro', 'Intro'],
    ]);
  });

  it('treats a {comment: …} heading as a section, as SongSelect files write it', () => {
    expect(outline('{c: Verse 1}\nla\n{comment: Chorus}\nlo').map((s) => s.label)).toEqual(['Verse 1', 'Chorus']);
  });

  it('leaves lyrics that merely start with a section word alone', () => {
    expect(outline('Chorus of angels singing\nVerse by verse')).toEqual([
      { type: 'none', label: null, lines: ['Chorus of angels singing', 'Verse by verse'] },
    ]);
  });

  it('treats any all-caps line opening a stanza as a heading', () => {
    const chart = 'SPONTANEOUS\n[G]Holy are You Lord\n\nĐIỆP KHÚC\nHa-le-lu-ia';

    expect(outline(chart).map(({ type, label }) => [type, label])).toEqual([
      ['part', 'SPONTANEOUS'],
      ['part', 'ĐIỆP KHÚC'],
    ]);
  });

  it('does not turn a song typed in capitals into headings', () => {
    const chart = 'AMAZING GRACE HOW SWEET\nTHAT SAVED A WRETCH\n\nHOLY, HOLY, HOLY!\nlord';

    expect(outline(chart)).toHaveLength(1);
    expect(outline(chart)[0]?.type).toBe('none');
  });

  it('does not read a row of chords as an all-caps heading', () => {
    expect(outline('G C D\nla')[0]?.type).toBe('none');
  });

  it('keeps heading-like lines inside a tab block verbatim', () => {
    expect(outline('{start_of_tab}\nChorus\n{end_of_tab}')[0]?.lines).toEqual(['Chorus']);
  });

  it('still honours explicit start_of / end_of sections', () => {
    expect(outline('{start_of_chorus: Chorus}\nla\n{end_of_chorus}')).toEqual([
      { type: 'chorus', label: 'Chorus', lines: ['la'] },
    ]);
  });

  it('scans a hostile heading-like line in linear time', () => {
    const started = performance.now();
    parseChordPro(`verse${' '.repeat(50_000)}1`);
    parseChordPro(`${'1'.repeat(50_000)}x`);

    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('chart codes', () => {
  const lines = (source: string) => parseChordPro(source).sections.flatMap((section) => section.lines);

  it('reads a { note } as a note, keeping its brackets as text', () => {
    const [note] = lines('{ Repeat 2x, then [G] }');

    expect(note).toEqual({ lyrics: 'Repeat 2x, then [G]', chords: [], kind: 'note' });
  });

  it('keeps a known directive out of the chart', () => {
    const song = parseChordPro('{title: Grace}\n{capo: 2}\n{x_custom: y}\nla');

    expect(song.directives).toEqual({ title: 'Grace', capo: '2', x_custom: 'y' });
    expect(song.sections.flatMap((s) => s.lines).map((l) => l.lyrics)).toEqual(['la']);
  });

  it('prints a non-heading {comment} as a note', () => {
    expect(lines('{c: Softly}')).toEqual([{ lyrics: 'Softly', chords: [], kind: 'note' }]);
  });

  it('marks a {{ note }} as charts-only, and the lyrics sheet drops it', () => {
    expect(lines('{{ Build }}')).toEqual([{ lyrics: 'Build', chords: [], kind: 'note', chartsOnly: true }]);
    expect(stripChords('{{ Build }}\n{ Softly }\n[G]la')).toBe('{ Softly }\nla');
  });

  it('starts the next section in a new column or on a new page', () => {
    const song = parseChordPro('VERSE 1\na\nCOLUMN_BREAK\nCHORUS\nb\npage_break\nc\n{{ PAGE_BREAK }}\n{new_page}\nTAG\nd');

    expect(song.sections.map((s) => [s.label, s.breakBefore])).toEqual([
      ['VERSE 1', undefined],
      ['CHORUS', 'column'],
      [null, 'page'],
      ['TAG', 'page'],
    ]);
  });

  it('drops a break with nothing after it', () => {
    expect(parseChordPro('la\nPAGE_BREAK\n').sections).toHaveLength(1);
  });

  it('reads <b>, <i> and <u> as formatting that takes no room in the lyrics', () => {
    const [line] = lines('<b>Ho[G]ly</b> is <i><u>the</u> Lord</i>');

    expect(line?.lyrics).toBe('Holy is the Lord');
    expect(line?.chords).toEqual([{ index: 2, chord: 'G' }]);
    expect(line?.marks).toEqual([
      { start: 0, end: 4, style: 'bold' },
      { start: 8, end: 11, style: 'underline' },
      { start: 8, end: 16, style: 'italic' },
    ]);
    expect(styledLyricRuns(line!).map((r) => [r.text, r.bold, r.italic, r.underline])).toEqual([
      ['Holy', true, false, false],
      [' is ', false, false, false],
      ['the', false, true, true],
      [' Lord', false, true, false],
    ]);
  });

  it('closes formatting left open at the end of the line', () => {
    expect(lines('<b>loud')[0]?.marks).toEqual([{ start: 0, end: 4, style: 'bold' }]);
  });

  it('prints <t>[text]</t> as written, never as a chord', () => {
    const [line] = lines('Eu <t>[Em]</t> [G]Ti');

    expect(line?.lyrics).toBe('Eu [Em] Ti');
    expect(line?.chords).toEqual([{ index: 8, chord: 'G' }]);
    expect(transposeChordPro('<t>[Em]</t> [G]Ti', 2)).toBe('<t>[Em]</t> [A]Ti');
    expect(stripChords('<t>[Em]</t> [G]Ti')).toBe('<t>[Em]</t> Ti');
  });

  it('recognises a formatted heading', () => {
    expect(parseChordPro('<b>CHORUS</b>\nla').sections[0]?.label).toBe('CHORUS');
  });

  it('reads TRANSPOSE KEY and REDEFINE KEY lines, and never prints them', () => {
    expect(parseKeyChange('TRANSPOSE KEY +2')).toEqual({ kind: 'transpose', semitones: 2 });
    expect(parseKeyChange('redefine key -1')).toEqual({ kind: 'redefine', semitones: -1 });
    expect(parseKeyChange('TRANSPOSE KEY')).toBeNull();
    expect(lines('[G]a\nTRANSPOSE KEY +2\n[G]b').map((l) => l.lyrics)).toEqual(['a', 'b']);
  });
});

describe('bracketed headings under every view', () => {
  const chart = '[Bridge]\n[Em]Holy';

  it('keeps [Bridge] a heading when transposed, numbered or read as lyrics', () => {
    for (const view of [{ targetKey: 'A' }, { notation: 'numbers' as const }, { notation: 'numerals' as const }, { notation: 'lyrics' as const }]) {
      const out = renderChordProChart(chart, { sourceKey: 'G', ...view }).chordpro;
      expect(out.split('\n')[0]).toBe('[Bridge]');
      expect(parseChordPro(out).sections[0]?.label).toBe('Bridge');
    }
  });
});

describe('renderChordProChart key changes', () => {
  it('prints the chords after TRANSPOSE KEY higher, and drops the line', () => {
    const out = renderChordProChart('[G]a\nTRANSPOSE KEY +2\n[G]b', { sourceKey: 'G' }).chordpro;

    expect(out).toBe('[G]a\n[A]b');
  });

  it('adds a key change to the transposition asked for', () => {
    const out = renderChordProChart('[G]a\nTRANSPOSE KEY +1\n[G]b', { sourceKey: 'G', targetKey: 'A' }).chordpro;

    expect(out).toBe('[A]a\n[Bb]b');
  });

  it('leaves the chords after REDEFINE KEY as written', () => {
    expect(renderChordProChart('[G]a\nREDEFINE KEY +2\n[A]b', { sourceKey: 'G' }).chordpro).toBe('[G]a\n[A]b');
  });

  it('numbers the chords after REDEFINE KEY from the new key', () => {
    const out = renderChordProChart('[G]a\nREDEFINE KEY +2\n[A]b [D]c', { sourceKey: 'G', notation: 'numbers' }).chordpro;

    expect(out).toBe('[1]a\n[1]b [4]c');
  });

  it('keeps numbers steady across TRANSPOSE KEY, which moves the key too', () => {
    const out = renderChordProChart('[G]a\nTRANSPOSE KEY +2\n[G]b', { sourceKey: 'G', notation: 'numbers' }).chordpro;

    expect(out).toBe('[1]a\n[1]b');
  });
});

describe('detectKey', () => {
  it('uses the first chord', () => {
    expect(detectKey('[G]Amazing [C]grace')).toBe('G');
    expect(detectKey('Am  F  C  G')).toBe('Am');
    expect(detectKey('no chords here')).toBeNull();
  });
});

describe('parseKey', () => {
  it('splits a root from its quality', () => {
    expect(parseKey('G')).toEqual({ root: 'G', minor: false });
    expect(parseKey('Bbm')).toEqual({ root: 'Bb', minor: true });
    expect(parseKey('F#min')).toEqual({ root: 'F#', minor: true });
    expect(parseKey('nonsense')).toBeNull();
  });
});

describe('preferredAccidental', () => {
  it('uses flats for flat keys and their relative minors', () => {
    expect(preferredAccidental('Eb')).toBe('flats');
    expect(preferredAccidental('F')).toBe('flats');
    // Dm is the relative minor of F, so it is written with flats too.
    expect(preferredAccidental('Dm')).toBe('flats');
  });

  it('uses sharps elsewhere', () => {
    expect(preferredAccidental('G')).toBe('sharps');
    expect(preferredAccidental('A')).toBe('sharps');
    expect(preferredAccidental(null)).toBe('sharps');
  });
});

describe('transposeKey', () => {
  it('keeps the quality and honours the spelling', () => {
    expect(transposeKey('G', 2)).toBe('A');
    expect(transposeKey('Am', 3)).toBe('Cm');
    expect(transposeKey('A', 1, 'flats')).toBe('Bb');
    expect(transposeKey('A', 1, 'sharps')).toBe('A#');
  });
});

describe('chordToNumber', () => {
  it('numbers the diatonic chords of a major key', () => {
    expect(chordToNumber('G', 'G')).toBe('1');
    expect(chordToNumber('C', 'G')).toBe('4');
    expect(chordToNumber('D7', 'G')).toBe('57');
    expect(chordToNumber('Em', 'G')).toBe('6m');
    expect(chordToNumber('Bm', 'G')).toBe('3m');
  });

  it('counts a minor key from its own root', () => {
    expect(chordToNumber('Am', 'Am')).toBe('1m');
    expect(chordToNumber('C', 'Am')).toBe('b3');
    expect(chordToNumber('F', 'Am')).toBe('b6');
  });

  it('numbers the bass note too', () => {
    expect(chordToNumber('C/E', 'C')).toBe('1/3');
    expect(chordToNumber('G/B', 'C')).toBe('5/7');
  });

  it('leaves an unreadable token alone', () => {
    expect(chordToNumber('N.C.', 'C')).toBe('N.C.');
    expect(chordToNumber('C', 'nonsense')).toBe('C');
  });
});

describe('chordToNumeral', () => {
  it('carries quality in the case of the numeral', () => {
    expect(chordToNumeral('G', 'G')).toBe('I');
    expect(chordToNumeral('Em', 'G')).toBe('vi');
    expect(chordToNumeral('D7', 'G')).toBe('V7');
    expect(chordToNumeral('Em7', 'G')).toBe('vi7');
  });

  it('flats the non-diatonic degrees', () => {
    expect(chordToNumeral('F', 'G')).toBe('bVII');
    expect(chordToNumeral('Bb', 'C')).toBe('bVII');
  });

  it('numbers an inversion by degree', () => {
    expect(chordToNumeral('C/E', 'C')).toBe('I/3');
  });
});

describe('stripChords', () => {
  it('leaves lyrics and directives behind', () => {
    expect(stripChords('{title: Hymn}\n[G]Amazing [C]grace')).toBe('{title: Hymn}\nAmazing grace');
  });
});

describe('convertChordProNotation', () => {
  const source = '{title: Test}\n[G]Đưa đôi tay [C]lên cao';

  it('passes chords through untouched', () => {
    expect(convertChordProNotation(source, 'G', 'chords')).toBe(source);
  });

  it('rewrites to numbers and numerals', () => {
    expect(convertChordProNotation(source, 'G', 'numbers')).toBe('{title: Test}\n[1]Đưa đôi tay [4]lên cao');
    expect(convertChordProNotation(source, 'G', 'numerals')).toBe('{title: Test}\n[I]Đưa đôi tay [IV]lên cao');
  });
});

describe('renderChordProChart', () => {
  const source = '[G]Đưa đôi tay [D7]lên cao con thờ phượng [C]Chúa.';

  it('transposes to a target key and reports the shift', () => {
    const chart = renderChordProChart(source, { sourceKey: 'G', targetKey: 'A' });
    expect(chart.chordpro).toBe('[A]Đưa đôi tay [E7]lên cao con thờ phượng [D]Chúa.');
    expect(chart.key).toBe('A');
    expect(chart.semitones).toBe(2);
  });

  it('spells a flat target key with flats', () => {
    const chart = renderChordProChart(source, { sourceKey: 'G', targetKey: 'Eb' });
    expect(chart.chordpro).toContain('[Eb]');
    expect(chart.chordpro).toContain('[Bb7]');
  });

  it('spells a semitone shift that lands on a flat key with flats (W10-FGH-D3)', () => {
    const chart = renderChordProChart('[G]a [C]b [D/F#]c', { sourceKey: 'G', semitones: -2 });
    expect(chart.key).toBe('F');
    expect(chart.chordpro).toBe('[F]a [Bb]b [C/E]c');
    expect(renderChordProChart('[Am]a [F]b', { sourceKey: 'Am', semitones: 5 }).chordpro).toBe('[Dm]a [Bb]b');
    expect(renderChordProChart('[G]a [C]b', { sourceKey: 'G', semitones: -1 }).key).toBe('F#');
  });

  it('keeps slash bass text: a bass note moves, unknown text stays (W10-FGH-D3)', () => {
    expect(renderChordProChart('[G#m7b9#11/Q]x', { sourceKey: 'G', targetKey: 'A' }).chordpro).toBe('[A#m7b9#11/Q]x');
    expect(renderChordProChart('[G/B]x [C/Bb7]y', { sourceKey: 'G', targetKey: 'A' }).chordpro).toBe('[A/C#]x [D/C7]y');
    expect(transposeChord('C/E/G', 2)).toBe('D/F#/G');
    expect(renderChordProChart('[D/Q]x', { sourceKey: 'G', notation: 'numbers' }).chordpro).toBe('[5/Q]x');
  });

  it('renames the key when shifting by semitones alone', () => {
    const chart = renderChordProChart(source, { sourceKey: 'G', semitones: 2 });
    expect(chart.key).toBe('A');
  });

  it('reads numbers off the source key rather than transposing', () => {
    const chart = renderChordProChart(source, {
      sourceKey: 'G',
      targetKey: 'A',
      notation: 'numbers',
    });
    expect(chart.chordpro).toBe('[1]Đưa đôi tay [57]lên cao con thờ phượng [4]Chúa.');
    expect(chart.key).toBeNull();
    expect(chart.semitones).toBe(0);
  });

  it('drops the chords for the lyrics sheet', () => {
    const chart = renderChordProChart(source, { sourceKey: 'G', notation: 'lyrics' });
    expect(chart.chordpro).toBe('Đưa đôi tay lên cao con thờ phượng Chúa.');
    expect(chart.key).toBeNull();
  });

  it('leaves the chart alone when numbers are asked for without a key', () => {
    const chart = renderChordProChart(source, { sourceKey: null, notation: 'numbers' });
    expect(chart.chordpro).toBe(source);
  });
});

describe('renderChordProChart minor keys', () => {
  it('reads a bare target root as minor when the song is', () => {
    const chart = renderChordProChart('[Am]Lúa [Dm]thiêng', { sourceKey: 'Am', targetKey: 'C' });
    expect(chart.key).toBe('Cm');
    expect(chart.semitones).toBe(3);
    expect(chart.chordpro).toBe('[Cm]Lúa [Fm]thiêng');
  });

  it('leaves an explicit quality alone', () => {
    expect(renderChordProChart('[C]x', { sourceKey: 'C', targetKey: 'Am' }).key).toBe('Am');
  });
});

describe('toChordPro', () => {
  it('keeps section headings when folding a chords-above-lyrics chart', () => {
    const out = toChordPro('TAG\nG      C\nAmazing grace');

    expect(out).toContain('{start_of_tag: TAG}');
    expect(out).toContain('{end_of_tag}');
  });

  it('leaves an inline ChordPro chart exactly as typed', () => {
    const source = '[G]Amazing [C]grace';
    expect(toChordPro(source)).toBe(source);
  });

  it('folds a chords-above-lyrics chart into inline ChordPro', () => {
    const pasted = 'G            C\nAmazing grace how sweet';
    expect(toChordPro(pasted)).toContain('[G]Amazing grace[C]');
  });

  it('leaves plain lyrics alone', () => {
    expect(toChordPro('Amazing grace how sweet the sound')).toBe(
      'Amazing grace how sweet the sound',
    );
  });

  it('is empty for blank input', () => {
    expect(toChordPro('   \n  ')).toBe('');
  });
});
