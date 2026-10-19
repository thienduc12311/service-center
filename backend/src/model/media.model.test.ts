import { describe, expect, it } from 'vitest';
import type { AssignmentDetail, MediaRow } from '@service-center/shared';
import { isMediaArchived, organizationToday, toMediaSummary, toMediaUsage, toRehearsalMediaRef } from './media.model.js';
import { stageRosterFromPlan } from './stage-layout.model.js';

const row: MediaRow = {
  id: 'm', organization_id: 'o', title: 'Countdown', creator: 'Studio', duration_seconds: 300,
  themes: ['Advent'], tags: ['video'], notes: null, thumbnail_file_id: null, archive_on: null, archived_at: null,
  archived_by: null, revision: 3, created_by: null, created_at: '', updated_by: null, updated_at: '',
};

describe('media archive rule', () => {
  it('archives now or from the archive date in the organization timezone', () => {
    expect(isMediaArchived(row, '2026-10-18')).toBe(false);
    expect(isMediaArchived({ ...row, archive_on: '2026-10-18' }, '2026-10-18')).toBe(true);
    expect(isMediaArchived({ ...row, archive_on: '2026-10-19' }, '2026-10-18')).toBe(false);
    expect(isMediaArchived({ ...row, archived_at: '2026-01-01T00:00:00Z' }, '2026-10-18')).toBe(true);
    // 02:00 UTC on the 19th is still the 18th in Toronto.
    expect(organizationToday('America/Toronto', new Date('2026-10-19T02:00:00Z'))).toBe('2026-10-18');
    expect(organizationToday('Not/AZone', new Date('2026-10-19T02:00:00Z'))).toBe('2026-10-19');
    expect(toRehearsalMediaRef({ ...row, archive_on: '2026-10-01' }, '2026-10-18').archived).toBe(true);
  });

  it('summarises usage newest first', () => {
    const usage = toMediaUsage([
      { id: 'i1', media_id: 'm', title: 'Countdown', plan: { id: 'p1', title: 'Week 1', service_date: '2026-10-04' } },
      { id: 'i2', media_id: 'm', title: 'Countdown', plan: { id: 'p2', title: 'Week 2', service_date: '2026-10-11' } },
      { id: 'i3', media_id: 'm', title: 'Hidden', plan: null },
    ]);
    expect(usage.map((u) => u.plan_id)).toEqual(['p2', 'p1']);
    expect(toMediaSummary(row, '2026-10-18', usage)).toMatchObject({ usage_count: 2, last_used_on: '2026-10-11', is_archived: false });
  });
});

describe('stageRosterFromPlan', () => {
  it('lists each staffed Person once, skips declines and marks prepared requests', () => {
    const assignments = [
      { person_id: 'sam', status: 'confirmed', visibility: 'released', person: { full_name: 'Sam' }, team: { name: 'Band' }, position: { name: 'Bass' } },
      { person_id: 'sam', status: 'unconfirmed', visibility: 'released', person: { full_name: 'Sam' }, team: { name: 'Band' }, position: { name: 'Vocals' } },
      { person_id: 'alex', status: 'unconfirmed', visibility: 'prepared', person: { full_name: 'Alex' }, team: { name: 'Band' }, position: null },
      { person_id: 'riley', status: 'declined', visibility: 'released', person: { full_name: 'Riley' }, team: null, position: null },
    ] as unknown as AssignmentDetail[];
    expect(stageRosterFromPlan(assignments)).toEqual([
      { person_id: 'alex', name: 'Alex', roles: ['Band'], prepared: true, archived: false },
      { person_id: 'sam', name: 'Sam', roles: ['Band: Bass', 'Band: Vocals'], prepared: false, archived: false },
    ]);
  });
});
