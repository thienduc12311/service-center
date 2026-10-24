import { CHART_PAGE } from '@service-center/shared';

/**
 * MOB-030 (optional stage, iOS): scanning pages into one PDF that is then
 * uploaded through the unchanged MOB-026 F13 lifecycle (intent → signed PUT →
 * finalize). Pages are photos the person takes (or picks) and reviews; the
 * PDF is written by the OS web view from plain image pages. There is no edge
 * detection, perspective correction or OCR — those would need a native
 * document-scanner module and a development build, and stay gated.
 */

/** A scan is a few sheets, not a book: the 25 MB file limit is reached long before this. */
export const SCAN_MAX_PAGES = 30;

/** Longest edge a page is kept at: sharp enough to read when printed, small enough to upload. */
export const SCAN_PAGE_MAX_EDGE = 2000;

/** JPEG quality pages are re-saved at. */
export const SCAN_PAGE_QUALITY = 0.72;

/** One reviewed page, as captured on the device. */
export interface ScanPage {
  /** Stable within one scan, for list keys and moves. */
  id: string;
  /** Local `file://` JPEG, already downsized. */
  uri: string;
  width: number;
  height: number;
}

/** The resize that keeps a page's longest edge at `SCAN_PAGE_MAX_EDGE`; null when it is already small enough. */
export const scanPageResize = (width: number, height: number): { width: number } | { height: number } | null => {
  if (width <= SCAN_PAGE_MAX_EDGE && height <= SCAN_PAGE_MAX_EDGE) return null;
  return width >= height ? { width: SCAN_PAGE_MAX_EDGE } : { height: SCAN_PAGE_MAX_EDGE };
};

/** Moves one page up (-1) or down (+1); out-of-range moves change nothing. */
export const moveScanPage = <T>(pages: readonly T[], index: number, direction: -1 | 1): T[] => {
  const target = index + direction;
  if (index < 0 || index >= pages.length || target < 0 || target >= pages.length) return [...pages];
  const next = [...pages];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as T);
  return next;
};

export const removeScanPage = <T>(pages: readonly T[], index: number): T[] => pages.filter((_, position) => position !== index);

export const canAddScanPage = (pages: readonly unknown[]): boolean => pages.length < SCAN_MAX_PAGES;

/** Points per inch: the PDF's own unit. */
const PT_PER_IN = 72;

/** What the OS print renderer is handed: one page per image, US Letter like the chart PDFs. */
export interface ScanPdfPrintOptions {
  html: string;
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
}

/** Only image data the app produced itself goes into the page (never a remote or arbitrary URL). */
const isJpegDataUri = (value: string): boolean => /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value);

/**
 * The scan as an HTML document of fixed paper pages, each image fitted inside
 * a half-inch margin without cropping or stretching. No script: the layout
 * is plain print CSS, so every platform's print renderer paginates it alike.
 */
export const scanPdfHtml = (images: readonly string[], title: string): string => {
  const pages = images
    .filter(isJpegDataUri)
    .map((src, index) => `<section class="page"><img src="${src}" alt="${index + 1}" /></section>`)
    .join('\n');
  const escapedTitle = title.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapedTitle}</title>
    <style>
      @page { size: ${CHART_PAGE.widthIn}in ${CHART_PAGE.heightIn}in; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #ffffff; }
      .page {
        width: ${CHART_PAGE.widthIn}in;
        height: ${CHART_PAGE.heightIn}in;
        padding: ${CHART_PAGE.marginIn}in;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        break-after: page;
        page-break-after: always;
      }
      .page:last-child { break-after: auto; page-break-after: auto; }
      .page img { max-width: 100%; max-height: 100%; object-fit: contain; }
    </style>
  </head>
  <body>
${pages}
  </body>
</html>
`;
};

export const scanPdfPrintOptions = (images: readonly string[], title: string): ScanPdfPrintOptions => ({
  html: scanPdfHtml(images, title),
  width: CHART_PAGE.widthIn * PT_PER_IN,
  height: CHART_PAGE.heightIn * PT_PER_IN,
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
});

const pad = (value: number): string => String(value).padStart(2, '0');

/** `Scan 2026-10-23 19.45.pdf` in the phone's local time — the file's default title. */
export const scanFileName = (now: Date): string =>
  `Scan ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.pdf`;
