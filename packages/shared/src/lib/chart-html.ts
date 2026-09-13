/**
 * The printable chord chart template.
 *
 * One function renders the whole document, and everything that shows a chart
 * outside the app's own UI goes through it: the live preview in the editor, the
 * "open in a new tab" view, and the PDF (which is this same HTML sent to the
 * browser's print pipeline). Keeping a single template is what makes the PDF
 * match the preview — there is only ever one layout to get right.
 *
 * The output is a self-contained HTML document: no external stylesheet, no
 * script, nothing that needs the app to be running to render.
 */

import type { ChartColumns } from '../types/database.js';
import { parseChordPro, renderLineAsText, type ChordProSection } from './chordpro.js';

/** Presentation settings for one chart. Null means "use the template default". */
export interface ChartFormatting {
  columns: ChartColumns;
  /** CSS font stack for the chart body. */
  fontFamily: string | null;
  /** Body font size in points. */
  fontSize: number | null;
  /** Hex colour the chords are printed in, e.g. `#1d4ed8`. */
  chordColor: string | null;
}

export const DEFAULT_CHART_FONT = "'Courier New', Courier, monospace";
export const DEFAULT_CHART_FONT_SIZE = 12;
export const DEFAULT_CHART_CHORD_COLOR = '#000000';

export const DEFAULT_CHART_FORMATTING: ChartFormatting = {
  columns: 1,
  fontFamily: null,
  fontSize: null,
  chordColor: null,
};

