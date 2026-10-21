import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  movePlanTimeDraft,
  planTimeDraftsFrom,
  resolvePlanTimeDrafts,
  type PlanTimeImpact,
  type PlanTimeRequest,
} from '@service-center/shared';
import {
  conflictsFrom,
  policyWriteOutcome,
  reviewStillApplies,
  timesReview,
  timesWriteOutcome,
} from './plan-times-edit';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ZONE = 'America/Chicago';

const SAVED = [
  { id: id(1), kind: 'rehearsal' as const, name: null, starts_at: '2027-06-04T23:00:00.000Z', ends_at: '2027-06-05T01:00:00.000Z', sort_order: 0 },
  { id: id(2), kind: 'service' as const, name: 'Main', starts_at: '2027-06-06T14:00:00.000Z', ends_at: '2027-06-06T15:30:00.000Z', sort_order: 1 },
];

const listOf = (drafts: ReturnType<typeof planTimeDraftsFrom>): PlanTimeRequest[] => {
  const result = resolvePlanTimeDrafts(drafts, ZONE);
  if (!result.ok) throw new Error('invalid');
  return result.times;
};

const impact = (revision: number): PlanTimeImpact => ({
  plan_id: id(50),
  content_revision: revision,
  impact_hash: 'b'.repeat(32),
  was_untimed: false,
  becomes_untimed: false,
  times: [],
  assignments: [],
  hidden_affected: 0,
  live_requests: 1,
  notify_people: 1,
  conflicts: [],
});

describe('timesWriteOutcome', () => {
  it('maps the F04 refusals to what the editor shows', () => {
    expect(timesWriteOutcome(new ApiError(409, 'x', 'time_impact_stale'))).toBe('impact_stale');
    expect(timesWriteOutcome(new ApiError(409, 'x', 'time_impact_required'))).toBe('impact_stale');
    expect(timesWriteOutcome(new ApiError(409, 'x', 'plan_revision_stale'))).toBe('plan_stale');
    expect(timesWriteOutcome(new ApiError(409, 'x', 'scheduling_conflict', []))).toBe('conflict');
    expect(timesWriteOutcome(new ApiError(409, 'x', 'orphan_resolution_required'))).toBe('orphans_required');
    expect(timesWriteOutcome(new ApiError(404, 'x'))).toBe('gone');
    expect(timesWriteOutcome(new ApiError(422, 'x', 'validation_error'))).toBe('refused');
    expect(timesWriteOutcome(new TypeError('Network request failed'))).toBe('uncertain');
  });

  it('reads typed conflicts only from a scheduling_conflict', () => {
    const conflict = { person_id: id(7) };
    expect(conflictsFrom(new ApiError(409, 'x', 'scheduling_conflict', [conflict]))).toEqual([conflict]);
    expect(conflictsFrom(new ApiError(409, 'x', 'plan_revision_stale', [conflict]))).toEqual([]);
    expect(conflictsFrom(new Error('x'))).toEqual([]);
  });
});

describe('a review belongs to what it previewed', () => {
  const drafts = planTimeDraftsFrom(SAVED, ZONE);
  const review = timesReview(impact(4), listOf(drafts));

  it('applies to the same list at the same revision', () => {
    expect(reviewStillApplies(review, listOf(drafts), 4)).toBe(true);
  });

  it('a changed preview list (reorder, moved time, delete) needs a new preview', () => {
    expect(reviewStillApplies(review, listOf(movePlanTimeDraft(drafts, 0, 1)!), 4)).toBe(false);
    expect(reviewStillApplies(review, listOf([{ ...drafts[0]!, localStart: '17:30' }, drafts[1]!]), 4)).toBe(false);
    expect(reviewStillApplies(review, listOf([drafts[1]!]), 4)).toBe(false);
    expect(reviewStillApplies(review, null, 4)).toBe(false);
  });

  it('a plan that changed after the preview needs a new preview', () => {
    expect(reviewStillApplies(review, listOf(drafts), 5)).toBe(false);
  });
});

describe('policyWriteOutcome', () => {
  it('a competing save or reset shows the latest setting', () => {
    expect(policyWriteOutcome(new ApiError(409, 'x', 'reminder_policy_stale'))).toBe('stale');
    expect(policyWriteOutcome(new ApiError(404, 'x'))).toBe('stale');
    expect(policyWriteOutcome(new ApiError(403, 'x'))).toBe('refused');
    expect(policyWriteOutcome(new TypeError('offline'))).toBe('uncertain');
  });
});

// F08 reminders are durable server jobs. The app must never add a second
// sender by scheduling local notifications on a phone timer.
describe('no phone-timer reminders', () => {
  const root = join(__dirname, '..', '..');
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
      return /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
    });

  it('no native source schedules a local notification', () => {
    const offenders = [...sources(join(root, 'app')), ...sources(join(root, 'src'))].filter((path) =>
      /scheduleNotificationAsync|presentNotificationAsync|BackgroundFetch|TaskManager\.defineTask/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
