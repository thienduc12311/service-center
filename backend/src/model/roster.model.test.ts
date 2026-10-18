import { describe, expect, it } from 'vitest';
import type { GlobalSearchHit, PersonTagGroupRow } from '@service-center/shared';
import { buildTagCatalog, searchPattern, summarizeBulkPreview, toSearchGroup, withActorNames } from './roster.model.js';

const group = (id: string, name: string, sort_order = 0): PersonTagGroupRow => ({
  id,
  organization_id: 'org',
  name,
  sort_order,
  created_at: '2026-10-17T00:00:00Z',
});

describe('summarizeBulkPreview', () => {
  it('counts what will change, what already holds and what cannot be applied', () => {
    const summary = summarizeBulkPreview([
      { person_id: 'a', display_name: 'Ana', outcome: 'change', problem: null },
      { person_id: 'b', display_name: 'Ben', outcome: 'unchanged', problem: null },
      { person_id: 'c', display_name: null, outcome: 'error', problem: 'not_found' },
      { person_id: 'd', display_name: 'Dee', outcome: 'change', problem: null },
    ]);
    expect(summary).toMatchObject({ changes: 2, unchanged: 1, errors: 1 });
    expect(summary.rows).toHaveLength(4);
  });
});

describe('buildTagCatalog', () => {
  it('merges tags in use with catalogued ones and counts carriers', () => {
    const catalog = buildTagCatalog(
      [group('g2', 'Languages', 1), group('g1', 'Instruments', 0)],
      [
        { tag: 'bass', group_id: 'g1' },
        { tag: 'spanish', group_id: 'g2' },
      ],
      ['bass', 'bass', 'keys'],
    );
    expect(catalog.groups.map((g) => g.name)).toEqual(['Instruments', 'Languages']);
    expect(catalog.tags).toEqual([
      { tag: 'bass', group_id: 'g1', people: 2 },
      { tag: 'keys', group_id: null, people: 1 },
      { tag: 'spanish', group_id: 'g2', people: 0 },
    ]);
  });
});

describe('withActorNames', () => {
  it('names known actors and leaves system or removed actors unnamed', () => {
    const base = {
      organization_id: 'org',
      person_id: 'p',
      person_label: 'Gina Guest',
      action: 'archived' as const,
      detail: {},
      created_at: '2026-10-17T00:00:00Z',
    };
    const events = withActorNames(
      [
        { ...base, id: '1', actor_id: 'u1' },
        { ...base, id: '2', actor_id: null },
        { ...base, id: '3', actor_id: 'gone' },
      ],
      new Map([['u1', 'Olivia Owner']]),
    );
    expect(events.map((e) => e.actor_name)).toEqual(['Olivia Owner', null, null]);
  });
});

describe('searchPattern', () => {
  it('matches wildcards and filter syntax literally', () => {
    expect(searchPattern('50%_off')).toBe('%50\\%\\_off%');
    expect(searchPattern('a,b(c)')).toBe('%a b c%');
  });
});

describe('toSearchGroup', () => {
  const hit = (id: string): GlobalSearchHit => ({ kind: 'song', id, title: id, subtitle: null, href: `/songs/${id}` });

  it('reports more visible matches without exposing a total', () => {
    expect(toSearchGroup('song', [hit('a'), hit('b'), hit('c')], 2)).toEqual({
      kind: 'song',
      hits: [hit('a'), hit('b')],
      has_more: true,
    });
    expect(toSearchGroup('song', [hit('a')], 2).has_more).toBe(false);
  });
});
