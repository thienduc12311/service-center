import { describe, expect, it } from 'vitest';
import { foldForSearch, matchesSearch, needsListSearch } from './list-search';
import {
  OPTION_CHIP_LIMIT,
  filterOptions,
  groupOptions,
  nextSelection,
  optionSections,
  selectedLabels,
  usesSearchableList,
  type SearchableOption,
} from './option-groups';

const option = (value: string, label: string, groupKey: string | null = null, groupLabel: string | null = null): SearchableOption => ({
  value,
  label,
  groupKey,
  groupLabel,
});

describe('list search', () => {
  it('ignores accents, đ and case, and matches every word', () => {
    expect(foldForSearch('Đặng Văn Ân')).toBe('dang van an');
    expect(matchesSearch('dang an', ['Đặng Văn Ân'])).toBe(true);
    expect(matchesSearch('dang bao', ['Đặng Văn Ân'])).toBe(false);
    expect(matchesSearch('  ', ['anything'])).toBe(true);
    expect(matchesSearch('band', [null, 'Keys', 'Band'])).toBe(true);
  });

  it('asks for a search box only past the threshold', () => {
    expect(needsListSearch(15)).toBe(false);
    expect(needsListSearch(16)).toBe(true);
    expect(needsListSearch(4, 3)).toBe(true);
  });
});

describe('option groups', () => {
  const options = [
    option('a', 'Sunday', 'st1', 'Sunday service'),
    option('b', 'Youth night', 'st2', 'Youth'),
    option('c', 'Easter', 'st1', 'Sunday service'),
    option('d', 'Any day'),
  ];

  it('keeps chips up to the limit, then a searchable list', () => {
    expect(OPTION_CHIP_LIMIT).toBe(12);
    expect(usesSearchableList(12)).toBe(false);
    expect(usesSearchableList(13)).toBe(true);
  });

  it('groups by first appearance with ungrouped options first', () => {
    expect(groupOptions(options).map((section) => [section.key, section.title, section.data.map((o) => o.value)])).toEqual([
      ['', null, ['d']],
      ['st1', 'Sunday service', ['a', 'c']],
      ['st2', 'Youth', ['b']],
    ]);
  });

  it('moves leading groups to the front', () => {
    expect(groupOptions(options, { leadingGroupKeys: ['st2'] }).map((section) => section.key)).toEqual(['', 'st2', 'st1']);
  });

  it('searches the label, the group and the detail', () => {
    expect(filterOptions(options, 'youth').map((o) => o.value)).toEqual(['b']);
    expect(filterOptions(options, 'sunday').map((o) => o.value)).toEqual(['a', 'c']);
    expect(filterOptions([{ value: 'x', label: 'Keys', detail: 'Bàn phím' }], 'ban phim').map((o) => o.value)).toEqual(['x']);
    expect(optionSections(options, 'east').map((section) => section.key)).toEqual(['st1']);
  });

  it('replaces a single choice and toggles a multiple one', () => {
    expect(nextSelection('single', ['a'], 'b')).toEqual(['b']);
    expect(nextSelection('multi', ['a'], 'b')).toEqual(['a', 'b']);
    expect(nextSelection('multi', ['a', 'b'], 'a')).toEqual(['b']);
  });

  it('names the selection in option order', () => {
    expect(selectedLabels(options, ['c', 'a', 'gone'])).toEqual(['Sunday', 'Easter']);
  });
});
