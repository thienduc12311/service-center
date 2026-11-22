import { describe, expect, it } from 'vitest';
import { applyDetailsFormat, type DetailsEdit, type DetailsPlaceholders } from './itemDetailsFormat';

const PLACEHOLDERS: DetailsPlaceholders = { bold: 'bold text', italic: 'italic text', heading: 'Heading', listItem: 'List item', link: 'link text' };
const at = (value: string, start: number, end = start): DetailsEdit => ({ value, selectionStart: start, selectionEnd: end });

describe('applyDetailsFormat', () => {
  it('wraps the selection, or inserts a selected placeholder', () => {
    expect(applyDetailsFormat(at('say hi now', 4, 6), 'bold', PLACEHOLDERS)).toEqual({ value: 'say **hi** now', selectionStart: 6, selectionEnd: 8 });
    expect(applyDetailsFormat(at('', 0), 'italic', PLACEHOLDERS)).toEqual({ value: '_italic text_', selectionStart: 1, selectionEnd: 12 });
  });

  it('prefixes every selected line for headings and lists, replacing an old prefix', () => {
    expect(applyDetailsFormat(at('a\nb\nc', 0, 3), 'bulleted', PLACEHOLDERS).value).toBe('- a\n- b\nc');
    expect(applyDetailsFormat(at('- a\n- b', 0, 7), 'numbered', PLACEHOLDERS).value).toBe('1. a\n2. b');
    expect(applyDetailsFormat(at('intro\ntitle', 8), 'heading', PLACEHOLDERS).value).toBe('intro\n## title');
    expect(applyDetailsFormat(at('', 0), 'bulleted', PLACEHOLDERS).value).toBe('- List item');
  });

  it('makes a link from the selection and selects the URL to type over', () => {
    const edit = applyDetailsFormat(at('see chart', 4, 9), 'link', PLACEHOLDERS);
    expect(edit.value).toBe('see [chart](https://)');
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe('https://');
  });
});
