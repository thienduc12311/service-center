import { describe, expect, it } from 'vitest';
import { MENTION_SUGGESTION_LIMIT, mentionSuggestions, recentAuthorIds } from './mention-suggestions';

const candidates = Array.from({ length: 40 }, (_, index) => ({ person_id: `p${index}`, name: `Person ${index}` }));

describe('mention suggestions', () => {
  it('caps an empty @ and puts priority people first', () => {
    const shown = mentionSuggestions(candidates, '', ['p30', 'gone', 'p2', 'p30']);
    expect(shown).toHaveLength(MENTION_SUGGESTION_LIMIT);
    expect(shown.slice(0, 3).map((c) => c.person_id)).toEqual(['p30', 'p2', 'p0']);
    expect(new Set(shown.map((c) => c.person_id)).size).toBe(shown.length);
  });

  it('filters every candidate once letters are typed', () => {
    const many = [...candidates, { person_id: 'n', name: 'Nguyễn An' }];
    expect(mentionSuggestions(many, 'person').length).toBe(40);
    expect(mentionSuggestions(many, 'nguyen').map((c) => c.person_id)).toEqual(['n']);
  });

  it('orders authors by their latest message', () => {
    expect(recentAuthorIds([
      { author_person_id: 'a' },
      { author_person_id: 'b' },
      { author_person_id: null },
      { author_person_id: 'a' },
    ])).toEqual(['a', 'b']);
  });
});
