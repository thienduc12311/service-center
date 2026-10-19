import { describe, expect, it } from 'vitest';
import type { EffectiveAccess } from '@service-center/shared';
import { canRunReport, planInScope, scopeNote, teamInScope, toReportSongItem } from './report.model.js';
import { layerIcsEvent, scopedPlanTimeUid, toCalendarLayerEvent } from './calendar-feed.model.js';
import { canMarkTeam, defaultAttendanceTime, seesWholePlan } from './attendance-record.model.js';

const access = (entries: EffectiveAccess['entries']): EffectiveAccess => ({
  organization_id: 'org',
  user_id: 'u',
  role: 'member',
  access_mode: 'scoped',
  can_administer_access: false,
  entries,
});

const bandLeader = access([{ capability: 'scheduling.manage', scope_type: 'team', scope_id: 'band', source: 'grant', grant_id: 'g' }]);
const sundayEditor = access([{ capability: 'plans.edit', scope_type: 'service_type', scope_id: 'sunday', source: 'grant', grant_id: 'g' }]);

describe('report scope', () => {
  it('lets a team scheduler run staffing on their team only', () => {
    expect(canRunReport(bandLeader, 'staffing')).toBe(true);
    expect(canRunReport(bandLeader, 'song_usage')).toBe(false);
    expect(canRunReport(bandLeader, 'run_times')).toBe(false);
    expect(teamInScope(bandLeader, 'sunday', 'band')).toBe(true);
    expect(teamInScope(bandLeader, 'sunday', 'hosts')).toBe(false);
    expect(scopeNote(bandLeader, 'staffing')).toMatch(/Only the teams/);
  });

  it('limits song usage and run times to service types the reader edits', () => {
    expect(planInScope(sundayEditor, 'song_usage', 'sunday')).toBe(true);
    expect(planInScope(sundayEditor, 'song_usage', 'youth')).toBe(false);
    expect(planInScope(sundayEditor, 'run_times', null)).toBe(false);
    expect(canRunReport(sundayEditor, 'participation')).toBe(false);
  });

  it('resolves a song item\'s effective key', () => {
    const base = { id: 'i', plan_id: 'p', song_id: 's', song: { title: 'T', author: null, default_key: 'C' } };
    expect(toReportSongItem({ ...base, key_override: 'D', arrangement: { song_key: 'E' } })?.key).toBe('D');
    expect(toReportSongItem({ ...base, key_override: null, arrangement: { song_key: 'E' } })?.key).toBe('E');
    expect(toReportSongItem({ ...base, key_override: null, arrangement: null })?.key).toBe('C');
    expect(toReportSongItem({ ...base, song_id: null, key_override: null, arrangement: null })).toBeNull();
  });
});

describe('attendance model', () => {
  it('opens the first unfinished time and separates team marking from whole-plan viewing', () => {
    const times = [
      { id: 'a', kind: 'rehearsal' as const, name: null, starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-01-01T01:00:00Z' },
      { id: 'b', kind: 'service' as const, name: null, starts_at: '2026-01-03T00:00:00Z', ends_at: '2026-01-03T01:00:00Z' },
    ];
    expect(defaultAttendanceTime(times, Date.parse('2026-01-02T00:00:00Z'))?.id).toBe('b');
    expect(defaultAttendanceTime(times, Date.parse('2026-02-01T00:00:00Z'))?.id).toBe('b');
    expect(canMarkTeam(bandLeader, 'sunday', 'band')).toBe(true);
    expect(seesWholePlan(bandLeader, 'sunday')).toBe(false);
    expect(seesWholePlan(sundayEditor, 'sunday')).toBe(true);
  });
});

describe('calendar layers', () => {
  it('gives stable ids and never a reason or a birth year', () => {
    const birthday = toCalendarLayerEvent({
      layer: 'birthdays', source_id: null, person_id: 'p1', person_name: 'Ana', on_date: '2027-02-28', starts_at: null, ends_at: null, all_day: true,
    })!;
    expect(birthday.id).toBe('birthdays-p1-2027-02-28');
    const ics = layerIcsEvent(birthday, 'api.test');
    expect(ics).toMatchObject({ uid: 'birthdays-p1-2027-02-28@api.test', summary: 'Birthday: Ana', allDayDate: '2027-02-28', transparent: true });
    const blockout = toCalendarLayerEvent({
      layer: 'blockouts', source_id: 'b1', person_id: 'p1', person_name: 'Ana', on_date: null,
      starts_at: '2027-02-10T00:00:00Z', ends_at: '2027-02-12T00:00:00Z', all_day: false,
    })!;
    expect(layerIcsEvent(blockout, 'api.test').summary).toBe('Unavailable: Ana');
    expect(toCalendarLayerEvent({ layer: 'secret', source_id: null, person_id: 'p', person_name: 'x', on_date: null, starts_at: null, ends_at: null, all_day: false })).toBeNull();
  });

  it('keeps plan-time UIDs stable per scope across token rotation', () => {
    expect(scopedPlanTimeUid({ scope_type: 'team', team_id: 'band', service_type_id: null }, 't1', 'h')).toBe('plan-time-t1-team-band@h');
    expect(scopedPlanTimeUid({ scope_type: 'service_type', team_id: null, service_type_id: 'st' }, 't1', 'h')).toBe('plan-time-t1-st-st@h');
  });
});
