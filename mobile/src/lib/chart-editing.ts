import {
  CHART_PAGE,
  chartDocumentTitle,
  chartPdfFilename,
  renderChartHtml,
  toChartArrangementInput,
  updateArrangementSchema,
  type ChartDocument,
  type ChartEditorFormValues,
  type UpdateArrangementInput,
} from '@service-center/shared';

/**
 * MOB-029: the app's Lyrics & Chords editor and chart PDF on the website's
 * contracts. The form, save body, document and filename are the shared
 * `chart-editor` rules; this module only adds what is native: the app saves
 * the arrangement alone (the song's title is edited in Song information, one
 * revisioned write per record), and the PDF is written by the OS web view from
 * the very same `renderChartHtml` document the website prints.
 */

/** Points per inch: the PDF's own unit. */
const PT_PER_IN = 72;

/** US Letter in points, from the template's own paper, so the web view lays out the same page. */
export const CHART_PDF_PAGE = {
  width: CHART_PAGE.widthIn * PT_PER_IN,
  height: CHART_PAGE.heightIn * PT_PER_IN,
} as const;

/** What the OS print renderer is handed: the shared document, edge to edge (the template sets its own margins). */
export interface ChartPdfPrintOptions {
  html: string;
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
}

export const chartPdfPrintOptions = (doc: ChartDocument): ChartPdfPrintOptions => ({
  html: renderChartHtml(doc),
  width: CHART_PDF_PAGE.width,
  height: CHART_PDF_PAGE.height,
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
});

/** `Amazing Grace [D].pdf` — the website's name for the same chart. */
export const chartPdfName = (doc: ChartDocument): string => chartPdfFilename(chartDocumentTitle(doc));

/**
 * The one request a native chart save sends: the arrangement's name, key,
 * sequence, chart and layout, checked against the revision the editor opened.
 * Throws (Zod) when the server would refuse it, so nothing invalid is sent.
 */
export const chartArrangementSaveBody = (
  values: ChartEditorFormValues,
  baseRevision: number,
  defaultName: string,
): UpdateArrangementInput => updateArrangementSchema.parse(toChartArrangementInput(values, defaultName, baseRevision));

/** Comma- or newline-separated sections, as the arrangement editor accepts them. */
export const parseChartSequence = (text: string): string[] =>
  text
    .split(/[,\n]/)
    .map((section) => section.trim())
    .filter(Boolean);

export const formatChartSequence = (sequence: readonly string[]): string => sequence.join(', ');

/** Where a PDF action stands, so the button never claims more than happened. */
export type ChartPdfState =
  | { status: 'idle' }
  | { status: 'preparing'; action: ChartPdfAction }
  /** The share sheet closed. iOS/Android report no choice, so "shared" is never claimed. */
  | { status: 'done'; action: ChartPdfAction; pages: number }
  | { status: 'failed'; action: ChartPdfAction; error: unknown };

/** Share hands the file to the share sheet; print opens the OS page preview (print or save from there). */
export type ChartPdfAction = 'share' | 'print';

/**
 * The OS print sheet rejects when it is closed without printing; that is a
 * choice the person made, not a failure to report.
 */
export const isPrintDismissal = (error: unknown): boolean =>
  error instanceof Error && /did not complete|cancel/i.test(error.message);
