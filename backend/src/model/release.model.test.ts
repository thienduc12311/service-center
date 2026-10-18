import { describe, expect, it } from 'vitest';
import { planReleaseBatchKey, planReleaseItems } from './release.model.js';

const onPlan = [
  { assignment_id: 'a', request_revision: 2 },
  { assignment_id: 'b', request_revision: 0 },
];

describe('planReleaseItems', () => {
  it('pins current revisions when the client sent none', () => {
    expect(planReleaseItems(['a', 'b'], [], onPlan)).toEqual(onPlan);
  });

  it('keeps the reviewed revisions as sent', () => {
    const reviewed = [{ assignment_id: 'a', request_revision: 1 }];
    expect(planReleaseItems(['a'], reviewed, onPlan)).toEqual(reviewed);
  });

  it('refuses a request that is not on the plan', () => {
    expect(planReleaseItems(['a', 'z'], [], onPlan)).toBeNull();
  });

  it('refuses revisions for a different set or duplicates', () => {
    expect(planReleaseItems(['a'], [{ assignment_id: 'b', request_revision: 0 }], onPlan)).toBeNull();
    expect(planReleaseItems(['a', 'b'], [{ assignment_id: 'a', request_revision: 2 }], onPlan)).toBeNull();
    expect(planReleaseItems(['a', 'a'], [], onPlan)).toBeNull();
  });
});

describe('planReleaseBatchKey', () => {
  it('is stable, plan-scoped and within the batch key limit', () => {
    const key = planReleaseBatchKey('plan-1', 'x'.repeat(200));
    expect(key).toBe(planReleaseBatchKey('plan-1', 'x'.repeat(200)));
    expect(key).not.toBe(planReleaseBatchKey('plan-2', 'x'.repeat(200)));
    expect(key.length).toBeLessThanOrEqual(200);
  });
});
