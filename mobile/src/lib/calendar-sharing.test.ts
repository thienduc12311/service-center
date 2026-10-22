import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reportFiltersSchema, type CalendarEvent, type CalendarLayerEvent } from '@service-center/shared';
import { agendaDays, reportCsvFilename, reportRangeInOrder, shareOutcome } from './calendar-sharing';
import { queryKeys } from './query-keys';

const at = (day: number, hour: number): string => new Date(2026, 9, day, hour).toISOString();
const month = { from: new Date(2026, 9, 1, 0, 0).toISOString(), to: new Date(2026, 9, 31, 23, 59).toISOString() };

const event = (id: string, startsAt: string): CalendarEvent => ({
  id,
  plan_id: `plan-${id}`,
  title: 'Sunday',
  kind: 'service',
  starts_at: startsAt,
  ends_at: startsAt,
  status: 'published',
  location: null,
  service_type: null,
});

const layer = (overrides: Partial<CalendarLayerEvent>): CalendarLayerEvent => ({
  id: 'birthdays-p-2026-10-04',
  layer: 'birthdays',
  person_id: 'p',
  person_name: 'Riley',
  date: '2026-10-04',
  starts_at: null,
  ends_at: null,
  all_day: true,
  ...overrides,
});

describe('MOB-022 agenda', () => {
  it('groups plan times and layer entries by civil day, in order, keeping days with only a layer', () => {
    const days = agendaDays(
      [event('b', at(11, 9)), event('a', at(4, 9)), event('c', at(4, 18))],
      [layer({}), layer({ id: 'blockout-1', layer: 'blockouts', date: null, all_day: false, starts_at: at(7, 9), ends_at: at(7, 17) })],
      month,
    );
    expect(days.map((day) => [day.isoDate, day.events.map((e) => e.id), day.layers.map((l) => l.layer)])).toEqual([
      ['2026-10-04', ['a', 'c'], ['birthdays']],
      ['2026-10-07', [], ['blockouts']],
      ['2026-10-11', ['b'], []],
    ]);
  });

  it('leaves out layer days outside the visible month', () => {
    const days = agendaDays(
      [],
      [layer({ id: 'blockout-2', layer: 'blockouts', date: null, all_day: false, starts_at: at(30, 9), ends_at: new Date(2026, 10, 2, 9).toISOString() })],
      month,
    );
    expect(days.map((day) => day.isoDate)).toEqual(['2026-10-30', '2026-10-31']);
  });
});

describe('MOB-022 share handoff', () => {
  it('reports cancellation only when the OS says the sheet was dismissed', () => {
    expect(shareOutcome({ action: 'dismissedAction' })).toBe('cancelled');
    expect(shareOutcome({ action: 'sharedAction' })).toBe('handedOff');
  });

  it('names the CSV like the website download and checks the range order', () => {
    expect(reportCsvFilename('schedule', { from: '2026-10-01', to: '2026-10-31' })).toBe('schedule-2026-10-01-to-2026-10-31.csv');
    expect(reportRangeInOrder({ from: '2026-10-02', to: '2026-10-01' })).toBe(false);
    expect(reportRangeInOrder({ from: '2026-10-01', to: '2026-10-01' })).toBe(true);
    // The server refuses the same reversed range.
    expect(reportFiltersSchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success).toBe(false);
  });
});

describe('MOB-022 source contract', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');
  const calendar = read('app', '(tabs)', 'calendar.tsx');
  const subscription = read('app', 'calendar-subscription.tsx');
  const report = read('app', 'schedule-report.tsx');

  it('asks the calendar the website’s question through the shared builders', () => {
    expect(calendar).toContain('calendarQueryFor(filters, range)');
    expect(calendar).toContain('calendarLayersRequestFor(filters, range)');
    expect(calendar).toContain('api.calendarLayers(');
    expect(calendar).toContain("canAnywhere('scheduling.manage')");
  });

  it('keeps the personal link in screen memory only', () => {
    expect(subscription).toContain('api.getCalendarFeed()');
    expect(subscription).toContain('api.rotateCalendarFeed()');
    expect(subscription).toContain('gcTime: 0');
    expect(subscription).toContain('rotate.reset()');
    expect(subscription).toMatch(/if \(!visible\) \{\s*setRevealed\(null\)/);
    expect(subscription).not.toMatch(/console\.|AsyncStorage|setQueryData/);
    // The status key carries no URL or token.
    expect(queryKeys.personalCalendarFeed({ userId: 'u', organizationId: 'o', generation: 1 })).toEqual([
      'private', 'u', 'o', 1, 'calendar-feed', 'me',
    ]);
  });

  it('asks before replacing an active link and offers no shared-feed administration', () => {
    expect(subscription).toContain('Alert.alert(');
    expect(subscription).not.toMatch(/createScopedCalendarFeed|rotateScopedCalendarFeed|revokeScopedCalendarFeed/);
  });

  it('uses the implemented report methods, polls exports only while visible, and hands files to the OS', () => {
    for (const method of ['api.scheduleReport(', "api.reportCsv('schedule'", 'api.requestReportExport(', 'api.reportExports()', 'api.reportExportDownload(']) {
      expect(report).toContain(method);
    }
    expect(report).toContain('visible && reportExportsInProgress(query.state.data)');
    expect(report).toContain('Linking.openURL(link.url)');
    expect(report).toContain('Share.share(');
    expect(report).not.toMatch(/console\.|AsyncStorage|expo-print/);
  });

  it('keys one export per run, so double taps and retries reuse it', () => {
    expect(report).toContain('useMemo(() => (applied ? newIdempotencyKey() : null), [applied])');
  });
});
