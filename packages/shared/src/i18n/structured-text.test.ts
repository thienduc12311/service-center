import { describe, expect, it } from 'vitest';
import { createI18n, translateMessage } from './engine.js';
import type { SupportedLocale } from './locales.js';
import { formatCalendarDate } from './format.js';
import {
  generationProblemText,
  preferenceWarningText,
  proposalChoiceReasons,
  proposalVacancyText,
  proposalWarningText,
  staffingMatrixItemWarnings,
  templateNoticeText,
  templateTimeProblemText,
  type StructuredTextContext,
} from './structured-text.js';
import { expandPlanSeries, resolveTemplateTimes, shiftPlanToDate } from '../lib/plan-templates.js';
import { runStaffingProposal } from '../lib/staffing-proposals.js';
import {
  STAFFING_PROPOSAL_RULE_VERSION,
  type ProposalChoice,
  type StaffingProposalSnapshot,
} from '../types/staffing-proposals.js';
import type { PreferenceWarning } from '../types/availability.js';

const contextFor = (locale: SupportedLocale): StructuredTextContext => {
  const instance = createI18n({ locale });
  return { locale, translate: (message) => translateMessage(instance, message) };
};
const en = contextFor('en');
const vi = contextFor('vi');

const warning = (code: PreferenceWarning['code'], params: PreferenceWarning['params'], detail = 'English detail'): PreferenceWarning => ({
  person_id: 'p', code, detail, params, preference_team_id: null,
});

describe('preference warnings', () => {
  it('words counts, weeks and dates from params in each language', () => {
    expect(preferenceWarningText(warning('monthly_max', { served: 2, max: 3 }), en)).toBe('Already serving 2 of at most 3 this month');
    expect(preferenceWarningText(warning('monthly_max', { served: 2, max: 3 }), vi)).toBe('Đã phục vụ 2 trên tối đa 3 lần trong tháng này');
    expect(preferenceWarningText(warning('avoided_week', { week: 2 }), vi)).toBe('Đã xin không phục vụ vào tuần thứ 2 của tháng');
    expect(preferenceWarningText(warning('frequency', { frequency: 'every_other_week' }), en)).toBe('Prefers serving every other week');
    expect(preferenceWarningText(warning('availability_stale', { reviewed_on: '2027-01-31' }), en)).toBe('Availability last reviewed Jan 31, 2027');
    expect(preferenceWarningText(warning('availability_stale', { reviewed_on: '2027-01-31' }), vi)).toContain('31');
  });

  it('falls back to the English detail when a database predates params', () => {
    expect(preferenceWarningText(warning('monthly_max', {}, 'Already serving 1 of at most 1 this month'), vi)).toBe('Already serving 1 of at most 1 this month');
  });

  it('words staffing-matrix warnings and keeps legacy previews', () => {
    const item = {
      warnings: ['English 1', 'English 2', 'English 3'],
      warning_details: [
        { kind: 'preference' as const, warning: warning('avoided_date', {}) },
        { kind: 'copy_resets_answers' as const },
        { kind: 'team_unavailable' as const },
      ],
    };
    expect(staffingMatrixItemWarnings(item, vi)).toEqual([
      'Đã xin không phục vụ vào ngày này',
      'Câu trả lời và thời điểm gửi sẽ được đặt lại trên yêu cầu được sao chép.',
      'Ban đã chọn hiện không khả dụng.',
    ]);
    expect(staffingMatrixItemWarnings({ warnings: ['Legacy'] }, vi)).toEqual(['Legacy']);
  });
});

