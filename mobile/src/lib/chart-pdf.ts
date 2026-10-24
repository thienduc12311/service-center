import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { ChartDocument } from '@service-center/shared';
import { chartPdfName, chartPdfPrintOptions } from './chart-editing';
import { newIdempotencyKey } from './idempotency';

/**
 * MOB-029 device I/O for a chart PDF. The OS web view lays out the shared
 * chart document at US Letter and prints it to a real, text-based PDF — the
 * same template, pagination script and fonts the website's preview uses. The
 * file lives in a private temporary folder only while the share sheet or the
 * print preview is open, and is deleted afterwards; nothing is uploaded or
 * recorded on the server.
 */

const pdfRoot = (): Directory => new Directory(Paths.cache, 'chart-pdfs');

/** Removes every temporary chart PDF (after each action, and before the next). */
export const clearChartPdfs = (): void => {
  try {
    const root = pdfRoot();
    if (root.exists) root.delete();
  } catch {
    // Cache storage: the OS clears it too. Nothing else depends on it.
  }
};

/** A written chart PDF, named after its heading. */
export interface ChartPdfFile {
  uri: string;
  pages: number;
}

/** Prints the document to a PDF under its own name in a fresh private folder. */
export const writeChartPdf = async (doc: ChartDocument): Promise<ChartPdfFile> => {
  clearChartPdfs();
  const { uri, numberOfPages } = await Print.printToFileAsync(chartPdfPrintOptions(doc));
  const folder = new Directory(pdfRoot(), newIdempotencyKey());
  folder.create({ intermediates: true, idempotent: true });
  const written = new File(uri);
  written.moveSync(folder);
  // `rename` takes the name as written; joining it into a `File` path would
  // percent-encode it (a share sheet then reads "Amazing%20Grace%20[A].pdf").
  written.rename(chartPdfName(doc));
  return { uri: written.uri, pages: numberOfPages };
};

/** Writes the PDF, opens the share sheet with it, and deletes it once the sheet closes. */
export const shareChartPdf = async (doc: ChartDocument, dialogTitle: string): Promise<number> => {
  try {
    const pdf = await writeChartPdf(doc);
    await Sharing.shareAsync(pdf.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle });
    return pdf.pages;
  } finally {
    clearChartPdfs();
  }
};

/** Writes the PDF and opens the OS print preview of its pages (print or save from there). */
export const printChartPdf = async (doc: ChartDocument): Promise<number> => {
  try {
    const pdf = await writeChartPdf(doc);
    await Print.printAsync({ uri: pdf.uri });
    return pdf.pages;
  } finally {
    clearChartPdfs();
  }
};

export const isChartSharingAvailable = (): Promise<boolean> => Sharing.isAvailableAsync();
