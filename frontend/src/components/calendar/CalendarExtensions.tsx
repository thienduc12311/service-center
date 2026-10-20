import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  toISODate,
  type CalendarLayer,
  type CalendarLayerEvent,
  type CalendarScopedFeedCreated,
  type CreateScopedFeedRequest,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useServiceTypes, useTeams } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Modal } from '../ui';

/** Every opt-in layer, in display order. */
export const CALENDAR_LAYERS: readonly CalendarLayer[] = ['blockouts', 'birthdays', 'anniversaries'];

export interface CalendarLayerQueryInput {
  teamId: string;
  from: string;
  to: string;
  layers: CalendarLayer[];
}

/** Opt-in layers for one team; the server decides which the viewer may see. */
export const useCalendarLayers = ({ teamId, from, to, layers }: CalendarLayerQueryInput) => {
  const { organizationId } = useAuth();
  const query = { team_id: teamId, from, to, layers };
  return useQuery({
    queryKey: keys.calendarLayers(organizationId, query),
    queryFn: () => api.calendarLayers(query),
    enabled: Boolean(organizationId && teamId && layers.length),
  });
};

/** Civil days a layer event covers, for placing it on the month grid. */
export const layerEventDays = (event: CalendarLayerEvent): string[] => {
  if (event.date) return [event.date];
  if (!event.starts_at || !event.ends_at) return [];
  const days: string[] = [];
  const end = new Date(event.ends_at).getTime();
  for (let at = new Date(event.starts_at).getTime(); at < end && days.length < 62; at += 86_400_000) days.push(toISODate(at));
  return days;
};

export const layerLabel = (event: CalendarLayerEvent, t: TFunction<'scheduling'>): string =>
  t(`layers.event.${event.layer}`, { name: event.person_name });

export interface LayerTogglesProps {
  teamId: string;
  layers: CalendarLayer[];
  onChange: (layers: CalendarLayer[]) => void;
}

export const LayerToggles = ({ teamId, layers, onChange }: LayerTogglesProps) => {
  const { t } = useTranslation('scheduling');
  return (
    <fieldset className="flex flex-wrap items-center gap-3 text-sm text-slate-600" disabled={!teamId}>
      <legend className="sr-only">{t('layers.legend')}</legend>
      {CALENDAR_LAYERS.map((layer) => (
        <label key={layer} className="flex items-center gap-1.5">
          <input
            type="checkbox"
            className="size-4 rounded border-slate-300"
            checked={layers.includes(layer)}
            onChange={(event) => onChange(event.target.checked ? [...layers, layer] : layers.filter((l) => l !== layer))}
          />
          {t(`layers.label.${layer}`)}
        </label>
      ))}
      {!teamId && <span className="text-xs text-slate-400">{t('layers.chooseTeam')}</span>}
    </fieldset>
  );
};

/**
 * Service-type and team subscriptions. The URL is shown once; rotating gives
 * a new one and the old stops working. Calendar apps decide when they refresh.
 */
