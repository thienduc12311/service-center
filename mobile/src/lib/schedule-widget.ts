import type { SchedulePlanGroup } from './schedule-groups';

/**
 * MOB-033: the iOS home/lock screen widget's data. The widget extension can't
 * sign in or fetch, so the app writes a small, already-worded, expiring
 * timeline from authorized reads (`mySchedule` through the My Schedule
 * grouping, `rehearsalManifest` for the next plan) and replaces it on every
 * refresh, account or organization change, and with a signed-out state on
 * sign-out. Taps open `servicecenter://open/plan/<id>?organization_id=…`,
 * the existing validated ingress, which re-checks membership and the plan
 * under that organization before showing anything.
 */

/** The `name` in the expo-widgets config plugin and `createWidget`. */
export const SCHEDULE_WIDGET_NAME = 'ServiceCenterSchedule';

/** How long a snapshot is trusted before the widget asks to open the app (OS refresh is not guaranteed). */
export const SCHEDULE_WIDGET_TTL_MS = 12 * 60 * 60 * 1000;

/** Medium widget room; the small and lock-screen families show the first. */
export const SCHEDULE_WIDGET_MAX_ENTRIES = 3;

/** An untimed plan is treated as a two-hour window (F04 `untimed`, as My Schedule does). */
const UNTIMED_LENGTH_MS = 2 * 60 * 60 * 1000;

const APP_SCHEME = 'servicecenter';

export type ScheduleWidgetState = 'ready' | 'empty' | 'signedOut' | 'expired';

export interface ScheduleWidgetEntry {
  key: string;
  title: string;
  when: string;
  /** Team · position of my requests on this plan. */
  detail: string;
  /** "Awaiting your answer" while any request on the plan is unanswered; '' otherwise. */
  status: string;
  url: string;
  /** Only when the plan has something playable to rehearse; '' otherwise. */
  rehearseUrl: string;
}

/**
 * JSON-only props: stored in the app group's `UserDefaults` and handed to the
 * widget runtime, so no `null` anywhere (a property list can't hold one) —
 * "none" is an empty string.
 */
export interface ScheduleWidgetProps {
  state: ScheduleWidgetState;
  heading: string;
  organizationName: string;
  /** Shown for every state but `ready`. */
  message: string;
  entries: ScheduleWidgetEntry[];
  rehearseLabel: string;
  /** Tap target when there is no entry (opens the app; it decides where). */
  appUrl: string;
  updatedLabel: string;
}

export interface ScheduleWidgetTimelineEntry {
  date: Date;
  props: ScheduleWidgetProps;
}

/** Already-translated words, from the app's current language. */
export interface ScheduleWidgetText {
  heading: string;
  empty: string;
  signedOut: string;
  expired: string;
  awaiting: string;
  rehearse: string;
  updated: string;
}

export interface ScheduleWidgetInput {
  now: Date;
  organization: { id: string; name: string };
  groups: readonly SchedulePlanGroup[];
  /** Playable track counts for plans whose manifest was read; others offer no rehearse link. */
  rehearsalTracks: Readonly<Record<string, number>>;
  text: ScheduleWidgetText;
  formatWhen: (startsAt: string) => string;
}

export const appUrl = (): string => `${APP_SCHEME}://`;

/** The existing private ingress (parsed and re-authorized by `parseExternalNavigationUrl`). */
export const planWidgetUrl = (organizationId: string, planId: string, view: 'plan' | 'rehearse' = 'plan'): string =>
  `${APP_SCHEME}://open/plan/${encodeURIComponent(planId)}${view === 'rehearse' ? '/rehearse' : ''}?organization_id=${encodeURIComponent(organizationId)}`;

/** When the plan's last time I'm needed for ends. */
export const groupEndsAt = (group: SchedulePlanGroup): number => {
  const ends = group.times.map((time) => Date.parse(time.endsAt)).filter(Number.isFinite);
  return ends.length ? Math.max(...ends) : Date.parse(group.startsAt) + UNTIMED_LENGTH_MS;
};

/** Plans I still serve at: declined and withdrawn-only plans are left out. */
const serving = (group: SchedulePlanGroup): boolean => group.responsibilities.some((r) => r.status === 'confirmed' || r.status === 'unconfirmed');

const entryFor = (input: ScheduleWidgetInput, group: SchedulePlanGroup): ScheduleWidgetEntry => {
  const tracks = input.rehearsalTracks[group.plan.id] ?? 0;
  const detail = group.responsibilities
    .filter((r) => r.status === 'confirmed' || r.status === 'unconfirmed')
    .map((r) => [r.team?.name, r.position?.name].filter(Boolean).join(' · '))
    .filter(Boolean);
  return {
    key: group.key,
    title: group.plan.title,
    when: input.formatWhen(group.startsAt),
    detail: [...new Set(detail)].slice(0, 2).join(', '),
    status: group.pendingCount > 0 ? input.text.awaiting : '',
    url: planWidgetUrl(input.organization.id, group.plan.id),
    rehearseUrl: tracks > 0 ? planWidgetUrl(input.organization.id, group.plan.id, 'rehearse') : '',
  };
};

const baseProps = (input: Pick<ScheduleWidgetInput, 'text'>, organizationName: string): Omit<ScheduleWidgetProps, 'state' | 'message' | 'entries'> => ({
  heading: input.text.heading,
  organizationName,
  rehearseLabel: '',
  appUrl: appUrl(),
  updatedLabel: '',
});

/** The state written on sign-out (and before the next account's data loads): nothing personal. */
export const signedOutWidgetProps = (text: ScheduleWidgetText): ScheduleWidgetProps => ({
  ...baseProps({ text }, ''),
  state: 'signedOut',
  message: text.signedOut,
  entries: [],
});

/**
 * Entries now, a new entry each time a service ends (it drops off), and a
 * final `expired` entry after the TTL so a stale snapshot never looks current.
 */
export const buildScheduleWidgetTimeline = (input: ScheduleWidgetInput): ScheduleWidgetTimelineEntry[] => {
  const now = input.now.getTime();
  const expiresAt = now + SCHEDULE_WIDGET_TTL_MS;
  const upcoming = [...input.groups]
    .filter(serving)
    .filter((group) => groupEndsAt(group) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const common = {
    ...baseProps(input, input.organization.name),
    rehearseLabel: input.text.rehearse,
    updatedLabel: input.text.updated,
  };

  const propsAt = (at: number): ScheduleWidgetProps => {
    const entries = upcoming
      .filter((group) => groupEndsAt(group) > at)
      .slice(0, SCHEDULE_WIDGET_MAX_ENTRIES)
      .map((group) => entryFor(input, group));
    return entries.length
      ? { ...common, state: 'ready', message: '', entries }
      : { ...common, state: 'empty', message: input.text.empty, entries: [] };
  };

  const changes = [...new Set(upcoming.map(groupEndsAt).filter((end) => end > now && end < expiresAt))].sort((a, b) => a - b);
  return [
    { date: new Date(now), props: propsAt(now) },
    ...changes.map((at) => ({ date: new Date(at), props: propsAt(at) })),
    { date: new Date(expiresAt), props: { ...common, state: 'expired', message: input.text.expired, entries: [] } },
  ];
};
