/**
 * The codes a chart can be written with beyond plain chords and lyrics, as the
 * chart editors list them. The codes are literal text, the same in every
 * language; each description is translated under `songs:chartEditor.codes`.
 */

export type ChartCodeId =
  | 'heading'
  | 'note'
  | 'chartNote'
  | 'breaks'
  | 'formatting'
  | 'literal'
  | 'transpose'
  | 'redefine';

export interface ChartCodeReference {
  id: ChartCodeId;
  /** What to type, exactly as it is typed. */
  code: string;
}

export const CHART_CODE_REFERENCE: readonly ChartCodeReference[] = [
  { id: 'heading', code: 'VERSE 1 · CHORUS · BRIDGE · TAG' },
  { id: 'note', code: '{ Repeat 2x }' },
  { id: 'chartNote', code: '{{ Build }}' },
  { id: 'breaks', code: 'COLUMN_BREAK · PAGE_BREAK' },
  { id: 'formatting', code: '<b>bold</b> <i>italic</i> <u>underline</u>' },
  { id: 'literal', code: '<t>[Em]</t>' },
  { id: 'transpose', code: 'TRANSPOSE KEY +2' },
  { id: 'redefine', code: 'REDEFINE KEY +2' },
];
