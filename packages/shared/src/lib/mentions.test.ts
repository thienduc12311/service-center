import { describe, expect, it } from 'vitest';
import {
  activeMentionQuery,
  filterMentionCandidates,
  findMentionQuery,
  insertMention,
  normalizeMentionText,
  resolveMentionIds,
  splitMentions,
} from './mentions.js';

const duc = { person_id: 'p-duc', name: 'Đức Nguyễn' };
const ann = { person_id: 'p-ann', name: 'Ann Lee' };
const anna = { person_id: 'p-anna', name: 'Anna Lee' };
const bao = { person_id: 'p-bao', name: 'Bảo Trần' };

describe('normalizeMentionText', () => {
  it('drops case and Vietnamese accents', () => {
    expect(normalizeMentionText('Đức Nguyễn')).toBe('duc nguyen');
  });
});

describe('findMentionQuery', () => {
  it('finds an @ at the start or after whitespace', () => {
    expect(findMentionQuery('@', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(findMentionQuery('hi @du', 6)).toEqual({ start: 3, end: 6, query: 'du' });
    expect(findMentionQuery('line\n@an', 8)).toEqual({ start: 5, end: 8, query: 'an' });
  });

  it('keeps spaces so full names can be typed', () => {
    expect(findMentionQuery('hi @ann l', 9)?.query).toBe('ann l');
  });

  it('ignores an @ inside a word such as an email address', () => {
    expect(findMentionQuery('mail foo@bar', 12)).toBeNull();
  });

  it('stops at a line break or when no @ is near', () => {
    expect(findMentionQuery('@ann\nhello', 10)).toBeNull();
    expect(findMentionQuery('hello', 5)).toBeNull();
  });

  it('only looks before the caret', () => {
    expect(findMentionQuery('@ann and more', 4)).toEqual({ start: 0, end: 4, query: 'ann' });
  });
});

describe('activeMentionQuery', () => {
  it('closes once the caret is past a picked name', () => {
    expect(activeMentionQuery('hi @Ann Lee ', 12, [ann])).toBeNull();
    expect(activeMentionQuery('hi @Ann Lee, ', 12, [ann])).toBeNull();
  });

  it('stays open while the picked name is still being typed or was not picked', () => {
    expect(activeMentionQuery('hi @Ann Lee', 11, [ann])?.query).toBe('Ann Lee');
    expect(activeMentionQuery('hi @Ann Lee ', 12, [])?.query).toBe('Ann Lee ');
    expect(activeMentionQuery('hi @Ann Leex', 12, [ann])?.query).toBe('Ann Leex');
  });
});

describe('filterMentionCandidates', () => {
  const people = [ann, anna, bao, duc];

  it('matches everyone for an empty query', () => {
    expect(filterMentionCandidates(people, '')).toEqual(people);
  });

  it('matches without accents and on later words, leading matches first', () => {
    expect(filterMentionCandidates(people, 'nguyen')).toEqual([duc]);
    expect(filterMentionCandidates(people, 'DUC')).toEqual([duc]);
    expect(filterMentionCandidates(people, 'lee')).toEqual([ann, anna]);
    expect(filterMentionCandidates([bao, { person_id: 'x', name: 'Tran Bao' }], 'tran')).toEqual([{ person_id: 'x', name: 'Tran Bao' }, bao]);
  });

  it('returns nothing when no name fits', () => {
    expect(filterMentionCandidates(people, 'zed')).toEqual([]);
  });
});

describe('insertMention', () => {
  it('replaces the query with the name and a trailing space', () => {
    const text = 'hi @an';
    expect(insertMention(text, { start: 3, end: 6, query: 'an' }, 'Ann Lee')).toEqual({ text: 'hi @Ann Lee ', caret: 12 });
  });

  it('reuses a following space instead of adding another', () => {
    const text = 'hi @an thanks';
    expect(insertMention(text, { start: 3, end: 6, query: 'an' }, 'Ann Lee')).toEqual({ text: 'hi @Ann Lee thanks', caret: 12 });
  });
});

describe('resolveMentionIds', () => {
  it('keeps picks whose @Name is intact, once each', () => {
    expect(resolveMentionIds('@Ann Lee and @Đức Nguyễn, @Ann Lee', [ann, duc])).toEqual(['p-ann', 'p-duc']);
  });

  it('drops a pick whose text was edited or deleted', () => {
    expect(resolveMentionIds('@Ann Le and hello', [ann, duc])).toEqual([]);
    expect(resolveMentionIds('@Ann Leex', [ann])).toEqual([]);
  });

  it('does not count an @Name glued to a word before it', () => {
    expect(resolveMentionIds('x@Ann Lee', [ann])).toEqual([]);
  });

  it('prefers the longer of two names sharing a start', () => {
    const anne = { person_id: 'p-anne', name: 'Ann' };
    expect(resolveMentionIds('@Ann Lee', [anne, ann])).toEqual(['p-ann']);
  });

  it('allows punctuation right after a name', () => {
    expect(resolveMentionIds('thanks @Ann Lee!', [ann])).toEqual(['p-ann']);
  });
});

describe('splitMentions', () => {
  it('cuts text into plain and mention runs', () => {
    expect(splitMentions('hi @Ann Lee, see @Bảo Trần', [ann, bao])).toEqual([
      { kind: 'text', text: 'hi ' },
      { kind: 'mention', text: '@Ann Lee', target: ann },
      { kind: 'text', text: ', see ' },
      { kind: 'mention', text: '@Bảo Trần', target: bao },
    ]);
  });

  it('returns the whole text when nothing matches', () => {
    expect(splitMentions('hello @Anna', [ann])).toEqual([{ kind: 'text', text: 'hello @Anna' }]);
    expect(splitMentions('', [ann])).toEqual([{ kind: 'text', text: '' }]);
  });
});