/** Everything the template prints, already resolved into display values. */
export interface ChartDocument {
  title: string;
  /** The key the chart is written in; shown in the heading as `[C]`. */
  key: string | null;
  /** Shown in the byline as `[Default Arrangement]`. */
  arrangementName: string | null;
  author: string | null;
  /** Section order, printed under the byline. */
  sequence: readonly string[];
  copyright: string | null;
  /** The chart itself, in ChordPro. */
  chordpro: string;
  formatting: ChartFormatting;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

/** `Nothing Is Impossible [C]` — the heading, and the PDF's default filename. */
export const chartDocumentTitle = ({ title, key }: Pick<ChartDocument, 'title' | 'key'>): string =>
  key ? `${title} [${key}]` : title;

/** `[Default Arrangement] by Jonathan Hunt`, with either half optional. */
const byline = ({ arrangementName, author }: ChartDocument): string | null => {
  const parts: string[] = [];
  if (arrangementName) parts.push(`[${arrangementName}]`);
  if (author) parts.push(parts.length ? `by ${author}` : author);
  return parts.length ? parts.join(' ') : null;
};

/**
 * A section becomes a heading plus its lines, each line as a chord row above a
 * lyric row. Column alignment is the whole point of a chart, so both rows are
 * `white-space: pre` in the same monospace font.
 */
const renderSection = (section: ChordProSection): string => {
  const heading =
    section.label ?? (section.type === 'none' ? null : section.type.replace(/_/g, ' '));

  const lines = section.lines
    .map((line) => {
      const { chordRow, lyricRow } = renderLineAsText(line);
      const chords = chordRow ? `<div class="chords">${escapeHtml(chordRow)}</div>` : '';
      // A blank lyric row still occupies a line: it is the gap the writer typed.
      return `${chords}<div class="lyrics">${escapeHtml(lyricRow) || '&nbsp;'}</div>`;
    })
    .join('\n        ');

  return `<section class="chart-section">
        ${heading ? `<h2 class="section-label">${escapeHtml(heading)}</h2>\n        ` : ''}${lines}
      </section>`;
};

const styles = (formatting: ChartFormatting): string => {
  const font = formatting.fontFamily || DEFAULT_CHART_FONT;
  const size = formatting.fontSize ?? DEFAULT_CHART_FONT_SIZE;
  const chordColor = formatting.chordColor || DEFAULT_CHART_CHORD_COLOR;

  return `
    @page { size: letter portrait; margin: 0.5in; }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #000000;
    }

    body {
      font-family: ${font};
      font-size: ${size}pt;
      line-height: 1.35;
      padding: 0.5in;
    }

    header.chart-header {
      background: #e5e5e5;
      padding: 0.28in 0.3in;
      margin-bottom: 0.22in;
    }

    h1.chart-title {
      font-family: Arial, Helvetica, sans-serif;
      font-size: ${Math.round(size * 2)}pt;
      font-weight: 700;
      margin: 0;
      line-height: 1.15;
    }

    p.chart-byline,
    p.chart-sequence {
      font-family: Arial, Helvetica, sans-serif;
      font-weight: 700;
      margin: 0.08in 0 0;
    }

    p.chart-byline { font-size: ${Math.round(size * 0.95)}pt; }
    p.chart-sequence { font-size: ${Math.round(size * 1.35)}pt; }

    main.chart-body {
      column-count: ${formatting.columns};
      column-gap: 0.4in;
      /* A rule between the columns is what keeps a two-column chart readable. */
      column-rule: ${formatting.columns > 1 ? '1px solid #d4d4d4' : 'none'};
    }

    .chart-section {
      /* Never split a section across a column or a page if it fits whole. */
      break-inside: avoid;
      page-break-inside: avoid;
      margin-bottom: 0.14in;
    }

    .section-label {
      font-family: Arial, Helvetica, sans-serif;
      font-size: ${Math.round(size * 0.85)}pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 0 0 0.04in;
    }

    .chords, .lyrics {
      white-space: pre;
      margin: 0;
    }

    .chords {
      font-weight: 700;
      color: ${chordColor};
    }

    footer.chart-footer {
      margin-top: 0.3in;
      padding-top: 0.1in;
      border-top: 1px solid #e5e5e5;
      font-family: Arial, Helvetica, sans-serif;
      font-size: ${Math.round(size * 0.72)}pt;
      text-align: center;
      color: #525252;
    }

    @media print {
      body { padding: 0; }
      /* The browser's own print dialog adds the page numbers. */
      footer.chart-footer { border-top: none; }
    }
  `;
};

/**
 * Renders one chart as a complete, standalone HTML document.
 *
 * The `<title>` doubles as the filename the browser suggests when the document
 * is printed to PDF, so it carries the same `Title [Key]` the heading shows.
 */
export const renderChartHtml = (doc: ChartDocument): string => {
  const song = parseChordPro(doc.chordpro);
  const heading = chartDocumentTitle(doc);
  const credit = byline(doc);
  const sequence = doc.sequence.filter(Boolean).join(', ');

  const body =
    song.sections.length > 0
      ? song.sections.map(renderSection).join('\n      ')
      : '<p class="lyrics">&nbsp;</p>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(heading)}</title>
    <style>${styles(doc.formatting)}</style>
  </head>
  <body>
    <header class="chart-header">
      <h1 class="chart-title">${escapeHtml(heading)}</h1>
      ${credit ? `<p class="chart-byline">${escapeHtml(credit)}</p>` : ''}
      ${sequence ? `<p class="chart-sequence">${escapeHtml(sequence)}</p>` : ''}
    </header>

    <main class="chart-body">
      ${body}
    </main>
    ${doc.copyright ? `\n    <footer class="chart-footer">${escapeHtml(doc.copyright)}</footer>` : ''}
  </body>
</html>
`;
};

/**
 * Maps the formatting columns of an `arrangements` row onto the template's
 * settings, so the persistence shape stops at this boundary and the renderer
 * only ever sees domain values.
 */
export const chartFormattingFromRow = (row: {
  chart_columns?: ChartColumns | null;
  chart_font?: string | null;
  chart_font_size?: number | null;
  chart_chord_color?: string | null;
}): ChartFormatting => ({
  columns: row.chart_columns ?? DEFAULT_CHART_FORMATTING.columns,
  fontFamily: row.chart_font ?? null,
  fontSize: row.chart_font_size ?? null,
  chordColor: row.chart_chord_color ?? null,
});
