import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
 * `@page`, fonts and colours, and paginates itself — rendering it inside the
 * app's document would leave Tailwind's reset fighting the print stylesheet,
 * and the preview would stop being an honest picture of the PDF.
 */
export const ChartPreview = ({ html, autoRefresh }: ChartPreviewProps) => {
  const { t } = useTranslation('songs');
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

  // The document paints its own paper, gutter and page stack, and scrolls
  // itself, so the frame is just a window onto it at whatever size the pane is.
  //
  // Sandboxed without `allow-same-origin`: the preview only needs its own
  // pagination script, and nothing here reaches into the frame, so it runs in
  // an opaque origin with no access to the app's session or DOM. (The PDF and
  // print frames cannot do this — they are read and printed from the parent —
  // and rely on the document's own CSP instead.)
  return (
    <iframe
      title={t('chartEditor.previewTitle')}
      sandbox="allow-scripts"
      srcDoc={rendered}
      className="block h-full w-full rounded-xl border-0 bg-slate-600"
    />
  );
};
