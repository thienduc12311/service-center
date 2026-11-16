import { describe, expect, it } from 'vitest';
import { churchSlugSchema } from '@service-center/shared';
import { normalizeSlugInput, slugify } from './slug';

describe('slugify', () => {
  it('lowercases and dashes a name', () => {
    expect(slugify('Grace Church Atlanta')).toBe('grace-church-atlanta');
  });

  it('folds accents, including Vietnamese', () => {
    expect(slugify('Hội Thánh Nguồn Sống Đà Nẵng')).toBe('hoi-thanh-nguon-song-da-nang');
    expect(slugify('Église Saint-Étienne')).toBe('eglise-saint-etienne');
  });

  it('collapses punctuation and trims dashes', () => {
    expect(slugify('  St. Mark’s -- Downtown!  ')).toBe('st-mark-s-downtown');
    expect(slugify('Faith & Hope')).toBe('faith-and-hope');
  });

  it('stays within 40 characters without a trailing dash', () => {
    const slug = slugify('The Very Long Name Of A Church That Keeps Going On And On');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
    expect(churchSlugSchema.safeParse(slug).success).toBe(true);
  });

  it('returns an empty string when nothing is usable', () => {
    expect(slugify('教会')).toBe('');
  });
});

describe('normalizeSlugInput', () => {
  it('lowercases and turns spaces into dashes', () => {
    expect(normalizeSlugInput('Grace Church')).toBe('grace-church');
  });
});
