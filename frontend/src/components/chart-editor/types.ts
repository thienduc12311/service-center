/**
 * The chart editor's form, save bodies and printed document now live in
 * `@service-center/shared` (`lib/chart-editor.ts`), so the website and the app
 * edit, preview and export a chart by exactly the same rules (MOB-029).
 */
export {
  chartDocumentFrom,
  chartEditorFormFrom,
  chartEditorIsDirty,
  chartEditorTitleChanged,
  toChartArrangementInput,
  toChartSongInput,
  type ChartDocumentSource,
  type ChartEditorFormValues,
} from '@service-center/shared';
