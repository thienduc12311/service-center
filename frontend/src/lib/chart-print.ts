/**
 * Getting a rendered chart out of the app: into its own tab, or into a PDF.
 *
 * Both take the very same HTML string the preview is showing, so what the user
 * reads on screen, opens in a tab and saves as a PDF cannot drift apart. The
 * PDF goes through the browser's own print pipeline rather than a rasteriser,
 * which is what keeps the text selectable, the monospace columns aligned and
 * the page breaks where the template's CSS asked for them.
 */

/** How long a detached print frame is kept alive when `afterprint` never fires. */
const PRINT_FRAME_TIMEOUT_MS = 60_000;

/**
 * Opens the chart in a new tab as a standalone document.
 *
 * Returns false when the browser blocked the pop-up, so the caller can say so
 * instead of looking like nothing happened.
 */
export const openChartInNewTab = (html: string): boolean => {
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
 * Prints the chart, which is how the user saves it as a PDF.
 *
 * The document is loaded into an off-screen iframe rather than the page itself
 * so the app's own styles, header and navigation are nowhere near the output —
 * the print dialog previews exactly the template and nothing else.
 */
export const printChart = (html: string): void => {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', 'Chord chart print preview');
  // Off-screen rather than `display: none`: a hidden frame does not lay out,
  // and a frame that has not laid out prints blank.
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.srcdoc = html;

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    frame.remove();
  };

  frame.onload = () => {
    const view = frame.contentWindow;
    if (!view) {
      remove();
      return;
    }

    // Removing the frame while the dialog is open cancels the job, so it is
    // torn down on `afterprint` — with a timeout for browsers that skip it.
    view.addEventListener('afterprint', remove);
    window.setTimeout(remove, PRINT_FRAME_TIMEOUT_MS);

    view.focus();
    view.print();
  };

  document.body.appendChild(frame);
};
