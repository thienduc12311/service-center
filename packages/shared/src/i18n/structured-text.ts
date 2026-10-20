/**
 * Words server-computed notices and warnings in the viewer's language from
 * their stable `code` and structured `params`. The English `detail`/`message`
 * /`reason` fields are only a fallback: for codes this build does not know,
 * and for records stored before the structured fields existed.
 *
 * Renderers take a `translate` function rather than an i18next instance, so
 * the web adapter, the mobile adapter and tests (with `translatorFor`) share
 * them. Names, titles and rotation names are authored content and are passed
 * through as written.
 */

import type { PreferenceWarning } from '../types/availability.js';
import type { StaffingMatrixWarning } from '../types/staffing-matrix.js';
import type { ProposalChoice, ProposalExclusionCode, ProposalReasonDetail, ProposalVacancy, ProposalWarning } from '../types/staffing-proposals.js';
import type { TemplatePreviewNotice, TemplateTimeProblem } from '../types/plan-templates.js';
import { formatCalendarDate, formatList } from './format.js';
import type { SupportedLocale } from './locales.js';
import type { QualifiedTranslationKey, TranslatableMessage, TranslationValues } from './types.js';

/** What a renderer needs from its runtime. */
export interface StructuredTextContext {
  translate: (message: TranslatableMessage) => string;
  locale: SupportedLocale;
}

const say = (context: StructuredTextContext, key: QualifiedTranslationKey, values?: TranslationValues): string =>
  context.translate(values ? { key, values } : { key });

const date = (context: StructuredTextContext, value: string): string => formatCalendarDate(value, context.locale, 'medium');

// ------------------------------------------------------ preference warnings --

/** One preference/freshness warning, e.g. "Already serving 2 of at most 3 this month". */
export const preferenceWarningText = (warning: PreferenceWarning, context: StructuredTextContext): string => {
  const params = warning.params ?? {};
  switch (warning.code) {
    case 'frequency':
      return params.frequency ? say(context, `staffing:structured.preference.frequency.${params.frequency}`) : warning.detail;
    case 'monthly_max':
      return params.served !== undefined && params.max !== undefined
        ? say(context, 'staffing:structured.preference.monthly_max', { served: params.served, max: params.max })
        : warning.detail;
    case 'avoided_week':
      return params.week !== undefined ? say(context, 'staffing:structured.preference.avoided_week', { week: params.week }) : warning.detail;
    case 'availability_stale':
      return params.reviewed_on
        ? say(context, 'staffing:structured.preference.availability_stale', { date: date(context, params.reviewed_on) })
        : warning.detail;
    case 'avoided_date':
    case 'outside_preferred_weeks':
    case 'outside_preferred_dates':
    case 'time_not_preferred':
    case 'availability_unknown':
    case 'busy_elsewhere':
      return say(context, `staffing:structured.preference.${warning.code}`);
    default:
      return warning.detail;
  }
};

// ------------------------------------------------------------ staffing matrix --

export const staffingMatrixWarningText = (warning: StaffingMatrixWarning, context: StructuredTextContext): string => {
  switch (warning.kind) {
    case 'preference':
      return preferenceWarningText(warning.warning, context);
    case 'copy_resets_answers':
      return say(context, 'staffing:structured.matrix.copy_resets_answers');
    case 'team_unavailable':
      return say(context, 'staffing:structured.matrix.team_unavailable');
  }
};

/** A preview item's warnings: structured when present, else the stored English. */
export const staffingMatrixItemWarnings = (
  item: { warnings: readonly string[]; warning_details?: readonly StaffingMatrixWarning[] },
  context: StructuredTextContext,
): string[] =>
  item.warning_details ? item.warning_details.map((warning) => staffingMatrixWarningText(warning, context)) : [...item.warnings];

// ---------------------------------------------------------------- proposals --

const exclusion = (code: ProposalExclusionCode, context: StructuredTextContext): string =>
  say(context, `staffing:structured.exclusion.${code}`);

