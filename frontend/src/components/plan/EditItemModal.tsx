import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  formatDuration,
  parseChordPro,
  parseDuration,
  type PlanDetail,
  type PlanItemDetail,
  type PlanItemSegment,
  type PlanItemType,
  type TeamWithPositions,
  type UpdatePlanItemRequest,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, usePeople, useSong, useSongs } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Modal } from '../ui';
import { KeySelect } from '../KeySelect';

export interface EditItemModalProps {
  plan: PlanDetail;
  item: PlanItemDetail;
  teams: readonly TeamWithPositions[];
  onClose: () => void;
}

type LeaderMode = 'none' | 'person' | 'position';

/** Everything the form edits, compared with the saved item to find changes. */
interface ItemDraft {
  itemType: PlanItemType;
  title: string;
  length: string;
  description: string;
  songId: string | null;
  arrangementId: string | null;
  keyOverride: string | null;
  inheritSequence: boolean;
  sequence: string;
  leaderMode: LeaderMode;
  leaderPersonId: string;
  leaderPositionId: string;
  segment: PlanItemSegment;
}

const SEGMENT_LABELS: Record<PlanItemSegment, string> = {
  pre: 'Before the service',
  service: 'During the service',
  post: 'After the service',
};

const draftFrom = (item: PlanItemDetail): ItemDraft => ({
  itemType: item.item_type,
  title: item.title,
  length: item.length_seconds ? formatDuration(item.length_seconds) : '',
  description: item.description ?? '',
  songId: item.song_id,
  arrangementId: item.arrangement_id,
  keyOverride: item.key_override,
  inheritSequence: item.sequence_override === null || item.sequence_override === undefined,
  sequence: (item.sequence_override ?? []).join(', '),
  leaderMode: item.leader_person_id ? 'person' : item.leader_position_id ? 'position' : 'none',
  leaderPersonId: item.leader_person_id ?? '',
  leaderPositionId: item.leader_position_id ?? '',
  segment: item.service_segment ?? 'service',
});

const parseSequence = (value: string): string[] =>
  value.split(',').map((step) => step.trim()).filter(Boolean);

/** Errors the form can catch before the server does; null when valid. */
const validate = (draft: ItemDraft): string | null => {
  if (draft.itemType !== 'song' && !draft.title.trim()) return 'Give the item a title.';
  if (draft.itemType === 'song' && !draft.songId) return 'Choose a song.';
  if (draft.length.trim() && parseDuration(draft.length) === null) return 'Enter the length as minutes:seconds, e.g. 4:30.';
  const length = parseDuration(draft.length) ?? 0;
  if (length < 0 || length > 36_000) return 'The length must be between 0 and 10 hours.';
  if (!draft.inheritSequence) {
    const steps = parseSequence(draft.sequence);
    if (steps.length > 60) return 'A sequence can have at most 60 steps.';
    if (steps.some((step) => step.length > 20)) return 'Each sequence step can be at most 20 characters.';
  }
  if (draft.leaderMode === 'person' && !draft.leaderPersonId) return 'Choose who leads this item.';
  if (draft.leaderMode === 'position' && !draft.leaderPositionId) return 'Choose the position that leads this item.';
  return null;
};

/** Only the fields that changed, so a save never rewrites what it did not touch. */
const changesFrom = (draft: ItemDraft, item: PlanItemDetail): UpdatePlanItemRequest => {
  const changes: UpdatePlanItemRequest = {};
  const isSong = draft.itemType === 'song';
  if (draft.itemType !== item.item_type) changes.item_type = draft.itemType;
  if (draft.title.trim() && draft.title.trim() !== item.title) changes.title = draft.title.trim();
  const length = draft.itemType === 'header' ? 0 : (parseDuration(draft.length) ?? 0);
  if (length !== item.length_seconds) changes.length_seconds = length;
  const description = draft.description.trim() || null;
  if (description !== item.description) changes.description = description;
  if (isSong) {
    if (draft.songId !== item.song_id) changes.song_id = draft.songId;
    if (draft.arrangementId !== item.arrangement_id) changes.arrangement_id = draft.arrangementId;
    if (draft.keyOverride !== item.key_override) changes.key_override = draft.keyOverride;
    const sequence = draft.inheritSequence ? null : parseSequence(draft.sequence);
    if (JSON.stringify(sequence) !== JSON.stringify(item.sequence_override ?? null)) changes.sequence_override = sequence;
  }
  const person = draft.leaderMode === 'person' ? draft.leaderPersonId : null;
  const position = draft.leaderMode === 'position' ? draft.leaderPositionId : null;
  if (person !== item.leader_person_id) changes.leader_person_id = person;
  if (position !== item.leader_position_id) changes.leader_position_id = position;
  if (draft.segment !== (item.service_segment ?? 'service')) changes.service_segment = draft.segment;
  return changes;
};

