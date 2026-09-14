/**
 * The Unicode fallback for charts the PDF's built-in fonts cannot set.
 *
 * A PDF reader is required to have Helvetica, Times and Courier, which is why
 * an ordinary chart embeds no font at all and comes out a few kilobytes. Those
 * fonts only speak WinAnsi, though — Latin-1 plus a handful of punctuation —
 * so a Vietnamese lyric, a Greek word or a Cyrillic title has no glyph and
 * would come out as nonsense.
 *
 * When a chart contains a character like that, the faces below are fetched and
 * embedded instead. It costs a request and a few hundred kilobytes in the file,
 * which is the right trade for the charts that need it and is why the charts
 * that don't never pay it.
 */

import type { ChartPdfDocument, ChartPdfFontFamily } from './types';

/**
 * The code points WinAnsi can encode: Latin-1 without the C1 control block,
 * plus the punctuation Windows put in its place.
 */
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

const isWinAnsiCodePoint = (code: number): boolean =>
  (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WINANSI_EXTRAS.has(code);

export const isWinAnsi = (text: string): boolean => {
  for (const char of text) {
    if (!isWinAnsiCodePoint(char.codePointAt(0) ?? 0)) return false;
  }
  return true;
};

/**
 * Which font families in a chart carry text the built-in fonts cannot set.
 *
 * Deciding per family rather than per run keeps a family internally
 * consistent: one accented word in the lyrics switches the whole chart body to
 * the fallback face, so the line with the accent does not end up set in a
 * different font from the line above it. Headings are a different family, and
 * are left on the built-in fonts unless they need the fallback themselves.
 */
export const unicodeChartFamilies = (chart: ChartPdfDocument): Set<ChartPdfFontFamily> => {
  const families = new Set<ChartPdfFontFamily>();

  for (const page of chart.pages) {
    for (const run of page.texts) {
      if (!isWinAnsi(run.text)) families.add(run.style.family);
    }
  }

  return families;
};

/** One TrueType face, ready to be handed to the PDF writer. */
export interface UnicodeChartFont {
  family: ChartPdfFontFamily;
  bold: boolean;
  /** The name the face is filed under inside the PDF. */
  name: string;
  /** The TrueType file itself, base64-encoded, as jsPDF's VFS wants it. */
  data: string;
}

interface UnicodeFaceSource {
  name: string;
  bold: boolean;
  url: string;
}

/**
 * Where each family's fallback comes from.
 *
 * `times` is served by the sans face on purpose: a serif with this much
 * coverage is several times the size, and a chart is a working document, not a
 * typographic one. Only a serif chart that also contains a character outside
 * Latin-1 is affected, and it is still a readable chart.
 */
const UNICODE_FACES: Record<ChartPdfFontFamily, readonly UnicodeFaceSource[]> = {
  courier: [
    { name: 'RobotoMono', bold: false, url: '/fonts/roboto-mono-regular.ttf' },
    { name: 'RobotoMono', bold: true, url: '/fonts/roboto-mono-bold.ttf' },
  ],
  helvetica: [
    { name: 'Roboto', bold: false, url: '/fonts/roboto-regular.ttf' },
    { name: 'Roboto', bold: true, url: '/fonts/roboto-bold.ttf' },
  ],
  times: [
    { name: 'Roboto', bold: false, url: '/fonts/roboto-regular.ttf' },
    { name: 'Roboto', bold: true, url: '/fonts/roboto-bold.ttf' },
  ],
};

/** Big files go through the VFS as base64, so a chunked encode is required. */
const CHUNK = 0x8000;

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return window.btoa(binary);
};

const fetchFace = async (
  family: ChartPdfFontFamily,
  source: UnicodeFaceSource,
): Promise<UnicodeChartFont> => {
  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`The font this chart needs could not be loaded (${response.status}).`);
  }

  return {
    family,
    bold: source.bold,
    name: source.name,
    data: toBase64(await response.arrayBuffer()),
  };
};

/**
 * Fetches the fallback faces for the given families, in both weights.
 *
 * Both weights always, because a bold chord over a regular lyric has to be the
 * same typeface for the chart to read as one.
 */
export const loadUnicodeChartFonts = async (
  families: ReadonlySet<ChartPdfFontFamily>,
): Promise<UnicodeChartFont[]> => {
  const wanted = [...families].flatMap((family) =>
    UNICODE_FACES[family].map((source) => fetchFace(family, source)),
  );

  return Promise.all(wanted);
};
