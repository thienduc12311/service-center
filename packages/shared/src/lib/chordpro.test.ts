import { describe, expect, it } from 'vitest';
import {
  chordLinesToChordPro,
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