export const proposalReasonText = (detail: ProposalReasonDetail, context: StructuredTextContext): string => {
  switch (detail.code) {
    case 'kept_existing':
      return say(context, 'staffing:structured.reason.kept_existing', {
        state: detail.state === 'prepared'
          ? say(context, 'staffing:structured.prepared')
          : say(context, `common:assignmentStatus.${detail.state}`).toLocaleLowerCase(context.locale),
      });
    case 'locked':
      return say(context, 'staffing:structured.reason.locked');
    case 'rotation_week':
      return say(context, 'staffing:structured.reason.rotation_week', { rotation: detail.rotation_name, week: detail.week, cycle: detail.cycle_weeks });
    case 'rotation_exception':
      return say(context, 'staffing:structured.reason.rotation_exception', { rotation: detail.rotation_name, date: date(context, detail.date) });
    case 'all_have_preference_warnings':
    case 'no_preference_warnings':
      return say(context, `staffing:structured.reason.${detail.code}`);
    case 'served_count':
      return detail.last_served_on
        ? say(context, 'staffing:structured.reason.served_count', { count: detail.count, days: detail.lookback_days, date: date(context, detail.last_served_on) })
        : say(context, 'staffing:structured.reason.served_count_none', { count: detail.count, days: detail.lookback_days });
    case 'chosen_over':
      return say(context, 'staffing:structured.reason.chosen_over', {
        name: detail.person_name,
        reason: say(context, `staffing:structured.tieBreak.${detail.decided_by}`),
      });
  }
};

/**
 * A choice's explanation lines. Proposals stored before `reason_details`
 * existed still word kept and locked choices from the choice itself; their
 * rotation and fairness lines stay in the recorded English.
 */
export const proposalChoiceReasons = (
  choice: Pick<ProposalChoice, 'reasons' | 'reason_details' | 'source' | 'assignment_status' | 'assignment_visibility'>,
  context: StructuredTextContext,
): string[] => {
  if (choice.reason_details) return choice.reason_details.map((detail) => proposalReasonText(detail, context));
  if (choice.source === 'locked') return [proposalReasonText({ code: 'locked' }, context)];
  if (choice.source === 'existing') {
    const state = choice.assignment_visibility === 'prepared' ? 'prepared' : choice.assignment_status;
    if (state) return [proposalReasonText({ code: 'kept_existing', state }, context)];
  }
  return [...choice.reasons];
};

export const proposalVacancyText = (vacancy: ProposalVacancy, context: StructuredTextContext): string => {
  const params = vacancy.params;
  switch (vacancy.code) {
    case 'no_position_members':
    case 'all_candidates_excluded':
      return say(context, `staffing:structured.vacancy.${vacancy.code}`);
    case 'locked_choice_invalid':
      return params?.person_name && params.exclusion
        ? say(context, 'staffing:structured.vacancy.locked_choice_invalid', { name: params.person_name, reason: exclusion(params.exclusion, context) })
        : vacancy.reason;
    case 'rotation_member_unavailable':
    case 'rotation_member_missing':
      return params?.person_name && params.exclusion && params.rotation_name
        ? say(context, 'staffing:structured.vacancy.rotation_member', {
            rotation: params.rotation_name,
            name: params.person_name,
            reason: exclusion(params.exclusion, context),
          })
        : vacancy.reason;
    default:
      return vacancy.reason;
  }
};

/** Preference codes inside a proposal warning, worded like the scheduling dialog's labels. */
const preferenceLabels = (codes: readonly string[], context: StructuredTextContext): string =>
  formatList(codes.map((code) => (PREFERENCE_LABEL_CODES.has(code) ? say(context, `staffing:preferenceWarning.${code as PreferenceLabelCode}`) : code)), context.locale);

type PreferenceLabelCode = PreferenceWarning['code'];
const PREFERENCE_LABEL_CODES: ReadonlySet<string> = new Set<PreferenceLabelCode>([
  'frequency', 'monthly_max', 'avoided_date', 'avoided_week', 'outside_preferred_weeks',
  'outside_preferred_dates', 'time_not_preferred', 'availability_unknown', 'availability_stale', 'busy_elsewhere',
]);