const TEAM = 'team-band';
const DRUMS = 'pos-drums';
const plan = (id: string, date: string) => ({
  id, title: `Service ${date}`, service_date: `${date}T14:00:00.000Z`, local_date: date,
  service_type_id: 'st', staffing_revision: 1, needs: [{ team_id: TEAM, position_id: DRUMS, needed: 1 }],
});
const snapshot = (overrides: Partial<StaffingProposalSnapshot> = {}): StaffingProposalSnapshot => ({
  rule_version: STAFFING_PROPOSAL_RULE_VERSION,
  organization_id: 'org',
  time_zone: 'America/Toronto',
  captured_at: '2026-10-18T00:00:00.000Z',
  lookback_days: 90,
  team_ids: [TEAM],
  plans: [plan('plan-1', '2026-11-01')],
  people: [{ id: 'p-an', full_name: 'Nguyễn An' }, { id: 'p-ben', full_name: 'Ben' }],
  memberships: ['p-an', 'p-ben'].map((person_id) => ({ person_id, team_id: TEAM, position_id: DRUMS })),
  assignments: [],
  unavailable: [],
  preferences: [],
  serving: [{ person_id: 'p-ben', plan_id: 'old', service_date: '2026-10-25T14:00:00.000Z' }],
  rotations: [],
  ...overrides,
});

describe('staffing proposals', () => {
  it('records fairness reasons as data and words them in Vietnamese', () => {
    const result = runStaffingProposal({ snapshot: snapshot(), edits: { locks: [], exclusions: [] }, seed: 's' });
    const choice = result.choices[0]!;
    expect(choice.person_id).toBe('p-an');
    expect(choice.reason_details).toEqual([
      { code: 'no_preference_warnings' },
      { code: 'served_count', count: 0, lookback_days: 90, last_served_on: null },
      { code: 'chosen_over', person_id: 'p-ben', person_name: 'Ben', decided_by: 'fewer_plans_served' },
    ]);
    expect(choice.reasons).toEqual([
      'No preference warnings.',
      '0 plans served in the last 90 days, none recently.',
      'Chosen over Ben by fewer plans served.',
    ]);
    expect(proposalChoiceReasons(choice, en)).toEqual(choice.reasons);
    expect(proposalChoiceReasons(choice, vi)).toEqual([
      'Không có cảnh báo về mong muốn.',
      'Đã phục vụ 0 chương trình trong 90 ngày qua, gần đây không có.',
      'Được chọn thay vì Ben vì phục vụ ít chương trình hơn.',
    ]);
  });

  it('words an invalid lock as a vacancy and a warning, with the authored name kept', () => {
    const result = runStaffingProposal({
      snapshot: snapshot({ unavailable: [{ person_id: 'p-an', plan_id: 'plan-1', code: 'blockout' }] }),
      edits: { locks: [{ plan_id: 'plan-1', position_id: DRUMS, person_id: 'p-an' }], exclusions: [] },
      seed: 's',
    });
    const vacancy = result.vacancies[0]!;
    expect(vacancy.params).toMatchObject({ person_name: 'Nguyễn An', exclusion: 'blockout' });
    expect(proposalVacancyText(vacancy, en)).toBe(vacancy.reason);
    expect(proposalVacancyText(vacancy, vi)).toBe('Để trống: người bạn đã khóa, Nguyễn An, bận (ngày bận). Hãy mở khóa để hệ thống tự chọn.');
    const lockWarning = result.warnings.find((item) => item.code === 'locked_choice_invalid')!;
    expect(proposalWarningText(lockWarning, en)).toBe(lockWarning.message);
    expect(proposalWarningText(lockWarning, vi)).toBe('Người bạn đã khóa, Nguyễn An, không còn phù hợp cho Service 2026-11-01: bận (ngày bận).');
  });

  it('still words kept and locked choices of proposals stored before reason details', () => {
    const stored = { reasons: ['Kept: existing confirmed request.'], source: 'existing', assignment_status: 'confirmed', assignment_visibility: 'released' } as const;
    expect(proposalChoiceReasons(stored, vi)).toEqual(['Giữ lại: yêu cầu hiện có (đã xác nhận).']);
    const fairness: Pick<ProposalChoice, 'reasons' | 'source' | 'assignment_status' | 'assignment_visibility'> = {
      reasons: ['Recorded English.'], source: 'fairness', assignment_status: null, assignment_visibility: null,
    };
    expect(proposalChoiceReasons(fairness, vi)).toEqual(['Recorded English.']);
  });
});

