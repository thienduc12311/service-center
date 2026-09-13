import { useEffect, useRef, useState } from 'react';

export interface ChartPreviewProps {
  /** A complete HTML document, as produced by the shared chart template. */
  html: string;
  /**
   * Whether the preview follows the editor. Turning it off freezes the last
   * render, which is what makes a long chart comfortable to type into.
   */
  autoRefresh: boolean;
}

/** How long typing has to pause before the preview re-renders. */
const REFRESH_DELAY_MS = 300;

/**
 * The live preview: the printable document itself, in an iframe.
 *
 * An iframe rather than inlined markup because the template carries its own
 * `@page`, fonts and colours — rendering it inside the app's document would
 * leave Tailwind's reset fighting the print stylesheet, and the preview would
 * stop being an honest picture of the PDF.
 */
export const ChartPreview = ({ html, autoRefresh }: ChartPreviewProps) => {
  const [rendered, setRendered] = useState(html);
  const latest = useRef(html);
  latest.current = html;

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setTimeout(() => setRendered(latest.current), REFRESH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [html, autoRefresh]);

  // Catching up the moment auto-refresh is switched back on saves the user a
  // keystroke to trigger the render they just asked for.
  useEffect(() => {
    if (autoRefresh) setRendered(latest.current);
  }, [autoRefresh]);

  return (
    <div className="h-full overflow-auto rounded-xl bg-slate-200/70 p-4 dark:bg-slate-800">
      <iframe
        title="Chord chart preview"
        srcDoc={rendered}
        // 8.5in is the template's page width, so the preview is a page.
        className="mx-auto block h-full min-h-[11in] w-full max-w-[8.5in] rounded-md border-0 bg-white shadow-lg"
      />
    </div>
  );
};
