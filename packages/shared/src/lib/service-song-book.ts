/**
 * A complete, printable service song book: a landscape service-order cover
 * followed by each scheduled song's portrait chord chart.
 *
 * Like the single-chart template, the result is a self-contained HTML
 * document that goes through the browser's print pipeline. Text therefore
 * stays selectable, and the PDF does not depend on a server-side renderer.
 */

import type { PlanDetail } from '../types/domain.js';
import type { ChartFormatting } from './chart-html.js';
import {
  DEFAULT_CHART_CHORD_COLOR,
  DEFAULT_CHART_FONT,
  DEFAULT_CHART_FONT_SIZE,
  chartFormattingFromRow,
  escapeHtml,
} from './chart-html.js';
import {
  parseChordPro,
  renderChordProChart,
  renderLineAsText,
  type ChordProSection,
} from './chordpro.js';
import { formatDate, formatDuration } from './dates.js';

const SONGS_PER_COVER_PAGE = 7;

export interface ServiceSongBookSong {
  title: string;
  durationSeconds: number;
  description: string | null;
  key: string | null;
  arrangementName: string | null;
  bpm: number | null;
  author: string | null;
  sequence: readonly string[];
  copyright: string | null;
  chordpro: string;
  formatting: ChartFormatting;
  hasChart: boolean;
}

export interface ServiceSongBookDocument {
  title: string;
  dateLabel: string;
  organizationName: string;
  location: string | null;
  songs: readonly ServiceSongBookSong[];
}

export interface ServiceSongBookDocumentInput {
  plan: PlanDetail;
  organizationName: string;
}

/** Resolves the scheduled key and selected arrangement for every song item. */
export const serviceSongBookDocumentFromPlan = ({
  plan,
  organizationName,
}: ServiceSongBookDocumentInput): ServiceSongBookDocument => ({
  title: plan.title,
  dateLabel: formatDate(plan.service_date, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }),
  organizationName,
  location: plan.location,
  songs: plan.items.flatMap((item): ServiceSongBookSong[] => {
    if (item.item_type !== 'song' || !item.song) return [];

    const sourceKey = item.arrangement?.song_key ?? item.song.default_key;
    const scheduledKey = item.key_override ?? sourceKey;
    const source = item.arrangement?.chord_chart ?? '';
    const rendered = source
      ? renderChordProChart(source, {
          sourceKey,
          targetKey: scheduledKey,
          notation: 'chords',
        })
      : null;

    return [
      {
        title: item.title || item.song.title,
        durationSeconds: item.length_seconds,
        description: item.description,
        key: rendered?.key ?? scheduledKey,
        arrangementName: item.arrangement?.name ?? null,
        bpm: item.arrangement?.bpm ?? item.song.default_bpm,
        author: item.song.author,
        sequence: item.arrangement?.sequence ?? [],
        copyright: item.song.copyright,
        chordpro: rendered?.chordpro ?? '',
        formatting: chartFormattingFromRow(item.arrangement ?? {}),
        hasChart: Boolean(source),
      },
    ];
  }),
});

const chunks = <T>(values: readonly T[], size: number): T[][] => {
  if (values.length === 0) return [[]];
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};

const chartTitle = (song: ServiceSongBookSong): string =>
  song.key ? `${song.title} [${song.key}]` : song.title;

const chartByline = (song: ServiceSongBookSong): string | null => {
  const parts: string[] = [];
  if (song.arrangementName) parts.push(`[${song.arrangementName}]`);
  if (song.author) parts.push(parts.length ? `by ${song.author}` : song.author);
  return parts.length ? parts.join(' ') : null;
};

const renderSection = (section: ChordProSection): string => {
  const heading =
    section.label ?? (section.type === 'none' ? null : section.type.replace(/_/g, ' '));
  const lines = section.lines
    .map((line) => {
      const { chordRow, lyricRow } = renderLineAsText(line);
      const chords = chordRow ? `<div class="chords">${escapeHtml(chordRow)}</div>` : '';
      return `<div class="row">${chords}<div class="lyrics">${escapeHtml(lyricRow) || '&nbsp;'}</div></div>`;
    })
    .join('\n        ');

  return `<section class="chart-section">
        ${heading ? `<h2 class="section-label">${escapeHtml(heading)}</h2>\n        ` : ''}${lines}
      </section>`;
};