export const ScopedFeedsPanel = () => {
  const { organizationId } = useAuth();
  const { t } = useTranslation(['scheduling', 'common']);
  const queryClient = useQueryClient();
  const feeds = useQuery({ queryKey: keys.scopedFeeds(organizationId), queryFn: () => api.scopedCalendarFeeds() });
  const teams = useTeams();
  const serviceTypes = useServiceTypes();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<CreateScopedFeedRequest>({ scope_type: 'team', include_rehearsals: true, layers: [] });
  const [created, setCreated] = useState<CalendarScopedFeedCreated | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.scopedFeeds(organizationId) });

  const create = useMutation({
    mutationFn: () => api.createScopedCalendarFeed(draft),
    onSuccess: async (result) => {
      setCreating(false);
      setCreated(result);
      await refresh();
    },
  });
  const rotate = useMutation({
    mutationFn: (feedId: string) => api.rotateScopedCalendarFeed(feedId),
    onSuccess: async (result) => {
      setCreated(result);
      await refresh();
    },
  });
  const revoke = useMutation({ mutationFn: (feedId: string) => api.revokeScopedCalendarFeed(feedId), onSuccess: refresh });

  return (
    <section aria-labelledby="feeds-heading" className="card mt-6 space-y-3 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="feeds-heading" className="font-semibold">{t('feeds.heading')}</h2>
          <p className="text-xs text-slate-500">{t('feeds.help')}</p>
        </div>
        <Button variant="secondary" onClick={() => setCreating(true)}>{t('feeds.newFeed')}</Button>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {(feeds.data ?? []).length === 0 && <li className="py-2 text-slate-500">{t('feeds.empty')}</li>}
        {(feeds.data ?? []).map((feed) => (
          <li key={feed.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {[
                feed.label ?? feed.scope_name ?? t('feeds.fallbackName'),
                feed.scope_type === 'team' ? t('feeds.scopeTeam') : t('feeds.scopeServiceType'),
                feed.include_rehearsals ? t('feeds.withRehearsals') : null,
                feed.layers.length
                  ? feed.layers.map((layer) => t(`layers.label.${layer}`)).join(t('common:format.listSeparator'))
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className="flex gap-2">
              <Button variant="ghost" onClick={() => rotate.mutate(feed.id)}>{t('feeds.newLink')}</Button>
              <Button variant="ghost" onClick={() => revoke.mutate(feed.id)}>{t('common:actions.remove')}</Button>
            </span>
          </li>
        ))}
      </ul>
      <ErrorNotice error={feeds.error ?? rotate.error ?? revoke.error} />

      <Modal
        open={creating}
        title={t('feeds.createTitle')}
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>{t('common:actions.cancel')}</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>{t('common:actions.create')}</Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <label className="field">
            {t('feeds.scopeLabel')}
            <select
              className="input"
              value={draft.scope_type}
              onChange={(event) =>
                setDraft({ scope_type: event.target.value as CreateScopedFeedRequest['scope_type'], include_rehearsals: draft.include_rehearsals, layers: [] })
              }
            >
              <option value="team">{t('feeds.scopeOption.team')}</option>
              <option value="service_type">{t('feeds.scopeOption.service_type')}</option>
            </select>
          </label>
          {draft.scope_type === 'team' ? (
            <label className="field">
              {t('feeds.teamLabel')}
              <select className="input" value={draft.team_id ?? ''} onChange={(e) => setDraft({ ...draft, team_id: e.target.value })}>
                <option value="">{t('feeds.choose')}</option>
                {(teams.data ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
          ) : (
            <label className="field">
              {t('feeds.serviceTypeLabel')}
              <select className="input" value={draft.service_type_id ?? ''} onChange={(e) => setDraft({ ...draft, service_type_id: e.target.value })}>
                <option value="">{t('feeds.choose')}</option>
                {(serviceTypes.data ?? []).map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.include_rehearsals ?? true}
              onChange={(e) => setDraft({ ...draft, include_rehearsals: e.target.checked })}
            />
            {t('feeds.includeRehearsals')}
          </label>
          {draft.scope_type === 'team' && (
            <div>
              <p className="mb-1">{t('feeds.layersHint')}</p>
              <LayerToggles teamId={draft.team_id ?? ''} layers={draft.layers ?? []} onChange={(layers) => setDraft({ ...draft, layers })} />
            </div>
          )}
          <label className="field">
            {t('feeds.nameLabel')}
            <input className="input" maxLength={80} value={draft.label ?? ''} onChange={(e) => setDraft({ ...draft, label: e.target.value || null })} />
          </label>
          <ErrorNotice error={create.error} />
        </div>
      </Modal>

      <Modal open={Boolean(created)} title={t('feeds.linkTitle')} onClose={() => setCreated(null)}>
        {created && (
          <div className="space-y-2 text-sm">
            <p>{t('feeds.linkOnce')}</p>
            <input className="input font-mono text-xs" readOnly value={created.url} onFocus={(event) => event.target.select()} aria-label={t('feeds.urlLabel')} />
            <a className="text-brand-700 underline" href={created.webcal_url}>{t('feeds.openInApp')}</a>
          </div>
        )}
      </Modal>
    </section>
  );
};
