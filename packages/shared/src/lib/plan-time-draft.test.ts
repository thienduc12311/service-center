import { describe, expect, it } from 'vitest';
import { previewPlanTimesSchema } from '../schemas/attendance.js';
import { updatePlanSchema } from '../schemas/plan.js';
import type { PlanTimeImpact, PlanTimeImpactAssignment } from '../types/attendance.js';
import {
  movePlanTimeDraft,
  newPlanTimeDraft,
  planTimeDraftIsRepeated,
  planTimeDraftsFrom,
  planTimeEndsNextDay,
  planTimeImpactNeedsReview,
  planTimesFingerprint,
  resolvePlanTimeDrafts,
  unresolvedOrphans,
  updatePlanTimesBody,
  type PlanTimeDraft,
} from './plan-time-draft.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ZONE = 'America/Chicago';

const time = (n: number, starts_at: string, ends_at: string, sort_order: number, kind: 'service' | 'rehearsal' = 'service') => ({
  id: id(n),
  kind,
  name: kind === 'service' ? 'Main' : null,
  starts_at,
  ends_at,
  sort_order,
});

// Saved with seconds, so a round trip through HH:MM would visibly change it.
const SAVED = [
  time(2, '2027-06-06T14:00:30.000Z', '2027-06-06T15:30:00.000Z', 1),
  time(1, '2027-06-04T23:00:00.000Z', '2027-06-05T01:00:00.000Z', 0, 'rehearsal'),
];

const resolved = (drafts: PlanTimeDraft[]) => {
  const result = resolvePlanTimeDrafts(drafts, ZONE);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.times;
};

describe('plan time drafts on the organization clock', () => {
  it('opens saved times in order, on the organization wall clock', () => {
    const drafts = planTimeDraftsFrom(SAVED, ZONE);
    expect(drafts.map((d) => [d.id, d.localDate, d.localStart, d.localEnd])).toEqual([
      [id(1), '2027-06-04', '18:00', '20:00'],
      [id(2), '2027-06-06', '09:00', '10:30'],
    ]);
  });

  it('an untouched list sends the stored instants and ids unchanged', () => {
    const times = resolved(planTimeDraftsFrom(SAVED, ZONE));
    expect(times).toEqual([
      { id: id(1), kind: 'rehearsal', name: null, sort_order: 0, starts_at: SAVED[1]!.starts_at, ends_at: SAVED[1]!.ends_at },
      { id: id(2), kind: 'service', name: 'Main', sort_order: 1, starts_at: SAVED[0]!.starts_at, ends_at: SAVED[0]!.ends_at },
    ]);
    expect(previewPlanTimesSchema.safeParse({ times }).success).toBe(true);
  });

  it('reorder keeps every id and only renumbers sort_order', () => {
    const moved = movePlanTimeDraft(planTimeDraftsFrom(SAVED, ZONE), 1, -1)!;
    const times = resolved(moved);
    expect(times.map((t) => [t.id, t.sort_order, t.starts_at])).toEqual([
      [id(2), 0, SAVED[0]!.starts_at],
      [id(1), 1, SAVED[1]!.starts_at],
    ]);
    expect(movePlanTimeDraft(moved, 0, -1)).toBeNull();
    expect(movePlanTimeDraft(moved, 1, 1)).toBeNull();
  });

  it('delete drops only that id; a new row carries its client id', () => {
    const drafts = planTimeDraftsFrom(SAVED, ZONE).filter((d) => d.id !== id(1));
    const added = newPlanTimeDraft(id(9), drafts.at(-1), '2027-06-01');
    expect(added).toMatchObject({ localDate: '2027-06-06', localStart: '09:00', localEnd: '10:30', origin: null });
    const times = resolved([...drafts, { ...added, localStart: '11:00', localEnd: '12:00' }]);
    expect(times.map((t) => t.id)).toEqual([id(2), id(9)]);
    expect(times[1]).toMatchObject({ starts_at: '2027-06-06T16:00:00.000Z', ends_at: '2027-06-06T17:00:00.000Z', sort_order: 1 });
  });

  it('an edited row is resolved in the organization zone, not the device zone', () => {
    const [rehearsal] = planTimeDraftsFrom(SAVED, ZONE);
    const times = resolved([{ ...rehearsal!, localStart: '19:00' }]);
    expect(times[0]).toMatchObject({ starts_at: '2027-06-05T00:00:00.000Z', ends_at: '2027-06-05T01:00:00.000Z' });
  });

  it('an end at or before the start runs into the next day', () => {
    const draft = { ...newPlanTimeDraft(id(3), undefined, '2027-06-04'), localStart: '22:00', localEnd: '01:00' };
    expect(planTimeEndsNextDay(draft)).toBe(true);
    expect(resolved([draft])[0]).toMatchObject({ starts_at: '2027-06-05T03:00:00.000Z', ends_at: '2027-06-05T06:00:00.000Z' });
  });

  it('reports incomplete and zero-length rows', () => {
    const base = newPlanTimeDraft(id(3), undefined, '2027-06-04');
    expect(resolvePlanTimeDrafts([{ ...base, localEnd: '10:00' }, { ...base, id: id(4), localDate: '' }], ZONE)).toEqual({
      ok: false,
      problems: [{ id: id(3), code: 'same_time' }, { id: id(4), code: 'incomplete' }],
    });
  });
});

