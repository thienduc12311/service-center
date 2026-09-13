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
