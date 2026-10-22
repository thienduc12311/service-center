import {
  calendarLayerEventDays,
  toISODate,
  type CalendarEvent,
  type CalendarLayerEvent,
  type ReportFiltersRequest,
  type ReportKind,
} from '@service-center/shared';

/**
 * MOB-022 native presentation helpers. Requests and response meanings come
 * from the shared `calendar-sharing` module; these only arrange them for a
 * phone and describe what the operating system reported.
 */

/** One civil day of the agenda: plan times, and opt-in layer entries shown dashed. */
export interface AgendaDay {
  isoDate: string;
  events: CalendarEvent[];
  layers: CalendarLayerEvent[];
}

/**
 * Plan times and layer entries grouped by the viewer's civil day (the website
 * month grid uses the same day), days in order. Layer entries outside the
 * visible month are left out, as the agenda shows one month.
 */
export const agendaDays = (
  events: readonly CalendarEvent[],
  layers: readonly CalendarLayerEvent[],
  month: { from: string; to: string },
): AgendaDay[] => {
  const first = toISODate(month.from);
  const last = toISODate(month.to);
  const days = new Map<string, AgendaDay>();
  const day = (isoDate: string): AgendaDay => {
    const existing = days.get(isoDate);
    if (existing) return existing;
    const created: AgendaDay = { isoDate, events: [], layers: [] };
    days.set(isoDate, created);
    return created;
  };
  for (const event of events) day(toISODate(event.starts_at)).events.push(event);
  for (const layer of layers) {
    for (const isoDate of calendarLayerEventDays(layer)) {
      if (isoDate >= first && isoDate <= last) day(isoDate).layers.push(layer);
    }
  }
  return [...days.values()].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
};

/** What React Native's `Share.share` resolves with (`Share.sharedAction` / `Share.dismissedAction`). */
export interface ShareResultSnapshot {
  action: string;
}

/**
 * - `handedOff`: the share sheet finished. iOS reports a chosen target; Android
 *   reports only that the sheet opened, never whether anything was sent.
 * - `cancelled`: the person closed the sheet without choosing (iOS only).
 */
export type ShareOutcome = 'handedOff' | 'cancelled';

export const shareOutcome = (result: ShareResultSnapshot): ShareOutcome =>
  result.action === 'dismissedAction' ? 'cancelled' : 'handedOff';

/** The same file name the website downloads, used as the share subject. */
export const reportCsvFilename = (kind: ReportKind, filters: Pick<ReportFiltersRequest, 'from' | 'to'>): string =>
  `${kind.replace('_', '-')}-${filters.from}-to-${filters.to}.csv`;

/** The two dates of a report are a valid range in order (the server also allows at most 366 days). */
export const reportRangeInOrder = (filters: Pick<ReportFiltersRequest, 'from' | 'to'>): boolean =>
  filters.from <= filters.to;
