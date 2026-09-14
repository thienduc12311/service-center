/**
 * The printable chord chart template.
 *
 * One function renders the whole document, and everything that shows a chart
 * outside the app's own UI goes through it: the live preview in the editor, the
 * "open in a new tab" view, and the PDF (which the client writes by measuring
 * this same HTML — see `chart-export/layout.ts`). Keeping a single template is
 * what makes the PDF match the preview — there is only ever one layout to get
 * right.
 *
 * The document lays itself out as a stack of real, fixed-size paper pages and
 * flows the chart across them, so the preview shows the same page breaks,
 * columns and continuation headers the PDF will have. On screen the stack is
 * scaled down with a transform, which is a purely visual scale: nothing
 * reflows, so a page that is full in the preview is full in print too.
 *
 * The output is self-contained: no external stylesheet, no font to fetch and
 * nothing that needs the app to be running. It does carry one inline script,
 * which is what does the pagination; without it the chart still renders, just
 * as a single unbroken column.
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

/**
 * The paper every chart is laid out on, in inches. US Letter — the same size
 * the `@page` rule asks the printer for, so the preview and the PDF agree.
 *
 * Inches rather than the 612x792 pt the PDF itself uses: CSS `in` is exact in
 * both media, whereas 612 CSS px would come out as 6.375in on paper.
 */
export const CHART_PAGE = {
  widthIn: 8.5,
  heightIn: 11,
  marginIn: 0.5,
  columnGapIn: 0.35,
} as const;

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

/** One line of a chart: chords on top, the words they sit over underneath. */
export interface ChartLineRows {
  chordRow: string;
  lyricRow: string;
}

/**
 * The width of one character, as a fraction of the font size.
 *
 * The two monospace options advance by 0.6em (Courier New by a whisker more),
 * and the proportional ones average well under it, so this over-estimates on
 * purpose: a line breaks a shade early rather than a shade late, and the
 * stylesheet never has to wrap one itself.
 */
const CHARACTER_ADVANCE_RATIO = 0.61;

/** Below this a "column" is too narrow to lay a chart out in at all. */
const MIN_COLUMN_CHARACTERS = 8;

/**
 * How many characters of the chart's font fit across one of its columns.
 *
 * This is what the chart is wrapped to. Measuring it from the page rather than
 * leaving it to CSS is the whole point: see `wrapChartLine`.
 */
export const chartColumnCharacters = (formatting: ChartFormatting): number => {
  const size = formatting.fontSize ?? DEFAULT_CHART_FONT_SIZE;
  const { widthIn, marginIn, columnGapIn } = CHART_PAGE;
  const { columns } = formatting;

  const contentIn = widthIn - marginIn * 2 - columnGapIn * (columns - 1);
  const columnPt = (contentIn / columns) * 72;

  return Math.max(
    MIN_COLUMN_CHARACTERS,
    Math.floor(columnPt / (size * CHARACTER_ADVANCE_RATIO)),
  );
};

const leadingSpaces = (row: string): number => row.length - row.trimStart().length;

/** True when breaking here would cut a chord name in half. */
const splitsAChord = (chordRow: string, at: number): boolean =>
  at < chordRow.length && chordRow[at - 1] !== ' ' && chordRow[at] !== ' ';

/** True when the words allow a break here — that is, one of them ends here. */
const endsAWord = (lyricRow: string, at: number): boolean =>
  at >= lyricRow.length || lyricRow[at - 1] === ' ' || lyricRow[at] === ' ';

/** The last column at or before the limit that both rows can be cut at. */
const breakColumn = (line: ChartLineRows, limit: number): number => {
  const longest = Math.max(line.chordRow.length, line.lyricRow.length);

  for (let at = Math.min(limit, longest); at > 0; at -= 1) {
    if (!splitsAChord(line.chordRow, at) && endsAWord(line.lyricRow, at)) return at;
  }

  // One word wider than the whole column. Cutting it is the lesser evil.
  return limit;
};

/**
 * Breaks a line too wide for its column into as many lines as it needs.
 *
 * The chord row and the lyric row are two separate boxes on the page, and left
 * to itself CSS wraps each of them where *it* happens to run out of room. The
 * two break in different places, the chords slide out from over their
 * syllables, and a chord that sits past the end of the words drops onto a line
 * of its own. So the break is made here instead, at one column through both
 * rows at once, which is the only way the chords can stay put.
 *
 * The column chosen ends a word and never lands inside a chord name, and each
 * continuation gives up the indentation it inherited from the middle of the
 * line it was cut out of.
 */
