import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CHART_PAGINATION_SCRIPT_SHA256,
  DEFAULT_CHART_FONT,
  DEFAULT_CHART_FORMATTING,
  chartColumnCharacters,
  chartDocumentCspMeta,
  chartDocumentTitle,
  chartFormattingFromRow,
  escapeHtml,
  renderChartHtml,
  resolveChartFormatting,
  wrapChartLine,
  type ChartDocument,
} from './chart-html.js';
import { CHART_FONT_VALUES } from './constants.js';

const doc = (overrides: Partial<ChartDocument> = {}): ChartDocument => ({
  title: 'Nothing Is Impossible',
  key: 'C',
  arrangementName: 'Default Arrangement',
  author: 'Jonathan Hunt',
  sequence: ['Intro', 'Verse', 'Chorus'],
  copyright: '© 2008 Planet Shakers Ministries Int. Inc.',
  chordpro: '[C]Through You I can do any[G]thing',
  formatting: DEFAULT_CHART_FORMATTING,
  ...overrides,
});

describe('chartDocumentTitle', () => {
  it('carries the key alongside the title', () => {
    expect(chartDocumentTitle({ title: 'Nothing Is Impossible', key: 'C' })).toBe(
      'Nothing Is Impossible [C]',
    );
  });

  it('drops the brackets when the chart has no key', () => {
    expect(chartDocumentTitle({ title: 'Doxology', key: null })).toBe('Doxology');
  });
});

describe('escapeHtml', () => {
  it('escapes everything that could close a tag or an attribute', () => {
    expect(escapeHtml(`<b>"Grace" & 'truth'</b>`)).toBe(
      '&lt;b&gt;&quot;Grace&quot; &amp; &#39;truth&#39;&lt;/b&gt;',
    );
  });
});