describe('daylight saving (America/Chicago 2027)', () => {
  it('a start skipped by spring forward is reported, not shifted', () => {
    const draft = { ...newPlanTimeDraft(id(3), undefined, '2027-03-14'), localStart: '02:30', localEnd: '04:00' };
    expect(resolvePlanTimeDrafts([draft], ZONE)).toEqual({ ok: false, problems: [{ id: id(3), code: 'start_skipped' }] });
    expect(resolvePlanTimeDrafts([{ ...draft, localStart: '01:00', localEnd: '02:15' }], ZONE)).toEqual({
      ok: false,
      problems: [{ id: id(3), code: 'end_skipped' }],
    });
  });

  it('a repeated fall-back time uses the explicit choice, an hour apart', () => {
    const draft = { ...newPlanTimeDraft(id(3), undefined, '2027-11-07'), localStart: '01:30', localEnd: '03:00' };
    expect(planTimeDraftIsRepeated(draft, ZONE)).toBe(true);
    expect(resolved([draft])[0]!.starts_at).toBe('2027-11-07T06:30:00.000Z');
    expect(resolved([{ ...draft, ambiguous: 'later' }])[0]!.starts_at).toBe('2027-11-07T07:30:00.000Z');
    expect(planTimeDraftIsRepeated({ ...draft, localStart: '09:00', localEnd: '10:00' }, ZONE)).toBe(false);
  });

  it('reopening a saved later-hour time keeps "later" and sends it unchanged', () => {
    const saved = [time(5, '2027-11-07T07:30:00.000Z', '2027-11-07T09:00:00.000Z', 0)];
    const [draft] = planTimeDraftsFrom(saved, ZONE);
    expect(draft).toMatchObject({ localStart: '01:30', ambiguous: 'later' });
    expect(resolved([draft!])[0]).toMatchObject({ starts_at: saved[0]!.starts_at, ends_at: saved[0]!.ends_at });
    // Editing only the label still sends the stored instants.
    expect(resolved([{ ...draft!, name: 'Early' }])[0]).toMatchObject({ name: 'Early', starts_at: saved[0]!.starts_at });
  });

  it('both ends inside the repeated hour use the same choice', () => {
    const draft = { ...newPlanTimeDraft(id(3), undefined, '2027-11-07'), localStart: '01:15', localEnd: '01:45', ambiguous: 'later' as const };
    expect(resolved([draft])[0]).toMatchObject({ starts_at: '2027-11-07T07:15:00.000Z', ends_at: '2027-11-07T07:45:00.000Z' });
  });
});

const assignment = (n: number, overrides: Partial<PlanTimeImpactAssignment> = {}): PlanTimeImpactAssignment => ({
  assignment_id: id(100 + n),
  person_id: id(200 + n),
  team_id: null,
  position_id: null,
  status: 'unconfirmed',
  visibility: 'released',
  attendance_mode: 'selected',
  request_revision: 1,
  gains: [],
  loses: [],
  changed: [],
  after: [],
  orphaned: false,
  ...overrides,
});

const impact = (overrides: Partial<PlanTimeImpact> = {}): PlanTimeImpact => ({
  plan_id: id(50),
  content_revision: 7,
  impact_hash: 'a'.repeat(32),
  was_untimed: false,
  becomes_untimed: false,
  times: [],
  assignments: [],
  hidden_affected: 0,
  live_requests: 0,
  notify_people: 0,
  conflicts: [],
  ...overrides,
});

describe('reviewed commit', () => {
  it('saves without review only when nobody is affected', () => {
    expect(planTimeImpactNeedsReview(impact())).toBe(false);
    expect(planTimeImpactNeedsReview(impact({ hidden_affected: 1 }))).toBe(true);
    expect(planTimeImpactNeedsReview(impact({ live_requests: 1 }))).toBe(true);
    expect(planTimeImpactNeedsReview(impact({ assignments: [assignment(1)] }))).toBe(true);
  });

  it('every orphaned selected-time request must be resolved', () => {
    const reviewed = impact({ assignments: [assignment(1, { orphaned: true, loses: [id(1)] }), assignment(2, { orphaned: true }), assignment(3)] });
    expect(unresolvedOrphans(reviewed, {})).toEqual([id(101), id(102)]);
    expect(unresolvedOrphans(reviewed, { [id(101)]: 'all', [id(102)]: 'remove' })).toEqual([]);
  });

  it('carries the preview revision, hash, orphan choices and the notify choice', () => {
    const times = resolved(planTimeDraftsFrom(SAVED, ZONE));
    const reviewed = impact({ assignments: [assignment(1, { orphaned: true }), assignment(3)] });
    const body = updatePlanTimesBody(times, {
      impact: reviewed,
      // A stray choice for a request that is not orphaned is not sent.
      resolutions: { [id(101)]: 'remove', [id(103)]: 'all' },
      notify: false,
    });
    expect(body).toEqual({
      times,
      expected_revision: 7,
      time_impact_hash: 'a'.repeat(32),
      orphan_resolutions: [{ assignment_id: id(101), action: 'remove' }],
      notify_time_changes: false,
    });
    expect(updatePlanSchema.safeParse(body).success).toBe(true);
  });

  it('a preview belongs to exactly the list it previewed', () => {
    const drafts = planTimeDraftsFrom(SAVED, ZONE);
    const before = planTimesFingerprint(resolved(drafts));
    expect(planTimesFingerprint(resolved(drafts))).toBe(before);
    expect(planTimesFingerprint(resolved(movePlanTimeDraft(drafts, 0, 1)!))).not.toBe(before);
    expect(planTimesFingerprint(resolved([{ ...drafts[0]!, localEnd: '20:30' }, drafts[1]!]))).not.toBe(before);
  });
});
