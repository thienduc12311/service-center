import { describe, expect, it } from 'vitest';
import { itemDetailsPlainText, parseItemDetails, parseItemDetailsInline, safeDetailsHref, type ItemDetailsRun } from './item-details.js';

const PLAIN = { bold: false, italic: false, strike: false, code: false };
const texts = (runs: readonly ItemDetailsRun[]) => runs.map((run) => run.text).join('');

describe('safeDetailsHref', () => {
  it('keeps http, https and mailto links', () => {
    expect(safeDetailsHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeDetailsHref(' HTTP://example.com ')).toBe('HTTP://example.com');
    expect(safeDetailsHref('mailto:pastor@example.com')).toBe('mailto:pastor@example.com');
  });

  it('refuses script, data, relative and malformed targets', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      '//evil.example.com',
      '/relative/path',
      'https://example.com/"onmouseover="alert(1)',
      'mailto:javascript:alert(1)',
      '',
    ]) {
      expect(safeDetailsHref(href)).toBeNull();
    }
  });
});

describe('parseItemDetailsInline', () => {
  it('styles bold, italic, code and links', () => {
    const runs = parseItemDetailsInline('**Big** and _soft_ `cue` see [the chart](https://example.com/c) or https://x.example');
    expect(runs).toEqual([
      { kind: 'text', text: 'Big', style: { ...PLAIN, bold: true } },
      { kind: 'text', text: ' and ', style: PLAIN },
      { kind: 'text', text: 'soft', style: { ...PLAIN, italic: true } },
      { kind: 'text', text: ' ', style: PLAIN },
      { kind: 'text', text: 'cue', style: { ...PLAIN, code: true } },
      { kind: 'text', text: ' see ', style: PLAIN },
      { kind: 'link', text: 'the chart', href: 'https://example.com/c', style: PLAIN },
      { kind: 'text', text: ' or ', style: PLAIN },
      { kind: 'link', text: 'https://x.example', href: 'https://x.example', style: PLAIN },
    ]);
  });

  it('shows the label of an unsafe link as plain text and never makes a link of it', () => {
    const runs = parseItemDetailsInline('[click me](javascript:alert(1)) [x](data:text/html;base64,PHNjcmlwdD4=)');
    expect(runs.every((run) => run.kind === 'text')).toBe(true);
    expect(texts(runs)).toContain('click me');
  });

  it('keeps typed HTML as literal text', () => {
    const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const runs = parseItemDetailsInline(payload);
    expect(runs).toEqual([{ kind: 'text', text: payload, style: PLAIN }]);
  });
});

describe('parseItemDetails', () => {
  it('reads headings, lists and paragraphs', () => {
    const blocks = parseItemDetails('# Plan\n## Notes\nLine one\nline two\n\n- a\n* b\n1. first\n2) second\n\nAfter');
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'heading', 'paragraph', 'list', 'list', 'paragraph']);
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({ kind: 'heading', level: 2 });
    const paragraph = blocks[2]!;
    expect(paragraph.kind === 'paragraph' && paragraph.lines.map(texts)).toEqual(['Line one', 'line two']);
    const bullets = blocks[3]!;
    expect(bullets.kind === 'list' && !bullets.ordered && bullets.items.map(texts)).toEqual(['a', 'b']);
    const numbered = blocks[4]!;
    expect(numbered.kind === 'list' && numbered.ordered && numbered.start === 1 && numbered.items.map(texts)).toEqual(['first', 'second']);
  });

  it('keeps a numbered list start and treats "#tag" and "**bold**" as text', () => {
    const blocks = parseItemDetails('3. three\n4. four\n\n#tag\n**bold** line');
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: true, start: 3 });
    expect(blocks[1]).toMatchObject({ kind: 'paragraph' });
    expect(blocks).toHaveLength(2);
  });

  it('is empty for blank or missing text and accepts Windows line breaks', () => {
    expect(parseItemDetails('')).toEqual([]);
    expect(parseItemDetails(null)).toEqual([]);
    expect(parseItemDetails('  \n\n')).toEqual([]);
    expect(parseItemDetails('a\r\nb')).toHaveLength(1);
  });

  it('gives plain text for previews', () => {
    expect(itemDetailsPlainText('## Cue\n- **Soft** start\n- [Chart](https://example.com)')).toBe('Cue\nSoft start\nChart');
  });
});
