import {
  saveSchedulingPreferenceSchema,
  type SaveSchedulingPreferenceRequest,
  type SchedulingFrequency,
  type SchedulingPreferenceRow,
} from '@service-center/shared';

/** Empty string is the explicit "All my teams" scope (team_id null). */
export const ALL_TEAMS = '';
export const WEEKS_OF_MONTH = [1, 2, 3, 4, 5] as const;
export const FREQUENCIES: readonly SchedulingFrequency[] = [
  'every_week', 'every_other_week', 'every_third_week', 'once_a_month',
];

/** Editable form state for one Person/team preference scope. */
export interface PreferenceDraft {
  /** Empty means "No preference". */
  frequency: SchedulingFrequency | '';
  /** Free text so a half-typed value survives; empty means "No limit". */
  maxPerMonth: string;
  preferredWeeks: number[];
  avoidedWeeks: number[];
  /** Comma-separated HH:MM local start times. */
  preferredTimes: string;
}

export type WeekList = 'preferredWeeks' | 'avoidedWeeks';

export type DraftResult =
  | { ok: true; request: SaveSchedulingPreferenceRequest }
  | { ok: false; field: 'maxPerMonth' | 'preferredTimes' };

export const draftFromRow = (row: SchedulingPreferenceRow | undefined): PreferenceDraft => ({
  frequency: row?.frequency ?? '',
  maxPerMonth: row?.max_per_month ? String(row.max_per_month) : '',
  preferredWeeks: [...(row?.preferred_weeks ?? [])],
  avoidedWeeks: [...(row?.avoided_weeks ?? [])],
  preferredTimes: (row?.preferred_times ?? []).map((time) => time.slice(0, 5)).join(', '),
});

/** A week is preferred, avoided or neither — toggling one side clears the other. */
export const toggleWeek = (draft: PreferenceDraft, list: WeekList, week: number): PreferenceDraft => {
  const other: WeekList = list === 'preferredWeeks' ? 'avoidedWeeks' : 'preferredWeeks';
  const has = draft[list].includes(week);
  return {
    ...draft,
    [list]: has ? draft[list].filter((w) => w !== week) : [...draft[list], week].sort((a, b) => a - b),
    [other]: draft[other].filter((w) => w !== week),
  };
};

const splitList = (value: string): string[] => value.split(',').map((item) => item.trim()).filter(Boolean);

/**
 * Builds the save request. Only fields this screen edits are sent from the
 * draft; dates set on the website are carried over from `current` so a
 * native save never wipes them.
 */
export const requestFromDraft = (
  draft: PreferenceDraft,
  teamId: string,
  current: SchedulingPreferenceRow | undefined,
): DraftResult => {
  const max = draft.maxPerMonth.trim();
  const maxPerMonth = max ? Number(max) : null;
  const request: SaveSchedulingPreferenceRequest = {
    team_id: teamId || null,
    frequency: draft.frequency || null,
    max_per_month: maxPerMonth,
    preferred_weeks: draft.preferredWeeks,
    avoided_weeks: draft.avoidedWeeks,
    preferred_times: splitList(draft.preferredTimes),
    preferred_dates: current?.preferred_dates ?? [],
    avoided_dates: current?.avoided_dates ?? [],
    ...(current ? { expected_revision: current.revision } : {}),
  };
  const parsed = saveSchedulingPreferenceSchema.safeParse(request);
  if (parsed.success) return { ok: true, request };
  const path = parsed.error.issues[0]?.path[0];
  return { ok: false, field: path === 'preferred_times' ? 'preferredTimes' : 'maxPerMonth' };
};
