import type {
  CalendarLayer,
  CalendarLayerEvent,
  CalendarScopedFeedRow,
  CalendarScopedFeedSummary,
  TeamCalendarLayerRpcRow,
} from '@service-center/shared';
import type { IcsEvent } from '../lib/ics.js';

const LAYER_LABELS: Record<CalendarLayer, string> = {
  blockouts: 'Unavailable',
  birthdays: 'Birthday',
  anniversaries: 'Anniversary',
};

const isLayer = (value: string): value is CalendarLayer =>
  value === 'blockouts' || value === 'birthdays' || value === 'anniversaries';

/** Stable ids: a blockout by its row id; a personal date by person and civil date. */
export const toCalendarLayerEvent = (row: TeamCalendarLayerRpcRow): CalendarLayerEvent | null => {
  if (!isLayer(row.layer)) return null;
  const id = row.layer === 'blockouts' ? `blockout-${row.source_id}` : `${row.layer}-${row.person_id}-${row.on_date}`;
  return {
    id,
    layer: row.layer,
    person_id: row.person_id,
    person_name: row.person_name,
    date: row.on_date,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    all_day: row.all_day,
  };
};

/** Layer events are free time and never carry a blockout reason or a birth year. */
export const layerIcsEvent = (event: CalendarLayerEvent, host: string): IcsEvent => ({
  uid: `${event.id}@${host}`,
  summary: `${LAYER_LABELS[event.layer]}: ${event.person_name}`,
  startsAt: event.starts_at ?? '',
  endsAt: event.ends_at ?? '',
  sequence: 0,
  transparent: true,
  ...(event.date ? { allDayDate: event.date } : {}),
});

/** A plan time's UID in a scoped feed: stable across token rotation, distinct from the personal feed. */
export const scopedPlanTimeUid = (feed: Pick<CalendarScopedFeedRow, 'scope_type' | 'service_type_id' | 'team_id'>, planTimeId: string, host: string): string =>
  `plan-time-${planTimeId}-${feed.scope_type === 'team' ? `team-${feed.team_id}` : `st-${feed.service_type_id}`}@${host}`;

export const toScopedFeedSummary = (row: CalendarScopedFeedRow, scopeName: string | null): CalendarScopedFeedSummary => {
  const { token_hash: _hash, ...summary } = row;
  return { ...summary, scope_name: scopeName };
};

export const scopedFeedUrls = (apiUrl: string, token: string): { url: string; webcal_url: string } => {
  const url = `${apiUrl}/api/v1/calendar-feed/scoped/${token}.ics`;
  return { url, webcal_url: url.replace(/^https?:\/\//, 'webcal://') };
};
