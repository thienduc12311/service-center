/**
 * Turning a rendered chart into the page geometry a PDF can be written from.
 *
 * The chart template already knows how to lay itself out — it paginates in the
 * document, in the browser, and that layout is what the editor's preview shows.
 * So rather than reimplement pagination against font metrics and hope the two
 * agree, this module renders the very same HTML off-screen at true paper size,
 * lets the browser do the work, and then *reads back* where everything landed.
 *
 * That is the whole point of the exercise: the PDF cannot drift from the
 * preview, because the PDF is a transcription of the preview's own layout
 * rather than a second opinion about it. It is also why nothing here is
 * rasterised — every line of the chart comes out as real, selectable text.
 */

import { CHART_PAGE } from '@service-center/shared';
import type {
  ChartPdfBox,
  ChartPdfDocument,
  ChartPdfFontFamily,
  ChartPdfPage,
  ChartPdfText,
  ChartPdfTextStyle,
  RgbColor,
} from './types';

/** CSS reckons 96px to the inch; PDF reckons 72pt. */
const PT_PER_PX = 72 / 96;

/**
 * How wide the off-screen frame is made, in CSS pixels.
 *
 * Wide enough that the template's own preview scaling leaves the pages at 1:1
 * (it only ever scales down to fit), which keeps the measured boxes in real
 * paper units. The scale is pinned to 1 after load regardless — this is belt
 * and braces, and it spares the template a pointless scaling pass.
 */
const FRAME_WIDTH_PX = Math.ceil(CHART_PAGE.widthIn * 96) + 120;
const FRAME_HEIGHT_PX = Math.ceil(CHART_PAGE.heightIn * 96) + 120;

/** Two boxes within this many pixels of each other sit on the same line. */
const SAME_LINE_PX = 1;

/** How long to wait for the off-screen frame before giving up on it. */
const FRAME_LOAD_TIMEOUT_MS = 10_000;

const CSS_COLOR_RE = /^rgba?\(([^)]+)\)$/;

/**
 * Reads a computed `background-color` or `color`. Anything fully transparent
 * comes back as null, which is how a background nobody asked for is skipped.
 */
const parseCssColor = (value: string): RgbColor | null => {
  const match = CSS_COLOR_RE.exec(value.trim());
  const channels = match?.[1];
  if (!channels) return null;

  const parts = channels.split(/[,/]/).map((part) => Number.parseFloat(part.trim()));
  const [r, g, b] = parts;
  const alpha = parts.length > 3 ? parts[3] : 1;
  if (r === undefined || g === undefined || b === undefined) return null;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  if (alpha === 0) return null;

  return { r, g, b };
};

/**
 * Picks the PDF core font closest to a CSS font stack.
 *
 * `sans-serif` is tested before `serif` on purpose — it contains it.
 */
const pdfFontFamily = (stack: string): ChartPdfFontFamily => {
  const lower = stack.toLowerCase();
  if (/mono|courier|menlo|consolas|monaco/.test(lower)) return 'courier';
  if (/sans-serif|arial|helvetica|verdana|tahoma|segoe/.test(lower)) return 'helvetica';
  if (/serif|georgia|times|garamond|cambria|book/.test(lower)) return 'times';
  return 'helvetica';
};

const isBold = (weight: string): boolean =>
  weight === 'bold' || weight === 'bolder' || Number.parseInt(weight, 10) >= 600;

const applyTextTransform = (text: string, transform: string): string => {
  if (transform.startsWith('uppercase')) return text.toUpperCase();
  if (transform.startsWith('lowercase')) return text.toLowerCase();
  if (transform.startsWith('capitalize')) {
    return text.replace(/(^|\s)(\S)/g, (_, lead: string, char: string) => lead + char.toUpperCase());
  }
  return text;
};

/** The font properties a baseline measurement depends on. */
interface ProbeKey {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
}

const probeKeyOf = (style: CSSStyleDeclaration): ProbeKey => ({
  fontFamily: style.fontFamily,
  fontSize: style.fontSize,
  fontWeight: style.fontWeight,
});

const probeId = ({ fontFamily, fontSize, fontWeight }: ProbeKey): string =>
  `${fontFamily}|${fontSize}|${fontWeight}`;

