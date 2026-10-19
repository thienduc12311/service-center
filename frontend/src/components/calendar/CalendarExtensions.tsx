import { useState } from 'react';
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

export const LAYER_LABELS: Record<CalendarLayer, string> = {
  blockouts: 'Blockouts',
  birthdays: 'Birthdays',
  anniversaries: 'Anniversaries',
};

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

export const layerLabel = (event: CalendarLayerEvent): string =>
  `${event.layer === 'blockouts' ? 'Unavailable' : event.layer === 'birthdays' ? 'Birthday' : 'Anniversary'}: ${event.person_name}`;

export interface LayerTogglesProps {
  teamId: string;
  layers: CalendarLayer[];
  onChange: (layers: CalendarLayer[]) => void;
}

export const LayerToggles = ({ teamId, layers, onChange }: LayerTogglesProps) => (
  <fieldset className="flex flex-wrap items-center gap-3 text-sm text-slate-600" disabled={!teamId}>
    <legend className="sr-only">Layers</legend>
    {(['blockouts', 'birthdays', 'anniversaries'] as const).map((layer) => (
      <label key={layer} className="flex items-center gap-1.5">
        <input
          type="checkbox"
          className="size-4 rounded border-slate-300"
          checked={layers.includes(layer)}
          onChange={(event) => onChange(event.target.checked ? [...layers, layer] : layers.filter((l) => l !== layer))}
        />
        {LAYER_LABELS[layer]}
      </label>
    ))}
    {!teamId && <span className="text-xs text-slate-400">Choose a team to show layers</span>}
  </fieldset>
);

/**
 * Service-type and team subscriptions. The URL is shown once; rotating gives
 * a new one and the old stops working. Calendar apps decide when they refresh.
 */
export const ScopedFeedsPanel = () => {
  const { organizationId } = useAuth();
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
          <h2 id="feeds-heading" className="font-semibold">Team and service-type calendar feeds</h2>
          <p className="text-xs text-slate-500">
            Subscribe in Google, Apple or Outlook Calendar. Your calendar app decides how often it refreshes (often every
            few hours), so a last-minute change may not appear at once. Access is checked on every refresh.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setCreating(true)}>New feed</Button>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {(feeds.data ?? []).length === 0 && <li className="py-2 text-slate-500">No feeds yet.</li>}
        {(feeds.data ?? []).map((feed) => (
          <li key={feed.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {feed.label ?? feed.scope_name ?? 'Feed'} · {feed.scope_type === 'team' ? 'team' : 'service type'}
              {feed.include_rehearsals ? ' · with rehearsals' : ''}
              {feed.layers.length ? ` · ${feed.layers.map((layer) => LAYER_LABELS[layer]).join(', ')}` : ''}
            </span>
            <span className="flex gap-2">
              <Button variant="ghost" onClick={() => rotate.mutate(feed.id)}>New link</Button>
              <Button variant="ghost" onClick={() => revoke.mutate(feed.id)}>Remove</Button>
            </span>
          </li>
        ))}
      </ul>
      <ErrorNotice error={feeds.error ?? rotate.error ?? revoke.error} />

      <Modal
        open={creating}
        title="New calendar feed"
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>Create</Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <label className="field">
            Scope
            <select
              className="input"
              value={draft.scope_type}
              onChange={(event) =>
                setDraft({ scope_type: event.target.value as CreateScopedFeedRequest['scope_type'], include_rehearsals: draft.include_rehearsals, layers: [] })
              }
            >
              <option value="team">A team (people on it, or teams I schedule)</option>
              <option value="service_type">A service type (published plans)</option>
            </select>
          </label>
          {draft.scope_type === 'team' ? (
            <label className="field">
              Team
              <select className="input" value={draft.team_id ?? ''} onChange={(e) => setDraft({ ...draft, team_id: e.target.value })}>
                <option value="">Choose…</option>
                {(teams.data ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
          ) : (
            <label className="field">
              Service type
              <select className="input" value={draft.service_type_id ?? ''} onChange={(e) => setDraft({ ...draft, service_type_id: e.target.value })}>
                <option value="">Choose…</option>
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
            Include rehearsals
          </label>
          {draft.scope_type === 'team' && (
            <div>
              <p className="mb-1">Layers (only what you are allowed to see is included)</p>
              <LayerToggles teamId={draft.team_id ?? ''} layers={draft.layers ?? []} onChange={(layers) => setDraft({ ...draft, layers })} />
            </div>
          )}
          <label className="field">
            Name (optional)
            <input className="input" maxLength={80} value={draft.label ?? ''} onChange={(e) => setDraft({ ...draft, label: e.target.value || null })} />
          </label>
          <ErrorNotice error={create.error} />
        </div>
      </Modal>

      <Modal open={Boolean(created)} title="Your feed link" onClose={() => setCreated(null)}>
        {created && (
          <div className="space-y-2 text-sm">
            <p>Copy it now — it is shown only once. Anyone with this link sees this calendar, so keep it private.</p>
            <input className="input font-mono text-xs" readOnly value={created.url} onFocus={(event) => event.target.select()} aria-label="Feed URL" />
            <a className="text-brand-700 underline" href={created.webcal_url}>Open in my calendar app</a>
          </div>
        )}
      </Modal>
    </section>
  );
};