describe('template and reschedule problems', () => {
  it('reports a spring-forward gap as data and words it in both languages', () => {
    const result = resolveTemplateTimes(
      [{ kind: 'service', name: null, day_offset: 0, local_start: '02:30', duration_minutes: 60 }],
      '2027-03-14', 'America/Toronto', 'earlier',
    );
    if (result.ok) throw new Error('expected a DST gap');
    expect(result.problem).toEqual({ code: 'time_skipped', local_time: '02:30', local_date: '2027-03-14', time_zone: 'America/Toronto' });
    expect(templateTimeProblemText(result.problem, en)).toBe(
      '02:30 on Mar 14, 2027 does not exist in America/Toronto because the clock moves forward. Move this date or change the template time.',
    );
    expect(templateTimeProblemText(result.problem, vi)).toContain('không tồn tại theo múi giờ America/Toronto');
  });

  it('words series collisions and keeps legacy problems as written', () => {
    const expansion = expandPlanSeries({
      start_date: '2026-11-01', interval_weeks: 1, count: 2, end_date: null, excluded_dates: [],
      edits: [{ local_date: '2026-11-08', move_to: '2026-11-01' }], default_title: 'Sunday',
    });
    const collision = expansion.problems[0]!;
    expect(collision.problem).toEqual({ code: 'date_collision', series_date: '2026-11-08', other_series_date: '2026-11-01', local_date: '2026-11-01' });
    const viDate = (value: string) => formatCalendarDate(value, 'vi', 'medium');
    expect(generationProblemText(collision, vi)).toBe(`${viDate('2026-11-08')} và ${viDate('2026-11-01')} sẽ cùng rơi vào ${viDate('2026-11-01')}.`);
    expect(generationProblemText({ local_date: '2026-11-01', message: 'Legacy text' }, vi)).toBe('Legacy text');
  });

  it('reports a rescheduled time that falls in a gap', () => {
    const shifted = shiftPlanToDate(
      { service_date: '2027-03-07T07:30:00.000Z', times: [{ id: 't', starts_at: '2027-03-07T07:30:00.000Z', ends_at: '2027-03-07T08:30:00.000Z' }] },
      '2027-03-14', 'America/Toronto', 'earlier',
    );
    if (shifted.ok) throw new Error('expected a DST gap');
    expect(shifted.problem).toMatchObject({ code: 'service_time_skipped', local_date: '2027-03-14' });
  });
});

describe('template notices', () => {
  it('words counts, scopes and dates from params with plural rules', () => {
    expect(templateNoticeText({ code: 'confirmed_kept', message: 'x', params: { count: 1 } }, en)).toBe('1 confirmed answer stays confirmed for the new date.');
    expect(templateNoticeText({ code: 'confirmed_kept', message: 'x', params: { count: 3 } }, en)).toBe('3 confirmed answers stay confirmed for the new date.');
    expect(templateNoticeText({ code: 'confirmed_kept', message: 'x', params: { count: 3 } }, vi)).toBe('3 câu trả lời đã xác nhận vẫn giữ nguyên cho ngày mới.');
    expect(templateNoticeText({ code: 'item_discussion_removed', message: 'x', params: { count: 2, scope: 'destination' } }, en))
      .toBe('2 items on the destination have notes or comments that are removed with them.');
    expect(templateNoticeText({ code: 'date_taken', message: 'x', params: { service_type: 'Sunday Morning', date: '2026-11-08' } }, en))
      .toBe('Another Sunday Morning plan is already on Nov 8, 2026.');
    expect(templateNoticeText({ code: 'older_revision', message: 'x', params: { revision: 2, latest: 4 } }, vi)).toContain('2');
  });

  it('keeps notices without params, or with unknown codes, as the server wrote them', () => {
    expect(templateNoticeText({ code: 'confirmed_kept', message: '2 confirmed answer(s) stay confirmed for the new date.' }, vi))
      .toBe('2 confirmed answer(s) stay confirmed for the new date.');
    expect(templateNoticeText({ code: 'brand_new_code', message: 'Server text', params: { count: 1 } }, vi)).toBe('Server text');
    expect(templateNoticeText({ code: 'reset_silent', message: 'x' }, vi)).not.toBe('x');
  });
});
