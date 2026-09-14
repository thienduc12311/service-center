/**
 * The intermediate representation a chart PDF is written from.
 *
 * It is deliberately dumb: a list of pages, each a list of filled boxes and
 * positioned lines of text, in points from the top-left of the paper. Nothing
 * in it knows about HTML, and nothing in it knows about PDF syntax — which is
 * what lets one module measure the rendered chart into this shape and another
 * write it out, without either needing to understand the other.
 */

/** A solid colour, as 0-255 channels. */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/**
 * One of the three font families a PDF reader is guaranteed to have.
 *
 * Sticking to them is what keeps the file small and the text selectable: no
 * font has to be embedded, and no glyph has to be turned into a picture. The
 * chart's CSS font stack is mapped onto the closest of the three.
 */
export type ChartPdfFontFamily = 'courier' | 'helvetica' | 'times';

export interface ChartPdfTextStyle {
  family: ChartPdfFontFamily;
  bold: boolean;
  /** Size in points. */
  size: number;
  color: RgbColor;
}

/** One visual line of text, positioned from the top-left corner of its page. */
export interface ChartPdfText {
  text: string;
  /** Points from the left edge of the paper to the start of the run. */
  x: number;
  /** Points from the top edge of the paper down to the text's baseline. */
  baseline: number;
  /**
   * How wide the browser drew this run, in points. The writer stretches its
   * own font to match, so a chart set in a font the PDF has no exact
   * equivalent of still breaks and aligns where the preview said it would.
   */
  width: number;
  style: ChartPdfTextStyle;
}

/** A filled rectangle — the grey band behind a chart's title, for instance. */
export interface ChartPdfBox {
  /** Points from the left edge of the paper. */
  x: number;
  /** Points from the top edge of the paper. */
  y: number;
  width: number;
  height: number;
  color: RgbColor;
}

/** Boxes are painted first, then text on top, both in document order. */
export interface ChartPdfPage {
  boxes: ChartPdfBox[];
  texts: ChartPdfText[];
}

export interface ChartPdfDocument {
  /** The PDF's title metadata, and the basis for the suggested filename. */
  title: string;
  /** Paper size in points. */
  widthPt: number;
  heightPt: number;
  pages: ChartPdfPage[];
}
