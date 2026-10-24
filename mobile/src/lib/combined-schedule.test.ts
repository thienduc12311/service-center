import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { combinedScheduleQuerySchema, type BlockoutRow, type CombinedSchedule, type CurrentUser } from '@service-center/shared';
import { queryKeys } from './query-keys';
import {
  COMBINED_WINDOW_DAYS,
  combinedScheduleWindow,
  combinedSections,
  copyAvailabilityBody,
  copySelectionSignature,
  copyTargets,
  copyableBlockouts,
  scheduleSettingsInput,
  timeZoneNote,
} from './combined-schedule';

const mobileRoot = join(__dirname, '..', '..');
const source = (path: string): string => readFileSync(join(mobileRoot, path), 'utf8');

const orgA = '11111111-1111-4111-8111-111111111111';
const orgB = '22222222-2222-4222-8222-222222222222';
const orgC = '33333333-3333-4333-8333-333333333333';
const blockoutId = '44444444-4444-4444-8444-444444444444';
const key = '55555555-5555-4555-8555-555555555555';

const user = {
  profile: { id: 'u1' },
  memberships: [
    { organization: { id: orgA, name: 'Grace', timezone: 'America/Chicago' } },
    { organization: { id: orgB, name: 'Hope', timezone: 'Asia/Ho_Chi_Minh' } },
    { organization: { id: orgC, name: 'Removed', timezone: 'UTC' } },
  ],
} as unknown as CurrentUser;

const schedule: CombinedSchedule = {
  from: '2026-10-23T00:00:00.000Z',
  to: '2026-11-22T00:00:00.000Z',
  organizations: [
    {
      organization_id: orgA,
      organization_name: 'Grace',
      status: 'ok',
      error: null,
      items: [
        { kind: 'blockout', item_id: 'b1', title: 'Unavailable', status: null, starts_at: '2026-10-30T00:00:00Z', ends_at: '2026-10-31T00:00:00Z', plan_id: null },
        { kind: 'assignment', item_id: 'a1', title: 'Sunday', status: 'unconfirmed', starts_at: '2026-10-25T14:00:00Z', ends_at: '2026-10-25T16:00:00Z', plan_id: 'plan-a' },
      ],
    },
    { organization_id: orgB, organization_name: 'Hope', status: 'error', error: 'Request failed', items: [] },
    {
      organization_id: 'unknown-org',
      organization_name: 'New church',
      status: 'ok',
      error: null,
      items: [{ kind: 'assignment', item_id: 'a9', title: 'Vigil', status: 'confirmed', starts_at: '2026-10-26T01:00:00Z', ends_at: '2026-10-26T02:00:00Z', plan_id: 'plan-z' }],
    },
  ],
};

describe('combined schedule', () => {
  it('asks the server for the website window, valid for its schema', () => {
    const window = combinedScheduleWindow(new Date('2026-10-23T12:00:00Z'));
    expect(combinedScheduleQuerySchema.safeParse(window).success).toBe(true);
    // Calendar days in the device zone (shared `addDays`, as on the website): a DST change moves it by up to an hour.
    const span = new Date(window.to).getTime() - new Date(window.from).getTime();
    expect(Math.abs(span - COMBINED_WINDOW_DAYS * 86_400_000)).toBeLessThanOrEqual(3_600_000);
  });

  it('treats a never-saved choice as off (opt-in)', () => {
    expect(scheduleSettingsInput(undefined)).toEqual({ combined_schedule: false, share_busy_across_orgs: false });
  });

  it('keeps each organization separate, in time order, with its own zone', () => {
    const [grace] = combinedSections(schedule, user, orgA);
    expect(grace).toMatchObject({ organizationId: orgA, timeZone: 'America/Chicago', isActive: true, state: 'ok' });
    expect(grace?.rows.map((row) => row.item.item_id)).toEqual(['a1', 'b1']);
    expect(grace?.rows[0]).toMatchObject({ awaitingAnswer: true, planId: 'plan-a', title: { kind: 'assignment', title: 'Sunday' } });
    expect(grace?.rows[1]).toMatchObject({ planId: null, title: { kind: 'unavailable' } });
  });

  it('shows a failed organization as failed while the others still load', () => {
    const hope = combinedSections(schedule, user, orgA).find((section) => section.organizationId === orgB);
    expect(hope).toMatchObject({ state: 'error', error: 'Request failed', rows: [] });
  });

  it('marks a revoked membership and never opens an organization this account does not list', () => {
    const sections = combinedSections(schedule, user, orgA);
    expect(sections.find((section) => section.organizationId === orgC)).toMatchObject({ state: 'revoked', rows: [] });
    const stale = sections.find((section) => section.organizationId === 'unknown-org');
    expect(stale?.state).toBe('stale');
    expect(stale?.rows.every((row) => row.planId === null)).toBe(true);
  });

  it('names the original time zone only when it differs from the device', () => {
    expect(timeZoneNote('America/Chicago', 'America/Chicago')).toBeNull();
    expect(timeZoneNote('Asia/Ho_Chi_Minh', 'America/Chicago')).toBe('Asia/Ho_Chi_Minh');
    expect(timeZoneNote(null, 'UTC')).toBeNull();
  });
});

describe('copying availability', () => {
  it('copies one-off blockouts into the other organizations only', () => {
    const rows = [{ id: 'one', series_id: null }, { id: 'series', series_id: 's1' }] as BlockoutRow[];
    expect(copyableBlockouts(rows).map((row) => row.id)).toEqual(['one']);
    expect(copyTargets(user, orgA).map((m) => m.organization.id)).toEqual([orgB, orgC]);
  });

  it('builds the reviewed request with the shared schema and keeps reasons private by default', () => {
    expect(copyAvailabilityBody([blockoutId], [orgB], false, key)).toEqual({
      blockout_ids: [blockoutId],
      target_organization_ids: [orgB],
      include_reason: false,
      idempotency_key: key,
    });
    expect(() => copyAvailabilityBody([], [orgB], false, key)).toThrow();
  });

  it('keeps one key per selection regardless of tap order', () => {
    expect(copySelectionSignature(['b', 'a'], [orgB, orgA], false)).toBe(copySelectionSignature(['a', 'b'], [orgA, orgB], false));
    expect(copySelectionSignature(['a'], [orgB], true)).not.toBe(copySelectionSignature(['a'], [orgB], false));
  });
});

describe('source contract', () => {
  it('keeps cross-organization reads under the account/generation root', () => {
    const scope = { userId: 'u1', organizationId: orgA, generation: 2 };
    const window = combinedScheduleWindow(new Date('2026-10-23T12:00:00Z'));
    expect(queryKeys.combinedSchedule(scope, window).slice(0, 4)).toEqual(['private', 'u1', orgA, 2]);
    expect(queryKeys.scheduleSettings({ ...scope, userId: 'u2' })).not.toEqual(queryKeys.scheduleSettings(scope));
  });

  it('opens another organization only through the validated intent path, and reviews before copying', () => {
    const screen = source('app/across-organizations.tsx');
    expect(screen).toContain('openPlanInOrganization(section.organizationId, planId)');
    expect(screen).not.toMatch(/router\.(push|replace)\(.*plan/);
    expect(screen).not.toMatch(/switchOrganization/);
    expect(screen).toMatch(/Alert\.alert\(\s*t\('mobileAcross\.reviewTitle'\)/);
    // Self aggregation only: no delegated/household reads on this screen.
    expect(screen).not.toMatch(/delegat/i);
  });
});
