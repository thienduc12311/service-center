import { describe, expect, it } from 'vitest';
import { formatMessageText, type MessageRun, type MessageTextStyle } from './message-format.js';
import type { MentionTarget } from './mentions.js';

const plain: MessageTextStyle = { bold: false, italic: false, strike: false, code: false };
const s = (style: Partial<MessageTextStyle>): MessageTextStyle => ({ ...plain, ...style });
const bea = { person_id: 'p-bea', name: 'Bea One' };

/** Compact view: each run as [kind, text, styles…]. */
const view = (runs: Array<MessageRun<MentionTarget>>) =>
  runs.map((run) => [
    run.kind,
    run.text,
    ...(['bold', 'italic', 'strike', 'code'] as const).filter((key) => run.style[key]),
  ]);

describe('formatMessageText', () => {
  it('keeps plain text, including typed HTML, as literal text', () => {
    expect(formatMessageText('<b>bold</b> & "quote"', [])).toEqual([
      { kind: 'text', text: '<b>bold</b> & "quote"', style: plain },
    ]);
    expect(formatMessageText('', [])).toEqual([{ kind: 'text', text: '', style: plain }]);
  });

  it('formats bold, italic, strike and code', () => {
    expect(view(formatMessageText('a **b** *c* _d_ ~~e~~ `f`', []))).toEqual([
      ['text', 'a '],
      ['text', 'b', 'bold'],
      ['text', ' '],
      ['text', 'c', 'italic'],
      ['text', ' '],
      ['text', 'd', 'italic'],
      ['text', ' '],
      ['text', 'e', 'strike'],
      ['text', ' '],
      ['text', 'f', 'code'],
    ]);
  });

  it('nests styles', () => {
    expect(view(formatMessageText('**bold _and italic_**', []))).toEqual([
      ['text', 'bold ', 'bold'],
      ['text', 'and italic', 'bold', 'italic'],
    ]);
  });

  it('leaves unmatched, empty or space-flanked markers as typed', () => {
    expect(view(formatMessageText('2 * 3 * 4', []))).toEqual([['text', '2 * 3 * 4']]);
    expect(view(formatMessageText('**open only', []))).toEqual([['text', '**open only']]);
    expect(view(formatMessageText('****', []))).toEqual([['text', '****']]);
    expect(view(formatMessageText('a ** b **', []))).toEqual([['text', 'a ** b **']]);
  });

  it('does not italicise inside snake_case words', () => {
    expect(view(formatMessageText('use snake_case_name here', []))).toEqual([['text', 'use snake_case_name here']]);
  });

  it('keeps dunder names and doubled underscores literal', () => {
    for (const text of ['a.__init__ then b.__init__', 'window.__xss', 'snake_case_words', '__init__', 'x __y__ z']) {
      expect(view(formatMessageText(text, []))).toEqual([['text', text]]);
    }
  });

  it('still italicises a standalone underscore pair and leaves asterisks unchanged', () => {
    expect(view(formatMessageText('a _b_ c', []))).toEqual([['text', 'a '], ['text', 'b', 'italic'], ['text', ' c']]);
    expect(view(formatMessageText('foo*bar*baz', []))).toEqual([['text', 'foo'], ['text', 'bar', 'italic'], ['text', 'baz']]);
  });

  it('never carries formatting across a line break', () => {
    expect(view(formatMessageText('**one\ntwo**', []))).toEqual([['text', '**one\ntwo**']]);
    expect(view(formatMessageText('**one**\ntwo', []))).toEqual([['text', 'one', 'bold'], ['text', '\ntwo']]);
  });

  it('shows code verbatim, without formatting or mentions inside', () => {
    expect(view(formatMessageText('run `**npm** @Bea One`', [bea]))).toEqual([
      ['text', 'run '],
      ['text', '**npm** @Bea One', 'code'],
    ]);
  });

  it('finds mentions, and lets formatting wrap them', () => {
    expect(formatMessageText('**@Bea One** please', [bea])).toEqual([
      { kind: 'mention', text: '@Bea One', target: bea, style: s({ bold: true }) },
      { kind: 'text', text: ' please', style: plain },
    ]);
  });

  it('links bare http(s) URLs and trims sentence punctuation', () => {
    expect(formatMessageText('see https://example.com/a?b=1.', [])).toEqual([
      { kind: 'text', text: 'see ', style: plain },
      { kind: 'link', text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1', style: plain },
      { kind: 'text', text: '.', style: plain },
    ]);
    expect(view(formatMessageText('(https://en.wikipedia.org/wiki/Foo_(bar))', []))).toEqual([
      ['text', '('],
      ['link', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
      ['text', ')'],
    ]);
    expect(view(formatMessageText('**https://example.com**', []))).toEqual([['link', 'https://example.com', 'bold']]);
  });

  it('links only http(s), never other schemes', () => {
    expect(view(formatMessageText('javascript:alert(1) ftp://x.y', []))).toEqual([['text', 'javascript:alert(1) ftp://x.y']]);
  });
});
