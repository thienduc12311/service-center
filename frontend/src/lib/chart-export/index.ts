/**
 * Getting a rendered chart out of the app: into its own tab, or into a PDF.
 *
 * Both start from the same `ChartDocument` the editor's preview is showing, so
 * what the user reads on screen, opens in a tab and downloads cannot drift
 * apart. The PDF is written directly rather than handed to the browser's print
 * dialog: printing re-lays the document out against the printer's own paper
 * and margins, which is exactly where a chart's columns and page breaks come
 * apart. See `layout.ts` for how the two are kept identical.
 */

import { chartDocumentTitle, renderChartHtml, type ChartDocument } from '@service-center/shared';
import { loadUnicodeChartFonts, unicodeChartFamilies } from './fonts';
import { renderChartPdfDocument } from './layout';

export * from './types';

/**
 * Opens the chart in a new tab as a standalone document.
 *
 * Returns false when the browser blocked the pop-up, so the caller can say so
 * instead of looking like nothing happened.
 */
export const openChartInNewTab = (chart: ChartDocument): boolean => {
  const html = renderChartHtml(chart);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const tab = window.open(url, '_blank', 'noopener');

  if (!tab) {
    URL.revokeObjectURL(url);
    return false;
  }

  // The tab needs the URL only until it has loaded the document from it.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
};

/**
 * Builds the chart's PDF and hands it to the browser as a download.
 *
 * The filename is the chart's own heading — `Nothing Is Impossible [C].pdf` —
 * so a folder of charts reads as a set list rather than a list of `download`s.
 *
 * The PDF writer is imported here rather than at the top of the file so that
 * the library it is built on stays out of the app's bundle until somebody
 * actually asks for a download.
 */
export const exportChartPdf = async (chart: ChartDocument): Promise<void> => {
  const title = chartDocumentTitle(chart);
  const measured = await renderChartPdfDocument(renderChartHtml(chart), title);
  const fonts = await loadUnicodeChartFonts(unicodeChartFamilies(measured));
  const { chartPdfFilename, writeChartPdf } = await import('./pdf');

  writeChartPdf(measured, fonts).save(chartPdfFilename(title));
};