const coverMetadata = (song: ServiceSongBookSong): string => {
  const values: string[] = [];
  if (song.arrangementName) values.push(song.arrangementName);
  if (song.bpm !== null) values.push(`${song.bpm}bpm`);
  return values.join(' at ');
};

const renderCoverRow = (song: ServiceSongBookSong): string => {
  const metadata = coverMetadata(song);
  const sequence = song.sequence.filter(Boolean).join(', ');
  return `<li class="cover-row">
        <span class="cover-duration">${escapeHtml(formatDuration(song.durationSeconds))}</span>
        <div class="cover-song">
          <div class="cover-song-heading"><span>${escapeHtml(song.title)}</span>${song.key ? `<span class="key-badge">${escapeHtml(song.key)}</span>` : ''}</div>
          ${metadata ? `<div class="cover-meta">${escapeHtml(metadata)}</div>` : ''}
          ${sequence ? `<div class="cover-sequence">${escapeHtml(sequence)}</div>` : ''}
          ${song.description ? `<div class="cover-description">${escapeHtml(song.description)}</div>` : ''}
        </div>
      </li>`;
};

const renderCoverPage = (
  doc: ServiceSongBookDocument,
  songs: readonly ServiceSongBookSong[],
  pageIndex: number,
): string => {
  const details = [doc.organizationName, doc.location].filter(Boolean).join(' | ');
  const rows = songs.length
    ? `<ol class="cover-order">${songs.map(renderCoverRow).join('\n')}</ol>`
    : '<div class="cover-empty">No songs in this service.</div>';

  return `<article class="cover-page">
      <header class="cover-header">
        <h1>${escapeHtml(doc.title)}${pageIndex > 0 ? ' - Song order continued' : ''}</h1>
        <h2>${escapeHtml(doc.dateLabel)}</h2>
        <p>${escapeHtml(details)}</p>
      </header>
      ${rows}
    </article>`;
};

const renderChartSource = (song: ServiceSongBookSong): string => {
  const parsed = parseChordPro(song.chordpro);
  const heading = chartTitle(song);
  const credit = chartByline(song);
  const sequence = song.sequence.filter(Boolean).join(', ');
  const body = song.hasChart && parsed.sections.length > 0
    ? parsed.sections.map(renderSection).join('\n      ')
    : '<section class="chart-empty"><p>No chord chart has been added for this song.</p></section>';
  const font = song.formatting.fontFamily || DEFAULT_CHART_FONT;
  const fontSize = song.formatting.fontSize ?? DEFAULT_CHART_FONT_SIZE;
  const chordColor = song.formatting.chordColor || DEFAULT_CHART_CHORD_COLOR;

  return `<div class="chart-source" data-columns="${song.formatting.columns}" data-font="${escapeHtml(font)}" data-font-size="${fontSize}" data-chord-color="${escapeHtml(chordColor)}">
      <template class="chart-cont-header"><header class="chart-header chart-header-cont"><h2 class="chart-title-cont">${escapeHtml(heading)}</h2></header></template>
      <template class="chart-page-footer"><footer class="page-footer"><span class="page-copyright">${song.copyright ? escapeHtml(song.copyright) : ''}</span><span class="page-number"></span></footer></template>
      <header class="chart-header">
        <h1 class="chart-title">${escapeHtml(heading)}</h1>
        ${credit ? `<p class="chart-byline">${escapeHtml(credit)}</p>` : ''}
        ${sequence ? `<p class="chart-sequence">${escapeHtml(sequence)}</p>` : ''}
      </header>
      ${body}
    </div>`;
};