describe('renderChartHtml', () => {
  it('renders a standalone document titled with the song and key', () => {
    const html = renderChartHtml(doc());

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Nothing Is Impossible [C]</title>');
    expect(html).toContain('<h1 class="chart-title">Nothing Is Impossible [C]</h1>');
    // Nothing to fetch — the tab and the PDF get the same bytes. The one
    // script the document carries is inline, and paginates it.
    expect(html).not.toContain('<link');
    expect(html).not.toContain('src=');
    expect(html).not.toContain('@import');
  });

  it('prints the byline and the sequence under the title', () => {
    const html = renderChartHtml(doc());

    expect(html).toContain('[Default Arrangement] by Jonathan Hunt');
    expect(html).toContain('<p class="chart-sequence">Intro, Verse, Chorus</p>');
  });

  it('omits the byline, sequence and footer a chart does not have', () => {
    const html = renderChartHtml(
      doc({ arrangementName: null, author: null, sequence: [], copyright: null }),
    );

    expect(html).not.toContain('<p class="chart-byline">');
    expect(html).not.toContain('<p class="chart-sequence">');
    expect(html).not.toContain('<footer class="chart-footer">');
  });

  it('lays the chords out above their lyrics', () => {
    const html = renderChartHtml(doc());

    expect(html).toContain('<div class="chords">C                       G</div>');
    expect(html).toContain('<div class="lyrics">Through You I can do anything</div>');
  });

  it('escapes song text rather than letting it become markup', () => {
    const html = renderChartHtml(doc({ title: '<script>alert(1)</script>' }));

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('switches the body to two columns when asked', () => {
    const one = renderChartHtml(doc());
    const two = renderChartHtml(
      doc({ formatting: { ...DEFAULT_CHART_FORMATTING, columns: 2 } }),
    );

    expect(one).toContain('data-columns="1"');
    expect(two).toContain('data-columns="2"');
    // The pagination script is a constant (so the CSP can allow it by hash)
    // and takes the column count from the body.
    expect(one).toContain("document.body.getAttribute('data-columns')");
  });

  it('separates two columns by a gap alone, with no rule between them', () => {
    const two = renderChartHtml(
      doc({ formatting: { ...DEFAULT_CHART_FORMATTING, columns: 2 } }),
    );

    expect(two).toContain('gap: 0.35in');
    expect(two).not.toContain('column-rule');
  });

  it('lays the chart out on US Letter paper, margins included in the page box', () => {
    const html = renderChartHtml(doc());

    expect(html).toContain('@page { size: 8.5in 11in; margin: 0; }');
    expect(html).toContain('width: 8.5in');
    expect(html).toContain('height: 11in');
    expect(html).toContain('padding: 0.5in');
  });

  it('carries what the extra pages need: a continuation header and a page footer', () => {
    const html = renderChartHtml(doc());

    // The continuation band repeats the song so a later page is identifiable.
    expect(html).toContain('<h2 class="chart-title-cont">Nothing Is Impossible [C]</h2>');
    expect(html).toContain('class="page-number"');
    expect(html).toContain('break-after: page');
  });

  it('wraps an over-long line instead of letting it leave the page', () => {
    const html = renderChartHtml(doc());

    expect(html).toContain('white-space: pre-wrap');
    expect(html).toContain('overflow-wrap: break-word');
    // The page itself clips anything that somehow still escapes.
    expect(html).toContain('overflow: hidden');
  });

  it('applies the font, size and chord colour it is given', () => {
    const html = renderChartHtml(
      doc({
        formatting: {
          columns: 1,
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: 16,
          chordColor: '#1d4ed8',
        },
      }),
    );

    expect(html).toContain('font-family: Arial, Helvetica, sans-serif;');
    expect(html).toContain('font-size: 16pt;');
    expect(html).toContain('color: #1d4ed8;');
  });

  it('prints headings, notes and formatting written into the chart', () => {
    const html = renderChartHtml(doc({ chordpro: 'VERSE 1\n<b>Ho[G]ly</b> <i>One</i>\n{ Repeat 2x }\n{{ Build }}' }));

    expect(html).toContain('<h2 class="section-label">VERSE 1</h2>');
    expect(html).toContain('<span class="m-b">Holy</span> <span class="m-i">One</span>');
    expect(html).toContain('<div class="note">Repeat 2x</div>');
    expect(html).toContain('<div class="note">Build</div>');
  });

  it('escapes formatted text and notes', () => {
    const html = renderChartHtml(doc({ chordpro: '<b><img src=x></b>\n{ <script> }' }));

    expect(html).not.toContain('<img');
    expect(html).toContain('<span class="m-b">&lt;img src=x&gt;</span>');
    expect(html).toContain('<div class="note">&lt;script&gt;</div>');
  });

  it('keeps formatting on the right words once a line is wrapped', () => {
    const narrow = { ...DEFAULT_CHART_FORMATTING, fontSize: 40 };
    const html = renderChartHtml(doc({ chordpro: `${'a '.repeat(30)}<u>end</u>`, formatting: narrow }));

    expect(html).toContain('<span class="m-u">end</span>');
    expect(html.match(/m-u/g)).toHaveLength(2); // the stylesheet rule and the one run
  });

  it('marks column and page breaks for pagination', () => {
    const html = renderChartHtml(doc({ chordpro: 'VERSE\na\nCOLUMN_BREAK\nCHORUS\nb\nPAGE_BREAK\nTAG\nc' }));

    expect(html).toContain('<div class="chart-break" data-break="column"></div>');
    expect(html).toContain('<div class="chart-break" data-break="page"></div>');
  });

  it('renders an empty chart without throwing', () => {
    expect(() => renderChartHtml(doc({ chordpro: '' }))).not.toThrow();
  });
});

describe('chartFormattingFromRow', () => {
  it('maps the arrangement columns onto the template settings', () => {
    expect(
      chartFormattingFromRow({
        chart_columns: 2,
        chart_font: 'Arial, Helvetica, sans-serif',
        chart_font_size: 14,
        chart_chord_color: '#b91c1c',
      }),
    ).toEqual({
      columns: 2,
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: 14,
      chordColor: '#b91c1c',
    });
  });

  it('falls back to the defaults for a row that was never formatted', () => {
    expect(chartFormattingFromRow({})).toEqual(DEFAULT_CHART_FORMATTING);
  });
});

describe('chartColumnCharacters', () => {
  it('fits a full-width line across a single column', () => {
    expect(chartColumnCharacters(DEFAULT_CHART_FORMATTING)).toBe(73);
  });

  it('halves the line when the chart is set in two columns', () => {
    expect(chartColumnCharacters({ ...DEFAULT_CHART_FORMATTING, columns: 2 })).toBe(35);
  });

  it('fits fewer characters as the type gets bigger', () => {
    const small = chartColumnCharacters({ ...DEFAULT_CHART_FORMATTING, fontSize: 8 });
    const large = chartColumnCharacters({ ...DEFAULT_CHART_FORMATTING, fontSize: 20 });
    expect(small).toBeGreaterThan(large);
  });
});

describe('wrapChartLine', () => {
  it('leaves a line that fits alone', () => {
    const line = { chordRow: 'G      C', lyricRow: 'Amazing grace' };
    expect(wrapChartLine(line, 40)).toEqual([line]);
  });

  it('breaks the chords at the same column as the words', () => {
    // C stands two columns before "grace", D two before "sweet".
    const chordRow = 'G       C           D';
    const lyricRow = 'Amazing grace how sweet';

    expect(wrapChartLine({ chordRow, lyricRow }, 14)).toEqual([
      { chordRow: 'G       C', lyricRow: 'Amazing grace' },
      { chordRow: '      D', lyricRow: 'how sweet' },
    ]);
  });

  it('never cuts a chord name in half', () => {
    const chordRow = '             Bmaj7';
    const lyricRow: string = 'Amazing grace how sweet the sound';

    for (const part of wrapChartLine({ chordRow, lyricRow }, 16)) {
      expect(part.chordRow).not.toMatch(/\bBma?j?$/);
    }
  });

  it('keeps a chord over its own syllable once the line is broken', () => {
    //                             the chord sits over "sweet"
    const chordRow = '                  D';
    const lyricRow = 'Amazing grace how sweet';

    const [, continuation] = wrapChartLine({ chordRow, lyricRow }, 14);
    expect(continuation?.lyricRow).toBe('how sweet');
    expect(continuation?.chordRow.indexOf('D')).toBe(continuation?.lyricRow.indexOf('sweet'));
  });

  it('carries a chord that sits past the end of the words onto the next line', () => {
    const chordRow = '                        Em';
    const lyricRow = 'Amazing grace how sweet';

    expect(wrapChartLine({ chordRow, lyricRow }, 23)).toEqual([
      { chordRow: '', lyricRow: 'Amazing grace how sweet' },
      { chordRow: 'Em', lyricRow: '' },
    ]);
  });

  it('breaks a word wider than the column rather than running off the page', () => {
    const parts = wrapChartLine({ chordRow: '', lyricRow: 'Supercalifragilistic' }, 8);

    expect(parts.map((part) => part.lyricRow)).toEqual(['Supercal', 'ifragili', 'stic']);
  });

  it('gives every line it produces to the chart', () => {
    const html = renderChartHtml(
      doc({
        chordpro:
          '[G]Amazing grace how sweet the sound that saved a wretch like me, I [C]once was lost',
        formatting: { ...DEFAULT_CHART_FORMATTING, columns: 2 },
      }),
    );

    // Two columns at 12pt hold 35 characters, so this line cannot be one row.
    expect(html.match(/class="row"/g)?.length).toBeGreaterThan(1);
    expect(html).not.toContain('sound that saved a wretch like me');
  });
});

const MALICIOUS_FONT = "x;}</style><script>alert(document.domain)</script><style>";

/** The inline script's base64 SHA-256, as a CSP hash source names it. */
const scriptHashes = (html: string): string[] =>
  Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), (match) =>
    createHash('sha256').update(match[1] ?? '', 'utf8').digest('base64'),
  );

