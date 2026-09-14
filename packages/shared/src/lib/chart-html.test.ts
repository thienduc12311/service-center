import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHART_FORMATTING,
  chartDocumentTitle,
  chartFormattingFromRow,
  escapeHtml,
  renderChartHtml,
  type ChartDocument,
} from './chart-html.js';

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
    expect(one).toContain('var COLUMNS = 1;');
    expect(two).toContain('var COLUMNS = 2;');
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