const styles = (): string => `
    @page { margin: 0; }
    @page cover { size: 11in 8.5in; }
    @page chart { size: 8.5in 11in; }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: #525252;
      color: #111111;
    }

    body {
      font-family: Arial, Helvetica, sans-serif;
      display: flex;
      justify-content: center;
      padding: 16px;
    }

    .book-stage { flex: none; }
    .book-pages {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      width: max-content;
      transform: scale(var(--preview-scale, 1));
      transform-origin: top left;
    }

    .cover-page,
    .chart-page {
      position: relative;
      flex: none;
      overflow: hidden;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    }

    .cover-page {
      page: cover;
      width: 11in;
      height: 8.5in;
      padding: 0.45in;
      break-after: page;
      page-break-after: always;
    }

    .cover-header h1 {
      margin: 0;
      font-size: 26pt;
      font-weight: 500;
      line-height: 1.12;
      letter-spacing: 0.01em;
    }

    .cover-header h2 {
      margin: 0.04in 0 0;
      font-size: 17pt;
      font-weight: 700;
      line-height: 1.15;
    }

    .cover-header p {
      margin: 0.03in 0 0;
      font-size: 10.5pt;
      line-height: 1.25;
    }

    .cover-order {
      margin: 0.34in 0 0;
      padding: 0;
      list-style: none;
      border: 1px solid #d9d9d9;
      background: #fafafa;
    }

    .cover-row {
      min-height: 0.67in;
      display: grid;
      grid-template-columns: 0.78in 1fr;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .cover-row + .cover-row { border-top: 1px solid #dedede; }

    .cover-duration {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.12in 0.08in;
      border-right: 1px solid #dedede;
      color: #30343b;
      font-size: 10.5pt;
      font-variant-numeric: tabular-nums;
    }

    .cover-song { padding: 0.11in 0.12in 0.1in; min-width: 0; }

    .cover-song-heading {
      display: flex;
      align-items: center;
      gap: 0.07in;
      font-size: 11.5pt;
      font-weight: 700;
      line-height: 1.2;
    }

    .key-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 0.27in;
      height: 0.27in;
      padding: 0 0.06in;
      border: 1px solid #c7c7c7;
      border-radius: 0.04in;
      background: #eeeeee;
      font-size: 10.5pt;
      line-height: 1;
    }

    .cover-meta,
    .cover-sequence,
    .cover-description {
      margin-top: 0.035in;
      color: #30343b;
      line-height: 1.2;
    }

    .cover-meta { font-size: 10.5pt; }
    .cover-sequence, .cover-description { font-size: 9.5pt; }

    .cover-empty {
      margin-top: 0.34in;
      padding: 0.35in;
      border: 1px solid #d9d9d9;
      background: #fafafa;
      color: #666666;
      font-size: 11pt;
      text-align: center;
    }

    .chart-page {
      page: chart;
      width: 8.5in;
      height: 11in;
      padding: 0.5in;
      display: flex;
      flex-direction: column;
      font-family: var(--chart-font);
      font-size: var(--chart-font-size);
      line-height: 1.35;
      break-after: page;
      page-break-after: always;
    }

    .chart-page:last-child { break-after: auto; page-break-after: auto; }

    header.chart-header {
      flex: none;
      margin-bottom: 0.22in;
      padding: 0.28in 0.3in;
      background: #e5e5e5;
    }

    header.chart-header-cont { padding: 0.12in 0.3in; }

    h1.chart-title {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      font-size: var(--chart-title-size);
      font-weight: 700;
      line-height: 1.15;
    }

    h2.chart-title-cont {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      font-size: var(--chart-cont-title-size);
      font-weight: 700;
      line-height: 1.2;
    }

    p.chart-byline,
    p.chart-sequence {
      margin: 0.08in 0 0;
      font-family: Arial, Helvetica, sans-serif;
      font-weight: 700;
    }

    p.chart-byline { font-size: var(--chart-byline-size); }
    p.chart-sequence { font-size: var(--chart-sequence-size); }

    .chart-body {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      align-items: stretch;
      gap: 0.35in;
    }

    .chart-column { flex: 1 1 0; min-width: 0; }
    .chart-section { margin-bottom: 0.14in; }

    .section-label {
      margin: 0 0 0.04in;
      font-family: Arial, Helvetica, sans-serif;
      font-size: var(--chart-section-size);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .chords, .lyrics {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }

    .chords { color: var(--chart-chord-color); font-weight: 700; }

    .chart-empty {
      display: grid;
      min-height: 2in;
      place-items: center;
      color: #666666;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11pt;
    }

    footer.page-footer {
      flex: none;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.2in;
      padding-top: 0.1in;
      color: #525252;
      font-family: Arial, Helvetica, sans-serif;
      font-size: var(--chart-footer-size);
    }

    .page-copyright { min-width: 0; }
    .page-number { flex: none; }

    @media print {
      html, body { background: #ffffff; }
      body { display: block; padding: 0; }
      .book-stage { width: auto !important; height: auto !important; }
      .book-pages { display: block; gap: 0; transform: none; }
      .cover-page, .chart-page { box-shadow: none; }
    }
  `;

