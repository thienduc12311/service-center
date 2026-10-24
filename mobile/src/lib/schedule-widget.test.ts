import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseExternalNavigationUrl } from '@service-center/shared';
import type { SchedulePlanGroup } from './schedule-groups';
import {
  SCHEDULE_WIDGET_MAX_ENTRIES,
  SCHEDULE_WIDGET_NAME,
  SCHEDULE_WIDGET_TTL_MS,
  buildScheduleWidgetTimeline,
  planWidgetUrl,
  signedOutWidgetProps,
  type ScheduleWidgetText,
} from './schedule-widget';

const mobileRoot = join(__dirname, '..', '..');
const source = (path: string): string => readFileSync(join(mobileRoot, path), 'utf8');

const org = { id: '11111111-1111-4111-8111-111111111111', name: 'Grace' };
const planA = '22222222-2222-4222-8222-222222222222';
const planB = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-10-23T12:00:00Z');

const text: ScheduleWidgetText = {
  heading: 'Next serving',
  empty: 'Nothing scheduled.',
  signedOut: 'Open the app.',
  expired: 'Open the app to refresh.',
  awaiting: 'Awaiting your answer',
  rehearse: 'Rehearse',
  updated: 'Updated',
};

const group = (planId: string, startsAt: string, endsAt: string, overrides: Partial<SchedulePlanGroup> = {}): SchedulePlanGroup =>
  ({
    key: `${org.id}:p:${planId}`,
    organizationId: org.id,
    personId: 'p',
    plan: { id: planId, title: `Plan ${planId.slice(0, 1)}`, service_date: startsAt.slice(0, 10), location: null, status: 'published' },
    startsAt,
    responsibilities: [
      { status: 'confirmed', team: { id: 't', name: 'Band', color: '#000' }, position: { id: 'k', name: 'Keys' } },
    ],
    times: [{ id: 'x', kind: 'service', name: null, startsAt, endsAt, requiredBy: [] }],
    status: 'confirmed',
    pendingCount: 0,
    ...overrides,
  }) as unknown as SchedulePlanGroup;

const build = (groups: SchedulePlanGroup[], rehearsalTracks: Record<string, number> = {}) =>
  buildScheduleWidgetTimeline({ now, organization: org, groups, rehearsalTracks, text, formatWhen: (iso) => `at ${iso}` });

describe('schedule widget timeline', () => {
  it('shows my next services in order, worded, with validated plan links', () => {
    const [first] = build([
      group(planB, '2026-10-26T15:00:00Z', '2026-10-26T17:00:00Z'),
      group(planA, '2026-10-24T15:00:00Z', '2026-10-24T17:00:00Z', { pendingCount: 1 }),
    ]);
    expect(first?.props.state).toBe('ready');
    expect(first?.props.entries.map((entry) => entry.title)).toEqual(['Plan 2', 'Plan 3']);
    expect(first?.props.entries[0]).toMatchObject({ detail: 'Band · Keys', status: 'Awaiting your answer', when: 'at 2026-10-24T15:00:00Z' });
    const parsed = parseExternalNavigationUrl(first?.props.entries[0]?.url, { schemes: ['servicecenter'], hosts: [] });
    expect(parsed).toMatchObject({ status: 'accepted', intent: { kind: 'plan', planId: planA, organizationId: org.id } });
  });

  it('offers rehearsal only when the plan has something playable, through the same ingress', () => {
    const entries = build([group(planA, '2026-10-24T15:00:00Z', '2026-10-24T17:00:00Z')], { [planA]: 2 })[0]?.props.entries ?? [];
    expect(entries[0]?.rehearseUrl).toBe(planWidgetUrl(org.id, planA, 'rehearse'));
    expect(parseExternalNavigationUrl(entries[0]?.rehearseUrl, { schemes: ['servicecenter'], hosts: [] })).toMatchObject({
      status: 'accepted',
      intent: { view: 'rehearse', planId: planA },
    });
    expect(build([group(planA, '2026-10-24T15:00:00Z', '2026-10-24T17:00:00Z')], { [planA]: 0 })[0]?.props.entries[0]?.rehearseUrl).toBe('');
  });

  it('drops a service when it ends and expires the snapshot after the TTL', () => {
    const timeline = build([group(planA, '2026-10-23T13:00:00Z', '2026-10-23T14:00:00Z')]);
    expect(timeline.map((entry) => entry.props.state)).toEqual(['ready', 'empty', 'expired']);
    expect(timeline[1]?.date.toISOString()).toBe('2026-10-23T14:00:00.000Z');
    expect(timeline.at(-1)?.date.getTime()).toBe(now.getTime() + SCHEDULE_WIDGET_TTL_MS);
    expect(timeline.at(-1)?.props.entries).toEqual([]);
  });

  it('leaves out declined plans and caps the medium list', () => {
    const declined = group(planA, '2026-10-24T15:00:00Z', '2026-10-24T17:00:00Z', {
      responsibilities: [{ status: 'declined', team: null, position: null }] as unknown as SchedulePlanGroup['responsibilities'],
    });
    expect(build([declined])[0]?.props.state).toBe('empty');
    const many = Array.from({ length: 5 }, (_, index) =>
      group(`${index}2222222-2222-4222-8222-222222222222`, `2026-10-2${4 + index}T15:00:00Z`, `2026-10-2${4 + index}T17:00:00Z`),
    );
    expect(build(many)[0]?.props.entries).toHaveLength(SCHEDULE_WIDGET_MAX_ENTRIES);
  });

  it('never puts null in the stored props (UserDefaults cannot hold it)', () => {
    const timeline = build([group(planA, '2026-10-24T15:00:00Z', '2026-10-24T17:00:00Z')]);
    const hasNull = (value: unknown): boolean =>
      value === null || (typeof value === 'object' && Object.values(value as object).some(hasNull));
    expect(timeline.some((entry) => hasNull(entry.props))).toBe(false);
    expect(hasNull(signedOutWidgetProps(text))).toBe(false);
  });

  it('writes nothing personal in the signed-out state', () => {
    const props = signedOutWidgetProps(text);
    expect(props).toMatchObject({ state: 'signedOut', organizationName: '', entries: [] });
    expect(JSON.stringify(props)).not.toMatch(/open\/plan/);
  });
});

describe('source contract', () => {
  it('names the same widget in the config plugin and the component', () => {
    expect(source('app.config.js')).toContain(`name: '${SCHEDULE_WIDGET_NAME}'`);
    expect(source('src/widgets/ScheduleWidget.tsx')).toContain('createWidget(SCHEDULE_WIDGET_NAME');
  });

  it('keeps the widget function self-contained and titles privacy-sensitive', () => {
    const widget = source('src/widgets/ScheduleWidget.tsx');
    expect(widget).toContain("'widget';");
    expect(widget).not.toMatch(/use(State|Effect|Query)|fetch\(|api\./);
    expect(widget).toContain('privacySensitive()');
  });

  it('loads the widget only where the native module exists and clears it on identity change', () => {
    const bridge = source('src/lib/widget-bridge.ts');
    expect(bridge).toContain("requireOptionalNativeModule('ExpoWidgets')");
    expect(bridge).toContain("Platform.OS !== 'ios'");
    const sync = source('src/lib/useScheduleWidgetSync.ts');
    expect(sync).toContain('clearScheduleWidget(signedOutWidgetProps(text))');
    expect(sync).toContain("queryKeys.scheduleWindow(queryScope, 'upcoming')");
    // Reads only; the widget never answers or edits anything.
    expect(sync).not.toMatch(/api\.(respond|update|create|delete)/);
  });
});