/**
 * Where the baseline sits, in pixels below the top of a run's own box.
 *
 * A PDF positions text by its baseline; the browser hands out boxes. Bridging
 * the two means asking the font itself, which is what the zero-sized inline
 * marker does: aligned to `baseline`, its top *is* the baseline.
 */
const measureBaselineOffsets = (doc: Document, keys: ProbeKey[]): Map<string, number> => {
  const host = doc.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;';

  // Every probe is attached before a single one is measured, so the whole
  // batch costs one layout pass instead of one each.
  const probes = keys.map((key) => {
    const probe = doc.createElement('div');
    probe.style.whiteSpace = 'pre';
    probe.style.fontFamily = key.fontFamily;
    probe.style.fontSize = key.fontSize;
    probe.style.fontWeight = key.fontWeight;
    probe.style.lineHeight = 'normal';

    const sample = doc.createTextNode('Hxg');
    probe.appendChild(sample);

    const marker = doc.createElement('span');
    marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;';
    probe.appendChild(marker);

    host.appendChild(probe);
    return { key, sample, marker };
  });

  doc.body.appendChild(host);

  const offsets = new Map<string, number>();
  const range = doc.createRange();
  for (const { key, sample, marker } of probes) {
    range.selectNodeContents(sample);
    offsets.set(probeId(key), marker.getBoundingClientRect().top - range.getBoundingClientRect().top);
  }

  host.remove();
  return offsets;
};

/** A text node and the element whose styles it is painted with. */
interface TextRun {
  node: Text;
  element: HTMLElement;
  style: CSSStyleDeclaration;
}

const collectTextRuns = (view: Window, page: Element): TextRun[] => {
  const walker = page.ownerDocument.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  const runs: TextRun[] = [];

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    // Whitespace-only nodes are the template's own indentation, plus the
    // non-breaking space a blank lyric row holds its line open with. Neither
    // puts ink on the paper.
    if (!text.data.trim()) continue;

    const element = text.parentElement;
    if (!element) continue;

    runs.push({ node: text, element, style: view.getComputedStyle(element) });
  }

  return runs;
};

/** One visual line the browser broke a text node into. */
interface VisualLine {
  text: string;
  /** Viewport pixels. */
  left: number;
  /**
   * The right edge of the last character that puts ink down. Trailing spaces
   * are excluded on purpose: `pre-wrap` lets them hang past the end of a line,
   * so counting them would report a run as wider than it looks.
   */
  right: number;
  top: number;
}

/**
 * Splits a text node the way the browser drew it.
 *
 * A chart line that is wider than its column wraps, and the PDF has to wrap it
 * in the same place. Asking each character where it ended up is what finds
 * those breaks without having to predict them: characters that share a top
 * edge share a line.
 */
const visualLinesOf = (doc: Document, node: Text): VisualLine[] => {
  const range = doc.createRange();
  const data = node.data;
  const lines: VisualLine[] = [];
  let current: VisualLine | null = null;

  /** Trailing spaces are invisible; a line that is only spaces is nothing. */
  const flush = () => {
    if (!current) return;
    const text = current.text.replace(/\s+$/u, '');
    if (text) lines.push({ ...current, text });
    current = null;
  };

  for (let index = 0; index < data.length; index += 1) {
    const char = data.charAt(index);
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();

    // The space a wrap happened at has no box of its own. It still belongs to
    // the line being built — dropping it would close up the gap it stands for.
    if (rect.width === 0 && rect.height === 0) {
      if (current) current.text += char;
      continue;
    }

    const inked = !/\s/u.test(char);

    if (current && Math.abs(rect.top - current.top) <= SAME_LINE_PX) {
      current.text += char;
      if (inked) current.right = Math.max(current.right, rect.right);
      continue;
    }

    flush();
    current = {
      text: char,
      left: rect.left,
      right: inked ? rect.right : rect.left,
      top: rect.top,
    };
  }

  flush();
  return lines;
};

/** Everything needed to read one laid-out page back out of the document. */
interface PageReader {
  view: Window;
  doc: Document;
  baselines: Map<string, number>;
}