export const wrapChartLine = (line: ChartLineRows, maxCharacters: number): ChartLineRows[] => {
  const wrapped: ChartLineRows[] = [];
  let { chordRow, lyricRow } = line;

  const overflows = (): boolean =>
    Math.max(chordRow.trimEnd().length, lyricRow.trimEnd().length) > maxCharacters;

  while (overflows()) {
    const at = breakColumn({ chordRow, lyricRow }, maxCharacters);
    wrapped.push({ chordRow: chordRow.slice(0, at).trimEnd(), lyricRow: lyricRow.slice(0, at).trimEnd() });

    chordRow = chordRow.slice(at);
    lyricRow = lyricRow.slice(at);

    // Shared indentation only: a chord standing over a word that has moved to
    // the front of the line has to move with it, and no further.
    const indents = [chordRow, lyricRow].filter((row) => row.trim()).map(leadingSpaces);
    const indent = indents.length ? Math.min(...indents) : 0;
    chordRow = chordRow.slice(indent);
    lyricRow = lyricRow.slice(indent);
  }

  wrapped.push({ chordRow: chordRow.trimEnd(), lyricRow: lyricRow.trimEnd() });
  return wrapped;
};

/**
 * A section becomes a heading plus its lines, each line a chord row above a
 * lyric row. Column alignment is the whole point of a chart, so both rows are
 * the same monospace font and preserve their spacing.
 *
 * The two rows of a line are wrapped together so that pagination can move a
 * line to the next column without ever stranding chords away from their words.
 */
