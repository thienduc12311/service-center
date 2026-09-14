import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { ChartDocument } from '@service-center/shared';
import { exportChartPdf, prefetchChartPdfWriter } from '../lib/chart-export';

export interface ChartPdfExport {
  /** Builds the PDF and downloads it. Safe to call from an onClick. */
  download: (chart: ChartDocument) => void;
  /** True while the chart is being laid out and written. */
  isExporting: boolean;
  /** Whatever went wrong, for an `ErrorNotice`. */
  error: unknown;
}

/**
 * Downloading a chart as a PDF, with the state a button needs around it.
 *
 * Building the PDF means laying the chart out off-screen first, which takes
 * long enough on a long chart to be worth showing — and can fail, which is
 * worth saying rather than leaving the button looking dead.
 */
export const useChartPdfExport = (): ChartPdfExport => {
  const mutation = useMutation<void, Error, ChartDocument>({ mutationFn: exportChartPdf });

  // Nothing that can export is on screen at page load, so the writer is
  // fetched when one appears rather than up front: the app still starts
  // without it, and the download does not begin with a download.
  useEffect(prefetchChartPdfWriter, []);

  return {
    download: mutation.mutate,
    isExporting: mutation.isPending,
    error: mutation.error,
  };
};
