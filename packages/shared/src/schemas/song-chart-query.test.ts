import { describe, expect, it } from 'vitest';
import { chartQuerySchema } from './song.js';

describe('chartQuerySchema (W10-FGH-D3)', () => {
  it('accepts a key a chart can be transposed to', () => {
    for (const to of ['G', 'Bb', 'F#', 'C#m', 'Ebm']) {
      expect(chartQuerySchema.parse({ to }).to).toBe(to);
    }
    expect(chartQuerySchema.parse({ semitones: '-2' }).semitones).toBe(-2);
  });

  it('refuses an unknown key instead of returning the chart unchanged', () => {
    for (const to of ['H', 'Xyz', 'G#m7', 'bb', '']) {
      expect(chartQuerySchema.safeParse({ to }).success).toBe(false);
    }
  });
});
