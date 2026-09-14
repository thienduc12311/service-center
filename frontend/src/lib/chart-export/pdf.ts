/**
 * Writing measured page geometry out as a PDF.
 *
 * Everything is drawn as vector text and filled rectangles — no canvas, no
 * screenshot — so the chart stays sharp at any zoom, the words stay searchable
 * and selectable, and a three-page chart is tens of kilobytes rather than
 * megabytes.
 */

import { jsPDF } from 'jspdf';
import type { UnicodeChartFont } from './fonts';
import type { ChartPdfDocument, ChartPdfFontFamily, ChartPdfText } from './types';

/**
 * How far a run may be stretched or squeezed to match the width the browser
 * gave it, as a fraction of its natural width.
 *
 * The fit exists to absorb the small difference between a screen font and the
 * PDF core font standing in for it. A difference larger than this is not that
 * — it is a measurement that went wrong somewhere — and honest glyph spacing
 * is the better failure.
 */
const MAX_FIT_RATIO = 0.25;

/**
 * The per-glyph adjustment that makes a run come out exactly as wide as the
 * browser drew it.
 *
 * It matters most where it is least visible. In a monospace chart the
 * adjustment works out to the same per-glyph figure for every run in the font,
 * so a chord row and the lyric row under it shift together and every chord
 * stays over the syllable it was typed above — even though the screen face and
 * the PDF face are not the same font.
 */
const fitCharSpace = (doc: jsPDF, run: ChartPdfText): number => {
  const natural = doc.getTextWidth(run.text);
  if (!natural || !run.width || !run.text.length) return 0;

  const difference = run.width - natural;
  if (Math.abs(difference) > natural * MAX_FIT_RATIO) return 0;

  return difference / run.text.length;
};

/**
 * Registers the fallback faces and reports which family each one now answers
 * for. A family with no fallback keeps the built-in font of the same name.
 */
const embedFonts = (
  doc: jsPDF,
  fonts: readonly UnicodeChartFont[],
): Map<ChartPdfFontFamily, string> => {
  const embedded = new Map<ChartPdfFontFamily, string>();

  for (const font of fonts) {
    const file = `${font.name}-${font.bold ? 'bold' : 'normal'}.ttf`;
    doc.addFileToVFS(file, font.data);
    doc.addFont(file, font.name, font.bold ? 'bold' : 'normal');
    embedded.set(font.family, font.name);
  }

  return embedded;
};

/**
 * Renders measured pages into a jsPDF document, ready to be saved or shown.
 *
 * `fonts` are the Unicode faces this chart turned out to need; the usual chart
 * needs none and is written with the fonts every PDF reader already has.
 */
export const writeChartPdf = (
  chart: ChartPdfDocument,
  fonts: readonly UnicodeChartFont[] = [],
): jsPDF => {
  const format = [chart.widthPt, chart.heightPt];
  const doc = new jsPDF({
    unit: 'pt',
    format,
    orientation: 'portrait',
    compress: true,
    // A family is fetched in both weights; only the weights actually drawn
    // need to travel in the file.
    putOnlyUsedFonts: true,
  });
  doc.setDocumentProperties({ title: chart.title });

  const embedded = embedFonts(doc, fonts);

  chart.pages.forEach((page, index) => {
    if (index > 0) doc.addPage(format, 'portrait');

    for (const box of page.boxes) {
      doc.setFillColor(box.color.r, box.color.g, box.color.b);
      doc.rect(box.x, box.y, box.width, box.height, 'F');
    }

    for (const run of page.texts) {
      doc.setFont(embedded.get(run.style.family) ?? run.style.family, run.style.bold ? 'bold' : 'normal');
      doc.setFontSize(run.style.size);
      doc.setTextColor(run.style.color.r, run.style.color.g, run.style.color.b);
      doc.setCharSpace(fitCharSpace(doc, run));
      doc.text(run.text, run.x, run.baseline, { baseline: 'alphabetic' });
    }
  });

  // Left set, the last run's fit would follow the document around.
  doc.setCharSpace(0);
  return doc;
};

/** Characters no filesystem wants in a name, control characters included. */
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]|[\p{Cc}]/gu;
const MAX_FILENAME_LENGTH = 120;

/** Turns a chart's heading into something every filesystem will accept. */
export const chartPdfFilename = (title: string): string => {
  const safe = title
    .replace(UNSAFE_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)
    // A leading dot hides the file; a trailing one confuses Windows.
    .replace(/^\.+|\.+$/g, '')
    .trim();

  return `${safe || 'chord-chart'}.pdf`;
};
