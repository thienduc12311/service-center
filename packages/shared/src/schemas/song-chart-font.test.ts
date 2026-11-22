import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHART_FONT_OPTIONS, CHART_FONT_VALUES } from '../lib/constants.js';
import { createArrangementSchema, createSongSchema, updateArrangementSchema } from './song.js';

describe('arrangement chart_font', () => {
  it('accepts every font the Formatting dialog offers, and null', () => {
    for (const { value } of CHART_FONT_OPTIONS) {
      expect(updateArrangementSchema.parse({ chart_font: value }).chart_font).toBe(value);
      expect(createArrangementSchema.safeParse({ chart_font: value }).success).toBe(true);
    }
    expect(updateArrangementSchema.parse({ chart_font: null }).chart_font).toBeNull();
    expect(updateArrangementSchema.parse({}).chart_font).toBeUndefined();
  });

  it('refuses a font that is not on the list', () => {
    for (const chart_font of ['Comic Sans MS', 'arial, helvetica, sans-serif', 'monospace', '']) {
      expect(updateArrangementSchema.safeParse({ chart_font }).success).toBe(false);
    }
  });

  it('refuses markup or CSS that would break out of the chart stylesheet', () => {
    const injections = [
      "x;}</style><script>alert(document.domain)</script>",
      "'Courier New', Courier, monospace; } body { background: url(https://evil.example/)",
      "'Courier New', Courier, monospace\n</style>",
    ];
    for (const chart_font of injections) {
      expect(updateArrangementSchema.safeParse({ chart_font }).success).toBe(false);
      expect(createArrangementSchema.safeParse({ chart_font }).success).toBe(false);
      expect(
        createSongSchema.safeParse({ title: 'Song', arrangement: { chart_font } }).success,
      ).toBe(false);
    }
  });
});

describe('arrangements_chart_font_valid', () => {
  it('lists exactly the fonts the schema accepts', () => {
    const migration = readFileSync(
      new URL('../../../../supabase/migrations/20261130000100_arrangement_chart_font_check.sql', import.meta.url),
      'utf8',
    );
    const constraint = migration.slice(migration.indexOf('add constraint arrangements_chart_font_valid'));
    const listed = Array.from(constraint.matchAll(/^\s*'((?:[^']|'')*)',?$/gm), (match) =>
      (match[1] ?? '').replace(/''/g, "'"),
    );

    expect(listed).toEqual([...CHART_FONT_VALUES]);
  });
});