const renderSection = (section: ChordProSection, maxCharacters: number): string => {
  const heading =
    section.label ?? (section.type === 'none' ? null : section.type.replace(/_/g, ' '));

  const lines = section.lines
    .flatMap((line) => wrapChartLine(renderLineAsText(line), maxCharacters))
    .map(({ chordRow, lyricRow }) => {
      const chords = chordRow ? `<div class="chords">${escapeHtml(chordRow)}</div>` : '';
      // A blank lyric row still occupies a line: it is the gap the writer typed.
      return `<div class="row">${chords}<div class="lyrics">${escapeHtml(lyricRow) || '&nbsp;'}</div></div>`;
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
  const { widthIn, heightIn, marginIn, columnGapIn } = CHART_PAGE;

  return `
    /* Margin lives on the page element so one box describes the paper in both
       media; the sheet the printer produces is the element, edge to edge. */
    @page { size: ${widthIn}in ${heightIn}in; margin: 0; }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: #525252;
      color: #000000;
    }

    body {
      font-family: ${font};
      font-size: ${size}pt;
      line-height: 1.35;
      display: flex;
      justify-content: center;
      padding: 16px;
    }

    /* Holds the space the scaled-down stack actually occupies, so the page
       scrolls by the size it looks, not the size it is laid out at. */
    .chart-stage { flex: none; }

    .chart-pages {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      /* Keep the stack at its true paper width: the stage around it is sized
         to the scaled-down result, and a block child would shrink to match. */
      width: max-content;
      transform: scale(var(--preview-scale, 1));
      transform-origin: top left;
    }

    .page {
      position: relative;
      width: ${widthIn}in;
      height: ${heightIn}in;
      flex: none;
      padding: ${marginIn}in;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
      display: flex;
      flex-direction: column;
      /* The last line of defence: nothing leaves the paper. */
      overflow: hidden;
    }

    header.chart-header {
      flex: none;
      background: #e5e5e5;
      padding: 0.28in 0.3in;
      margin-bottom: 0.22in;
    }

    /* Continuation pages get a slim band with just the song, so it is obvious
       the page belongs to the chart that started earlier. */
    header.chart-header-cont { padding: 0.12in 0.3in; }

    h1.chart-title {
      font-family: Arial, Helvetica, sans-serif;
      font-size: ${Math.round(size * 2)}pt;
      font-weight: 700;
      margin: 0;
      line-height: 1.15;
    }

    h2.chart-title-cont {
      font-family: Arial, Helvetica, sans-serif;
      font-size: ${Math.round(size * 1.1)}pt;
      font-weight: 700;
      margin: 0;
      line-height: 1.2;
    }

    p.chart-byline,
    p.chart-sequence {
      font-family: Arial, Helvetica, sans-serif;
      font-weight: 700;
      margin: 0.08in 0 0;
    }

    p.chart-byline { font-size: ${Math.round(size * 0.95)}pt; }
    p.chart-sequence { font-size: ${Math.round(size * 1.35)}pt; }

    /* Columns are flex tracks, not CSS columns: pagination fills them itself,
       and the space between them is the gap alone — no rule. */
    .chart-body {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      gap: ${columnGapIn}in;
      align-items: stretch;
    }

    .chart-column {
      flex: 1 1 0;
      min-width: 0;
    }

    .chart-section { margin-bottom: 0.14in; }

    .section-label {
      font-family: Arial, Helvetica, sans-serif;
      font-size: ${Math.round(size * 0.85)}pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 0 0 0.04in;
    }

    /* Preserved whitespace keeps a chart aligned, but a line wider than its
       column still wraps rather than running off the page. */
    .chords, .lyrics {
      white-space: pre-wrap;
      overflow-wrap: break-word;
      margin: 0;
    }

    .chords {
      font-weight: 700;
      color: ${chordColor};
    }

    footer.page-footer {
      flex: none;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.2in;
      padding-top: 0.1in;
      font-family: Arial, Helvetica, sans-serif;
      font-size: ${Math.round(size * 0.72)}pt;
      color: #525252;
    }

    .page-copyright { min-width: 0; }
    .page-number { flex: none; }

    @media print {
      html, body { background: #ffffff; }
      body { display: block; padding: 0; }
      .chart-stage { width: auto !important; height: auto !important; }
      .chart-pages { transform: none; gap: 0; display: block; }
      .page { box-shadow: none; break-after: page; page-break-after: always; }
      .page:last-child { break-after: auto; page-break-after: auto; }
    }
  `;
};

/**
 * Flows the chart across pages, in the document itself.
 *
 * It measures rather than estimates: a block is appended to the column it is
 * destined for and kept only if the column still fits the page. That is what
 * lets the preview and the PDF break in the same places — both are this same
 * DOM, laid out at the same size.
 */
const paginationScript = (columns: number): string => `
(function () {
  var stage = document.querySelector('.chart-stage');
  var pages = document.getElementById('chart-pages');
  var source = document.getElementById('chart-source');
  var contTemplate = document.getElementById('chart-cont-header');
  var footerTemplate = document.getElementById('chart-page-footer');
  if (!stage || !pages || !source || !footerTemplate) return;

  var COLUMNS = ${columns};

  var firstHeader = source.querySelector('header.chart-header');
  var blocks = [];
  var child = source.firstElementChild;
  while (child) {
    if (child !== firstHeader) blocks.push(child);
    child = child.nextElementSibling;
  }
  source.parentNode.removeChild(source);

  var pageCount = 0;
  var columnsOnPage = [];
  var columnIndex = 0;
  var limit = 0;

  function addPage() {
    pageCount += 1;
    var page = document.createElement('article');
    page.className = 'page';

    var header = pageCount === 1
      ? firstHeader
      : (contTemplate ? contTemplate.content.firstElementChild.cloneNode(true) : null);
    if (header) page.appendChild(header);

    var body = document.createElement('div');
    body.className = 'chart-body';
    for (var i = 0; i < COLUMNS; i += 1) {
      var column = document.createElement('div');
      column.className = 'chart-column';
      body.appendChild(column);
    }
    page.appendChild(body);

    var footer = footerTemplate.content.firstElementChild.cloneNode(true);
    var number = footer.querySelector('.page-number');
    if (number) number.textContent = String(pageCount);
    page.appendChild(footer);

    pages.appendChild(page);
    columnsOnPage = [].slice.call(body.querySelectorAll('.chart-column'));
    columnIndex = 0;
    limit = body.clientHeight;
  }

  /** Moves on to the next column, starting a new page after the last one. */
  function advance() {
    if (columnIndex + 1 < columnsOnPage.length) columnIndex += 1;
    else addPage();
  }

  function overflows(column) {
    return column.scrollHeight > limit;
  }

  /**
   * Spreads one section that is taller than a column across as many as it
   * needs, breaking between lines and never between a label and its first line.
   */
  function splitSection(section) {
    var parts = [].slice.call(section.childNodes);
    var shell = section.cloneNode(false);
    columnsOnPage[columnIndex].appendChild(shell);

    for (var i = 0; i < parts.length; i += 1) {
      shell.appendChild(parts[i]);
      if (!overflows(columnsOnPage[columnIndex])) continue;

      shell.removeChild(parts[i]);

      // A single line taller than a whole column: keep it rather than spin.
      if (!shell.firstChild) {
        shell.appendChild(parts[i]);
        continue;
      }

      // Do not leave a section label stranded at the foot of a column.
      var orphan = null;
      if (shell.childNodes.length === 1 && shell.firstChild.nodeName === 'H2') {
        orphan = shell.firstChild;
        shell.parentNode.removeChild(shell);
      }

      advance();
      shell = section.cloneNode(false);
      columnsOnPage[columnIndex].appendChild(shell);
      if (orphan) shell.appendChild(orphan);
      shell.appendChild(parts[i]);
    }
  }

  function place(block) {
    for (;;) {
      var column = columnsOnPage[columnIndex];
      column.appendChild(block);
      if (!overflows(column)) return;

      column.removeChild(block);
      if (!column.firstChild) {
        splitSection(block);
        return;
      }
      advance();
    }
  }

  addPage();
  for (var b = 0; b < blocks.length; b += 1) place(blocks[b]);

  /**
   * Scales the stack to the width available. A transform, so the layout above
   * is untouched and the preview stays an honest picture of the paper.
   */
  function rescale() {
    var page = pages.firstElementChild;
    if (!page) return;
    var width = page.offsetWidth;
    var height = pages.scrollHeight;
    if (!width) return;

    // No room measured yet: the frame has not been laid out (the off-screen
    // print frame is 0x0, for one). Leave the scale alone rather than compute
    // a negative one, which would draw the preview mirrored.
    var room = document.documentElement.clientWidth - 32;
    if (room <= 0) return;
    var factor = Math.min(1, room / width);

    document.documentElement.style.setProperty('--preview-scale', String(factor));
    stage.style.width = width * factor + 'px';
    stage.style.height = height * factor + 'px';
  }

  rescale();
  window.addEventListener('resize', rescale);
})();
`;

/**
 * Renders one chart as a complete, standalone HTML document.
 *
 * The `<title>` carries the same `Title [Key]` the heading shows: it names the
 * tab the chart is opened in, and the file it is exported as.
 */
export const renderChartHtml = (doc: ChartDocument): string => {
  const song = parseChordPro(doc.chordpro);
  const heading = chartDocumentTitle(doc);
  const credit = byline(doc);
  const sequence = doc.sequence.filter(Boolean).join(', ');

  const maxCharacters = chartColumnCharacters(doc.formatting);
  const body =
    song.sections.length > 0
      ? song.sections.map((section) => renderSection(section, maxCharacters)).join('\n      ')
      : '<section class="chart-section"><div class="row"><div class="lyrics">&nbsp;</div></div></section>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(heading)}</title>
    <style>${styles(doc.formatting)}</style>
  </head>
  <body data-columns="${doc.formatting.columns}">
    <div class="chart-stage"><div id="chart-pages" class="chart-pages"></div></div>

    <template id="chart-cont-header"><header class="chart-header chart-header-cont"><h2 class="chart-title-cont">${escapeHtml(heading)}</h2></header></template>
    <template id="chart-page-footer"><footer class="page-footer"><span class="page-copyright">${doc.copyright ? escapeHtml(doc.copyright) : ''}</span><span class="page-number"></span></footer></template>

    <div id="chart-source">
      <header class="chart-header">
        <h1 class="chart-title">${escapeHtml(heading)}</h1>
        ${credit ? `<p class="chart-byline">${escapeHtml(credit)}</p>` : ''}
        ${sequence ? `<p class="chart-sequence">${escapeHtml(sequence)}</p>` : ''}
      </header>
      ${body}
    </div>

    <script>${paginationScript(doc.formatting.columns)}</script>
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