const paginationScript = (): string => `
(function () {
  var stage = document.querySelector('.book-stage');
  var pages = document.getElementById('book-pages');
  var sources = [].slice.call(document.querySelectorAll('.chart-source'));
  if (!stage || !pages) return;

  var pageNumber = pages.querySelectorAll('.cover-page').length;

  function paginate(source) {
    var columns = Number(source.getAttribute('data-columns')) || 1;
    var fontSize = Number(source.getAttribute('data-font-size')) || ${DEFAULT_CHART_FONT_SIZE};
    var firstHeader = source.querySelector('header.chart-header');
    var contTemplate = source.querySelector('template.chart-cont-header');
    var footerTemplate = source.querySelector('template.chart-page-footer');
    if (!firstHeader || !footerTemplate) return;

    var blocks = [].slice.call(source.children).filter(function (child) {
      return child !== firstHeader && child.tagName !== 'TEMPLATE';
    });
    source.parentNode.removeChild(source);

    var pagesForSong = 0;
    var columnsOnPage = [];
    var columnIndex = 0;
    var limit = 0;

    function addPage() {
      pagesForSong += 1;
      pageNumber += 1;
      var page = document.createElement('article');
      page.className = 'chart-page';
      page.style.setProperty('--chart-font', source.getAttribute('data-font') || ${JSON.stringify(DEFAULT_CHART_FONT)});
      page.style.setProperty('--chart-font-size', fontSize + 'pt');
      page.style.setProperty('--chart-chord-color', source.getAttribute('data-chord-color') || '${DEFAULT_CHART_CHORD_COLOR}');
      page.style.setProperty('--chart-title-size', Math.round(fontSize * 2) + 'pt');
      page.style.setProperty('--chart-cont-title-size', Math.round(fontSize * 1.1) + 'pt');
      page.style.setProperty('--chart-byline-size', Math.round(fontSize * 0.95) + 'pt');
      page.style.setProperty('--chart-sequence-size', Math.round(fontSize * 1.35) + 'pt');
      page.style.setProperty('--chart-section-size', Math.round(fontSize * 0.85) + 'pt');
      page.style.setProperty('--chart-footer-size', Math.round(fontSize * 0.72) + 'pt');

      var header = pagesForSong === 1
        ? firstHeader
        : (contTemplate ? contTemplate.content.firstElementChild.cloneNode(true) : null);
      if (header) page.appendChild(header);

      var body = document.createElement('div');
      body.className = 'chart-body';
      for (var i = 0; i < columns; i += 1) {
        var column = document.createElement('div');
        column.className = 'chart-column';
        body.appendChild(column);
      }
      page.appendChild(body);

      var footer = footerTemplate.content.firstElementChild.cloneNode(true);
      var number = footer.querySelector('.page-number');
      if (number) number.textContent = String(pageNumber);
      page.appendChild(footer);

      pages.appendChild(page);
      columnsOnPage = [].slice.call(body.querySelectorAll('.chart-column'));
      columnIndex = 0;
      limit = body.clientHeight;
    }

    function advance() {
      if (columnIndex + 1 < columnsOnPage.length) columnIndex += 1;
      else addPage();
    }

    function overflows(column) {
      return column.scrollHeight > limit;
    }

    function splitSection(section) {
      var parts = [].slice.call(section.childNodes);
      var shell = section.cloneNode(false);
      columnsOnPage[columnIndex].appendChild(shell);

      for (var i = 0; i < parts.length; i += 1) {
        shell.appendChild(parts[i]);
        if (!overflows(columnsOnPage[columnIndex])) continue;
        shell.removeChild(parts[i]);

        if (!shell.firstChild) {
          shell.appendChild(parts[i]);
          continue;
        }

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
    for (var blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      place(blocks[blockIndex]);
    }
  }

  for (var sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    paginate(sources[sourceIndex]);
  }

  function rescale() {
    var page = pages.firstElementChild;
    if (!page) return;
    var width = page.offsetWidth;
    var height = pages.scrollHeight;
    if (!width) return;
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

/** Renders the cover and all charts as one standalone printable document. */
export const renderServiceSongBookHtml = (doc: ServiceSongBookDocument): string => {
  const coverPages = chunks(doc.songs, SONGS_PER_COVER_PAGE)
    .map((songs, index) => renderCoverPage(doc, songs, index))
    .join('\n');
  const chartSources = doc.songs.map(renderChartSource).join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(doc.title)} - Song Book</title>
    <style>${styles()}</style>
  </head>
  <body>
    <div class="book-stage"><main id="book-pages" class="book-pages">${coverPages}</main></div>
    ${chartSources}
    <script>${paginationScript()}</script>
  </body>
</html>
`;
};
