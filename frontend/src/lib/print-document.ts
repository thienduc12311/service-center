/** How long a detached print frame is kept alive when `afterprint` never fires. */
const PRINT_FRAME_TIMEOUT_MS = 60_000;

/**
 * Prints a self-contained HTML document through the browser's PDF pipeline.
 *
 * The service song book uses mixed landscape and portrait pages, so it cannot
 * go through the single-chart PDF writer. Loading it in an off-screen frame
 * keeps the app shell out of the output while preserving its CSS page sizes.
 */
export const printDocument = (html: string, frameTitle: string): void => {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', frameTitle);
  // The frame must participate in layout for its pagination script to measure
  // the document, but it does not need to be visible in the app.
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

    // Removing the frame while the dialog is open cancels the job. The timeout
    // handles browsers that do not dispatch `afterprint`.
    view.addEventListener('afterprint', remove);
    window.setTimeout(remove, PRINT_FRAME_TIMEOUT_MS);

    view.focus();
    view.print();
  };

  document.body.appendChild(frame);
};
