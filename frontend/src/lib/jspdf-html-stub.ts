/**
 * Stands in for the three libraries jsPDF reaches for from `doc.html()`.
 *
 * `doc.html()` is jsPDF's other way of making a PDF: screenshot the page with
 * html2canvas, redraw it with canvg, sanitise it with dompurify. The chord
 * chart does none of that — it is drawn from measured geometry as real text
 * (see `chart-export/layout.ts`) — but bundlers cannot know that, so the three
 * of them were being emitted as ~390 kB of chunks nothing would ever fetch.
 *
 * `vite.config.ts` aliases all three here instead. Nothing imports this file
 * directly; it exists to be substituted.
 */

const unbundled = (): never => {
  throw new Error(
    "jsPDF's html() renderer is not bundled. It is aliased away in vite.config.ts " +
      'because the chord chart is drawn as text rather than screenshotted; drop the ' +
      'alias if you genuinely need it.',
  );
};

export default unbundled;