export const proposalWarningText = (warning: ProposalWarning, context: StructuredTextContext): string => {
  const params = warning.params;
  if (!params) return warning.message;
  switch (warning.code) {
    case 'preference':
      return params.person_name && params.plan_title && params.preference_codes
        ? say(context, 'staffing:structured.warning.preference', {
            name: params.person_name,
            plan: params.plan_title,
            warnings: preferenceLabels(params.preference_codes, context),
          })
        : warning.message;
    case 'locked_choice_invalid':
      return params.person_name && params.plan_title && params.exclusion
        ? say(context, 'staffing:structured.warning.locked_choice_invalid', {
            name: params.person_name,
            plan: params.plan_title,
            reason: exclusion(params.exclusion, context),
          })
        : warning.message;
    case 'rotation_member_unavailable':
    case 'rotation_member_missing':
      return params.person_name && params.rotation_name && params.date && params.exclusion
        ? say(context, 'staffing:structured.warning.rotation_member', {
            rotation: params.rotation_name,
            name: params.person_name,
            date: date(context, params.date),
            reason: exclusion(params.exclusion, context),
          })
        : warning.message;
    case 'rotation_exception':
      return params.rotation_name && params.date
        ? say(context, params.skipped ? 'staffing:structured.warning.rotation_skipped' : 'staffing:structured.warning.rotation_exception', {
            rotation: params.rotation_name,
            date: date(context, params.date),
          })
        : warning.message;
    default:
      return warning.message;
  }
};

// ---------------------------------------------------------------- templates --

export const templateTimeProblemText = (problem: TemplateTimeProblem, context: StructuredTextContext): string => {
  switch (problem.code) {
    case 'time_skipped':
      return say(context, 'templates:problems.time_skipped', { time: problem.local_time, date: date(context, problem.local_date), timeZone: problem.time_zone });
    case 'noon_skipped':
      return say(context, 'templates:problems.noon_skipped', { date: date(context, problem.local_date), timeZone: problem.time_zone });
    case 'date_collision':
      return say(context, 'templates:problems.date_collision', {
        seriesDate: date(context, problem.series_date),
        otherDate: date(context, problem.other_series_date),
        date: date(context, problem.local_date),
      });
    case 'edit_not_in_series':
      return say(context, 'templates:problems.edit_not_in_series', { date: date(context, problem.local_date) });
    case 'no_dates':
      return say(context, 'templates:problems.no_dates');
    case 'service_time_skipped':
      return say(context, 'templates:problems.service_time_skipped', { date: date(context, problem.local_date), timeZone: problem.time_zone });
    case 'moved_time_skipped':
      return say(context, 'templates:problems.moved_time_skipped', { time: problem.local_time, date: date(context, problem.local_date), timeZone: problem.time_zone });
  }
};

/** A date problem from a generation preview; older previews keep their English text. */
export const generationProblemText = (problem: { message: string; problem?: TemplateTimeProblem }, context: StructuredTextContext): string =>
  problem.problem ? templateTimeProblemText(problem.problem, context) : problem.message;

const PLAIN_NOTICES = ['other_service_type', 'times_in_use', 'notes_too_long', 'roster_appended', 'reset_silent'] as const;
type PlainNoticeCode = (typeof PLAIN_NOTICES)[number];
const isPlainNotice = (code: string): code is PlainNoticeCode => (PLAIN_NOTICES as readonly string[]).includes(code);

/** A template-apply or reschedule notice; unknown codes and pre-structure notices keep their English text. */
export const templateNoticeText = (notice: TemplatePreviewNotice, context: StructuredTextContext): string => {
  if (isPlainNotice(notice.code)) return say(context, `templates:notices.${notice.code}`);
  const params = notice.params;
  if (!params) return notice.message;
  const count = params.count;
  switch (notice.code) {
    case 'older_revision':
      return params.revision !== undefined && params.latest !== undefined
        ? say(context, 'templates:notices.older_revision', { revision: params.revision, latest: params.latest })
        : notice.message;
    case 'date_taken':
      if (!params.date) return notice.message;
      return params.service_type
        ? say(context, 'templates:notices.date_taken', { serviceType: params.service_type, date: date(context, params.date) })
        : say(context, 'templates:notices.date_taken_noType', { date: date(context, params.date) });
    case 'confirmed_kept':
    case 'conflicts':
    case 'arrangement_missing':
    case 'times_added':
    case 'already_applied':
      return count !== undefined ? say(context, `templates:notices.${notice.code}`, { count }) : notice.message;
    case 'item_discussion_removed':
      return count !== undefined && params.scope
        ? say(context, `templates:notices.itemDiscussionRemoved.${params.scope}`, { count })
        : notice.message;
    default:
      return notice.message;
  }
};