const readPage = ({ view, doc, baselines }: PageReader, page: Element): ChartPdfPage => {
  const origin = page.getBoundingClientRect();
  const toPt = (px: number): number => px * PT_PER_PX;
  const withinPage = (top: number, bottom: number): boolean =>
    bottom > origin.top - SAME_LINE_PX && top < origin.bottom + SAME_LINE_PX;

  const boxes: ChartPdfBox[] = [];
  // The page's own white background is the paper, so only what sits on top of
  // it is painted; `box-shadow` and the like are screen dressing and are not.
  for (const element of page.querySelectorAll<HTMLElement>('*')) {
    const color = parseCssColor(view.getComputedStyle(element).backgroundColor);
    if (!color) continue;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (!withinPage(rect.top, rect.bottom)) continue;

    boxes.push({
      x: toPt(rect.left - origin.left),
      y: toPt(rect.top - origin.top),
      width: toPt(rect.width),
      height: toPt(rect.height),
      color,
    });
  }

  const texts: ChartPdfText[] = [];
  for (const run of collectTextRuns(view, page)) {
    const color = parseCssColor(run.style.color) ?? { r: 0, g: 0, b: 0 };
    const size = Number.parseFloat(run.style.fontSize);
    if (!Number.isFinite(size)) continue;

    const style: ChartPdfTextStyle = {
      family: pdfFontFamily(run.style.fontFamily),
      bold: isBold(run.style.fontWeight),
      size: toPt(size),
      color,
    };
    const baselineOffset = baselines.get(probeId(probeKeyOf(run.style))) ?? size;
    const transform = run.style.textTransform;

    for (const line of visualLinesOf(doc, run.node)) {
      if (!withinPage(line.top, line.top + size)) continue;
      texts.push({
        text: applyTextTransform(line.text, transform),
        x: toPt(line.left - origin.left),
        baseline: toPt(line.top + baselineOffset - origin.top),
        width: toPt(line.right - line.left),
        style,
      });
    }
  }

  return { boxes, texts };
};

/**
 * Reads a chart document that has already been laid out in `frame`.
 *
 * Exported for its own sake so the measuring and the loading stay separable —
 * `renderChartPdfDocument` is the pair of them together.
 */
export const readChartPdfDocument = (frame: HTMLIFrameElement, title: string): ChartPdfDocument => {
  const view = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!view || !doc) throw new Error('The chart could not be laid out for export.');

  // The preview shrinks the page stack to fit its pane with a transform, and a
  // transform moves every box this module is about to read. Pinning it to 1:1
  // puts the measurements back into real paper units.
  doc.documentElement.style.setProperty('--preview-scale', '1');
  const stage = doc.querySelector<HTMLElement>('.chart-stage');
  if (stage) {
    stage.style.width = '';
    stage.style.height = '';
  }

  const pageElements = Array.from(doc.querySelectorAll('.page'));
  if (pageElements.length === 0) throw new Error('The chart came out empty.');

  const probeKeys = new Map<string, ProbeKey>();
  for (const page of pageElements) {
    for (const run of collectTextRuns(view, page)) {
      const key = probeKeyOf(run.style);
      probeKeys.set(probeId(key), key);
    }
  }

  const reader: PageReader = {
    view,
    doc,
    baselines: measureBaselineOffsets(doc, Array.from(probeKeys.values())),
  };

  return {
    title,
    widthPt: CHART_PAGE.widthIn * 72,
    heightPt: CHART_PAGE.heightIn * 72,
    pages: pageElements.map((page) => readPage(reader, page)),
  };
};

/**
 * Lays the chart out off-screen at true paper size and measures it.
 *
 * The frame is off-screen rather than hidden because a `display: none` frame
 * never lays out, and a frame that never lays out has nothing to measure. It
 * is always torn down, including when the measuring throws.
 */
export const renderChartPdfDocument = async (
  html: string,
  title: string,
): Promise<ChartPdfDocument> => {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', 'Chord chart export');
  frame.style.cssText = `position:fixed;left:-20000px;top:0;border:0;width:${FRAME_WIDTH_PX}px;height:${FRAME_HEIGHT_PX}px;`;

  const loaded = new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve();
    frame.onerror = () => reject(new Error('The chart could not be prepared for export.'));
    window.setTimeout(
      () => reject(new Error('The chart took too long to prepare for export.')),
      FRAME_LOAD_TIMEOUT_MS,
    );
  });

  frame.srcdoc = html;
  document.body.appendChild(frame);

  try {
    await loaded;
    // Measuring before the fonts are in would measure a fallback face, and the
    // whole document is positioned off what the fonts turn out to be.
    await frame.contentDocument?.fonts?.ready;
    return readChartPdfDocument(frame, title);
  } finally {
    frame.remove();
  }
};