/**
 * F11: edit an existing order item in place — its id and position stay.
 * Keys and sequences set here belong to this plan only; the library
 * arrangement is never changed. Saving checks the plan revision the editor
 * opened with, so someone else's change is shown instead of overwritten.
 */
export const EditItemModal = ({ plan, item, teams, onClose }: EditItemModalProps) => {
  const queryClient = useQueryClient();
  const { organizationId, user } = useAuth();
  const [draft, setDraft] = useState<ItemDraft>(() => draftFrom(item));
  const [baseRevision, setBaseRevision] = useState(plan.content_revision);
  const [songQuery, setSongQuery] = useState('');
  const [changingSong, setChangingSong] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const song = useSong(draft.itemType === 'song' ? (draft.songId ?? undefined) : undefined);
  const songs = useSongs({ q: songQuery || undefined, per_page: 10 });
  const people = usePeople();
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const effectiveArrangementId = draft.arrangementId ?? song.data?.arrangements.find((a) => a.is_default)?.id;
  const labeledKeys = useQuery({
    queryKey: ['arrangement-materials', organizationId, user?.profile.id, effectiveArrangementId],
    queryFn: () => api.getArrangementMaterials(effectiveArrangementId!),
    enabled: draft.itemType === 'song' && !!effectiveArrangementId,
  });
  const changes = useMemo(() => changesFrom(draft, item), [draft, item]);
  const dirty = Object.keys(changes).length > 0;
  const planChanged = plan.content_revision !== baseRevision;

  const arrangements = (song.data?.arrangements ?? []).filter((row) =>
    !row.archived_at || row.id === item.arrangement_id);
  const chosenArrangement =
    arrangements.find((candidate) => candidate.id === draft.arrangementId) ??
    (draft.arrangementId ? null : (arrangements.find((candidate) => candidate.is_default) ?? arrangements[0] ?? null));
  const sectionLabels = useMemo(() => {
    const chart = chosenArrangement?.chord_chart;
    if (!chart) return [];
    const labels = parseChordPro(chart).sections.flatMap((section) => (section.label ? [section.label] : []));
    return [...new Set(labels)].filter((label) => label.length <= 20);
  }, [chosenArrangement]);

  const positions = useMemo(() => {
    const options = teams.flatMap((team) =>
      team.positions.filter((position) => !position.plan_id).map((position) => ({ id: position.id, label: `${team.name} · ${position.name}` })),
    );
    for (const position of plan.plan_positions) {
      const team = teams.find((candidate) => candidate.id === position.team_id);
      options.push({ id: position.id, label: `${team?.name ?? 'Team'} · ${position.name} (this plan)` });
    }
    return options;
  }, [teams, plan.plan_positions]);
  const roster = (people.data ?? []).filter((person) => person.person_id && !person.archived);

  const save = useMutation({
    mutationFn: () => api.updatePlanItem(plan.id, item.id, { ...changes, expected_revision: baseRevision }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.all(organizationId) });
      onClose();
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === 'plan_revision_stale';

  const reloadLatest = async () => {
    // Keep the draft; refresh the plan and save against what is there now.
    await queryClient.invalidateQueries({ queryKey: keys.plan(organizationId, plan.id) });
    const latest = queryClient.getQueryData<PlanDetail>(keys.plan(organizationId, plan.id));
    setBaseRevision(latest?.content_revision ?? plan.content_revision);
    save.reset();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = validate(draft);
    setFormError(problem);
    if (problem || !dirty) return;
    save.mutate();
  };

  const close = () => {
    if (dirty && !window.confirm('Discard your changes to this item?')) return;
    onClose();
  };

  return (
    <Modal open title={`Edit “${item.title}”`} onClose={close} size="wide">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {planChanged && !stale && (
          <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-600/20">
            This plan changed while you were editing. Saving will be checked against the version you opened.
          </p>
        )}

        <fieldset>
          <legend className="label">Type</legend>
          <div className="flex gap-2">
            {(['song', 'item', 'header'] as const).map((value) => (
              <label key={value} className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${draft.itemType === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                <input type="radio" name="item-type" value={value} checked={draft.itemType === value} onChange={() => set('itemType', value)} className="sr-only" />
                {value}
              </label>
            ))}
          </div>
          {item.item_type === 'song' && draft.itemType !== 'song' && (
            <p className="mt-1 text-xs text-amber-700">The song, arrangement, key and sequence will be removed from this item.</p>
          )}
        </fieldset>

        <div>
          <label className="label" htmlFor="edit-item-title">Title</label>
          <input id="edit-item-title" className="input" value={draft.title} onChange={(event) => set('title', event.target.value)} maxLength={200} />
        </div>

        {draft.itemType === 'song' && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className="text-slate-500">Song: </span>
                <span className="font-medium">{song.data?.title ?? item.song?.title ?? 'None chosen'}</span>
              </p>
              <Button type="button" variant="secondary" onClick={() => setChangingSong((open) => !open)} aria-expanded={changingSong}>
                {changingSong ? 'Keep this song' : 'Change song'}
              </Button>
            </div>
            {changingSong && (
              <div>
                <label className="label" htmlFor="edit-item-song">Find a song</label>
                <input id="edit-item-song" className="input" value={songQuery} onChange={(event) => setSongQuery(event.target.value)} placeholder="Search by title" />
                <ul className="mt-1 max-h-40 overflow-y-auto">
                  {(songs.data?.data ?? []).map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            songId: candidate.id,
                            title: candidate.title,
                            arrangementId: null,
                            keyOverride: null,
                            inheritSequence: true,
                            sequence: '',
                          }));
                          setChangingSong(false);
                        }}
                      >
                        {candidate.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <label className="label" htmlFor="edit-item-arrangement">Arrangement</label>
              <select
                id="edit-item-arrangement"
                className="input"
                value={draft.arrangementId ?? ''}
                onChange={(event) => set('arrangementId', event.target.value || null)}
                disabled={song.isLoading}
              >
                <option value="">Song default{arrangements.length ? ` (${(arrangements.find((a) => a.is_default) ?? arrangements[0])?.name})` : ''}</option>
                {arrangements.map((arrangement) => (
                  <option key={arrangement.id} value={arrangement.id}>
                    {arrangement.name}{arrangement.song_key ? ` — ${arrangement.song_key}` : ''}{arrangement.is_default ? ' (default)' : ''}
                  </option>
                ))}
                {draft.arrangementId && !song.isLoading && !arrangements.some((a) => a.id === draft.arrangementId) && (
                  <option value={draft.arrangementId}>Unavailable arrangement</option>
                )}
              </select>
              {draft.arrangementId && !song.isLoading && !arrangements.some((a) => a.id === draft.arrangementId) && (
                <p className="mt-1 text-xs text-rose-700">The chosen arrangement no longer belongs to this song. Pick another.</p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="edit-item-key">Service key</label>
              <KeySelect
                id="edit-item-key"
                value={draft.keyOverride}
                onChange={(value) => set('keyOverride', value)}
                placeholder={chosenArrangement?.song_key ? `Arrangement key (${chosenArrangement.song_key})` : 'Arrangement key'}
                resetLabel="Use the arrangement key"
              />
              {!!labeledKeys.data?.keys.length && <div className="mt-2">
                <label className="label" htmlFor="edit-item-labeled-key">Labeled library key</label>
                <select className="input" id="edit-item-labeled-key" value={labeledKeys.data.keys.some((k) => k.song_key === draft.keyOverride) ? draft.keyOverride! : ''} onChange={(e) => set('keyOverride', e.target.value || null)}>
                  <option value="">Use arrangement key / choose another service key</option>
                  {labeledKeys.data.keys.map((k) => <option key={k.id} value={k.song_key}>{k.label} · {k.song_key}{k.capo ? ` · capo ${k.capo}` : ''}{k.vocal_label ? ` · ${k.vocal_label}` : ''}</option>)}
                </select>
              </div>}
              <ErrorNotice error={labeledKeys.error} />
              <p className="mt-1 text-xs text-slate-500">For this plan only. The library arrangement stays in {chosenArrangement?.song_key ?? 'its own key'}.</p>
            </div>

            <fieldset>
              <legend className="label">Sequence</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.inheritSequence} onChange={(event) => setDraft((current) => ({
                  ...current,
                  inheritSequence: event.target.checked,
                  sequence: current.sequence || (chosenArrangement?.sequence ?? []).join(', '),
                }))} />
                Use the arrangement’s sequence{chosenArrangement?.sequence.length ? `: ${chosenArrangement.sequence.join(', ')}` : ' (none set)'}
              </label>
              {!draft.inheritSequence && (
                <div className="mt-2">
                  <label className="sr-only" htmlFor="edit-item-sequence">Sequence for this plan, separated by commas</label>
                  <input id="edit-item-sequence" className="input" value={draft.sequence} onChange={(event) => set('sequence', event.target.value)} placeholder="Intro, V1, C, V2, C" aria-describedby="edit-item-sequence-help" />
                  <p id="edit-item-sequence-help" className="mt-1 text-xs text-slate-500">Separate steps with commas. Leave empty for no sequence in this plan.</p>
                  {sectionLabels.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {sectionLabels.map((label) => (
                        <button key={label} type="button" className="rounded bg-slate-100 px-2 py-0.5 text-xs hover:bg-slate-200" onClick={() => set('sequence', [...parseSequence(draft.sequence), label].join(', '))}>
                          + {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </fieldset>
          </div>
        )}

        {draft.itemType !== 'header' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="edit-item-length">Length</label>
              <input id="edit-item-length" className="input" value={draft.length} onChange={(event) => set('length', event.target.value)} placeholder="4:30" inputMode="numeric" />
            </div>
            <div>
              <label className="label" htmlFor="edit-item-segment">When</label>
              <select id="edit-item-segment" className="input" value={draft.segment} onChange={(event) => set('segment', event.target.value as PlanItemSegment)}>
                {(Object.keys(SEGMENT_LABELS) as PlanItemSegment[]).map((segment) => (
                  <option key={segment} value={segment}>{SEGMENT_LABELS[segment]}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {draft.itemType !== 'header' && (
          <div>
            <label className="label" htmlFor="edit-item-description">Description</label>
            <textarea id="edit-item-description" className="input" rows={2} maxLength={4000} value={draft.description} onChange={(event) => set('description', event.target.value)} />
          </div>
        )}

        {draft.itemType !== 'header' && (
          <fieldset>
            <legend className="label">Leader</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {(['none', 'person', 'position'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-1.5">
                  <input type="radio" name="leader-mode" checked={draft.leaderMode === mode} onChange={() => set('leaderMode', mode)} />
                  {mode === 'none' ? 'Nobody' : mode === 'person' ? 'A person' : 'Whoever holds a position'}
                </label>
              ))}
            </div>
            {draft.leaderMode === 'person' && (
              <select aria-label="Person who leads" className="input mt-2" value={draft.leaderPersonId} onChange={(event) => set('leaderPersonId', event.target.value)}>
                <option value="">Choose a person</option>
                {roster.map((person) => (
                  <option key={person.person_id!} value={person.person_id!}>{person.full_name ?? 'Unnamed'}</option>
                ))}
                {draft.leaderPersonId && !roster.some((person) => person.person_id === draft.leaderPersonId) && (
                  <option value={draft.leaderPersonId}>{item.leader_person?.full_name ?? 'Current leader'}</option>
                )}
              </select>
            )}
            {draft.leaderMode === 'position' && (
              <>
                <select aria-label="Position that leads" className="input mt-2" value={draft.leaderPositionId} onChange={(event) => set('leaderPositionId', event.target.value)}>
                  <option value="">Choose a position</option>
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>{position.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">The leader follows this plan’s staffing: whoever holds the position now.</p>
              </>
            )}
          </fieldset>
        )}

        <ErrorNotice error={formError} />
        {stale ? (
          <div role="alert" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/20">
            <p>Someone else changed this plan after you opened this item. Your edits are still here.</p>
            <Button type="button" variant="secondary" className="mt-2" onClick={() => void reloadLatest()}>
              Load the latest plan and keep my edits
            </Button>
          </div>
        ) : (
          <ErrorNotice error={save.error} />
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          {!dirty && <span className="mr-auto text-xs text-slate-500">No changes yet</span>}
          <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
          <Button type="submit" loading={save.isPending} disabled={!dirty || stale}>Save changes</Button>
        </div>
      </form>
    </Modal>
  );
};