describe('chart document safety', () => {
  it('never prints a font it does not offer, falling back to the default', () => {
    const html = renderChartHtml(
      doc({ formatting: { ...DEFAULT_CHART_FORMATTING, fontFamily: MALICIOUS_FONT } }),
    );

    expect(html).not.toContain('alert(document.domain)');
    expect(html.match(/<\/style>/g)).toHaveLength(1);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain(`--chart-font: ${DEFAULT_CHART_FONT};`);
  });

  it('prints every offered font as given', () => {
    for (const font of CHART_FONT_VALUES) {
      const html = renderChartHtml(doc({ formatting: { ...DEFAULT_CHART_FORMATTING, fontFamily: font } }));
      expect(html).toContain(`--chart-font: ${font};`);
    }
  });

  it('carries a CSP that allows only its own pagination script', () => {
    const html = renderChartHtml(doc());
    const hashes = scriptHashes(html);

    expect(hashes).toHaveLength(1);
    // A failure here after editing the pagination script: set
    // CHART_PAGINATION_SCRIPT_SHA256 to the expected value.
    expect(CHART_PAGINATION_SCRIPT_SHA256).toBe(hashes[0]);
    expect(html).toContain(chartDocumentCspMeta(CHART_PAGINATION_SCRIPT_SHA256));
    expect(html).toContain("default-src 'none'");
    // The policy has to come before anything it governs.
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<style>'));
  });
});

describe('resolveChartFormatting', () => {
  it('applies the template defaults', () => {
    expect(resolveChartFormatting(DEFAULT_CHART_FORMATTING)).toEqual({
      columns: 1,
      fontFamily: DEFAULT_CHART_FONT,
      fontSize: 12,
      chordColor: '#000000',
    });
  });

  it('keeps values the database would hold', () => {
    expect(
      resolveChartFormatting({ columns: 2, fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 16, chordColor: '#1d4ed8' }),
    ).toEqual({ columns: 2, fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 16, chordColor: '#1d4ed8' });
  });

  it('replaces anything else with the default', () => {
    const hostile = {
      columns: '1;}</style>' as unknown as 1,
      fontFamily: 'Comic Sans MS',
      fontSize: '12pt;}</style>' as unknown as number,
      chordColor: 'red;}</style>',
    };

    expect(resolveChartFormatting(hostile)).toEqual(resolveChartFormatting(DEFAULT_CHART_FORMATTING));
    expect(resolveChartFormatting({ ...DEFAULT_CHART_FORMATTING, fontSize: 1000 }).fontSize).toBe(12);
  });

  it('defaults to a font that is on the offered list', () => {
    expect(CHART_FONT_VALUES).toContain(DEFAULT_CHART_FONT);
  });
});
