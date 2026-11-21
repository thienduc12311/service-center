import { describe, expect, it } from 'vitest';
import { foldSearchText, searchWords } from './search.js';

describe('foldSearchText', () => {
  it('drops Vietnamese accents and case, mapping đ/Đ to d', () => {
    expect(foldSearchText('Nguyễn')).toBe('nguyen');
    expect(foldSearchText('Chúa Là Tình Yêu')).toBe('chua la tinh yeu');
    expect(foldSearchText('ĐẶNG đức')).toBe('dang duc');
  });

  it('maps letters NFD cannot decompose like Postgres unaccent does', () => {
    expect(foldSearchText('Łukasz Øster Straße Æsir Œuvre')).toBe('lukasz oster strasse aesir oeuvre');
  });

  it('folds decomposed input (base letter + combining mark) too', () => {
    expect(foldSearchText('Chào')).toBe('chao');
  });
});

describe('searchWords', () => {
  it('splits on any whitespace and drops blanks', () => {
    expect(searchWords('  Đặng \t An  ')).toEqual(['dang', 'an']);
  });

  it('is empty for no query', () => {
    expect(searchWords('')).toEqual([]);
    expect(searchWords('   ')).toEqual([]);
    expect(searchWords(undefined)).toEqual([]);
    expect(searchWords(null)).toEqual([]);
  });

  it('keeps wildcard characters as text (escaping is the query builder’s job)', () => {
    expect(searchWords('50% a_b')).toEqual(['50%', 'a_b']);
  });
});
