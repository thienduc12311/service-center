import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  LocalizedError,
  PLAN_ITEM_SEGMENTS,
  appendSequenceStep,
  editableArrangements,
  parseChordPro,
  planItemChangesFrom,
  planItemDraftFrom,
  validatePlanItemDraft,
  withInheritSequence,
  withSong,
  type PlanDetail,
  type PlanItemDetail,
  type PlanItemDraft,
  type PlanItemSegment,
  type TeamWithPositions,
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

/**
 * F11: edit an existing order item in place — its id and position stay.
 * Keys and sequences set here belong to this plan only; the library
 * arrangement is never changed. Saving checks the plan revision the editor
 * opened with, so someone else's change is shown instead of overwritten.
 */
export const EditItemModal = ({ plan, item, teams, onClose }: EditItemModalProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const queryClient = useQueryClient();
  const { organizationId, user } = useAuth();
  const [draft, setDraft] = useState<PlanItemDraft>(() => planItemDraftFrom(item));
  const [baseRevision, setBaseRevision] = useState(plan.content_revision);
  const [songQuery, setSongQuery] = useState('');
  const [changingSong, setChangingSong] = useState(false);
  const [formError, setFormError] = useState<LocalizedError | null>(null);
  const song = useSong(draft.itemType === 'song' ? (draft.songId ?? undefined) : undefined);
  const songs = useSongs({ q: songQuery || undefined, per_page: 10 });
  const people = usePeople();
  const set = <K extends keyof PlanItemDraft>(key: K, value: PlanItemDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const effectiveArrangementId = draft.arrangementId ?? song.data?.arrangements.find((a) => a.is_default)?.id;
  const labeledKeys = useQuery({
    queryKey: ['arrangement-materials', organizationId, user?.profile.id, effectiveArrangementId],
    queryFn: () => api.getArrangementMaterials(effectiveArrangementId!),
    enabled: draft.itemType === 'song' && !!effectiveArrangementId,
  });
  const changes = useMemo(() => planItemChangesFrom(draft, item), [draft, item]);
  const dirty = Object.keys(changes).length > 0;
  const planChanged = plan.content_revision !== baseRevision;

  const arrangements = editableArrangements(song.data?.arrangements ?? [], item.arrangement_id);
  const chosenArrangement =
    arrangements.find((candidate) => candidate.id === draft.arrangementId) ??
    (draft.arrangementId ? null : (arrangements.find((candidate) => candidate.is_default) ?? arrangements[0] ?? null));
  const defaultArrangementName = (arrangements.find((a) => a.is_default) ?? arrangements[0])?.name;
  const sectionLabels = useMemo(() => {
    const chart = chosenArrangement?.chord_chart;
    if (!chart) return [];
    const labels = parseChordPro(chart).sections.flatMap((section) => (section.label ? [section.label] : []));
    return [...new Set(labels)].filter((label) => label.length <= 20);
  }, [chosenArrangement]);

  const positions = useMemo(() => {
    const options = teams.flatMap((team) =>
      team.positions.filter((position) => !position.plan_id).map((position) => ({ id: position.id, label: t('common:format.teamPosition', { team: team.name, position: position.name }) })),
    );
    for (const position of plan.plan_positions) {
      const team = teams.find((candidate) => candidate.id === position.team_id);
      options.push({ id: position.id, label: t('editItem.positionThisPlan', { team: team?.name ?? t('common:fallback.team'), position: position.name }) });
    }
    return options;
  }, [teams, plan.plan_positions, t]);
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
    const problemKey = validatePlanItemDraft(draft);
    const problem = problemKey ? new LocalizedError({ key: `plans:editItem.errors.${problemKey}` }) : null;
    setFormError(problem);
    if (problem || !dirty) return;
    save.mutate();
  };

  const close = () => {
    if (dirty && !window.confirm(t('editItem.discardConfirm'))) return;
    onClose();
  };

  return (
    <Modal open title={t('editItem.title', { title: item.title })} onClose={close} size="wide">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {planChanged && !stale && (
          <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-600/20">
            {t('editItem.planChanged')}
          </p>
        )}

        <fieldset>
          <legend className="label">{t('editItem.type')}</legend>
          <div className="flex gap-2">
            {(['song', 'item', 'header'] as const).map((value) => (
              <label key={value} className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium ${draft.itemType === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                <input type="radio" name="item-type" value={value} checked={draft.itemType === value} onChange={() => set('itemType', value)} className="sr-only" />
                {t(`itemKind.${value}`)}
              </label>
            ))}
          </div>
          {item.item_type === 'song' && draft.itemType !== 'song' && (
            <p className="mt-1 text-xs text-amber-700">{t('editItem.songWillBeRemoved')}</p>
          )}
        </fieldset>

        <div>
          <label className="label" htmlFor="edit-item-title">{t('editItem.fieldTitle')}</label>
          <input id="edit-item-title" className="input" value={draft.title} onChange={(event) => set('title', event.target.value)} maxLength={200} />
        </div>

        {draft.itemType === 'song' && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className="text-slate-500">{t('editItem.songLabel')} </span>
                <span className="font-medium">{song.data?.title ?? item.song?.title ?? t('editItem.noneChosen')}</span>
              </p>
              <Button type="button" variant="secondary" onClick={() => setChangingSong((open) => !open)} aria-expanded={changingSong}>
                {changingSong ? t('editItem.keepSong') : t('editItem.changeSong')}
              </Button>
            </div>
            {changingSong && (
              <div>
                <label className="label" htmlFor="edit-item-song">{t('editItem.findSong')}</label>
                <input id="edit-item-song" className="input" value={songQuery} onChange={(event) => setSongQuery(event.target.value)} placeholder={t('editItem.searchPlaceholder')} />
                <ul className="mt-1 max-h-40 overflow-y-auto">
                  {(songs.data?.data ?? []).map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                        onClick={() => {
                          setDraft((current) => withSong(current, candidate));
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
              <label className="label" htmlFor="edit-item-arrangement">{t('editItem.arrangement')}</label>
              <select
                id="edit-item-arrangement"
                className="input"
                value={draft.arrangementId ?? ''}
                onChange={(event) => set('arrangementId', event.target.value || null)}
                disabled={song.isLoading}
              >
                <option value="">{defaultArrangementName ? t('editItem.songDefaultNamed', { name: defaultArrangementName }) : t('editItem.songDefault')}</option>
                {arrangements.map((arrangement) => (
                  <option key={arrangement.id} value={arrangement.id}>
                    {arrangement.song_key
                      ? t(arrangement.is_default ? 'editItem.arrangementWithKeyDefault' : 'editItem.arrangementWithKey', { name: arrangement.name, key: arrangement.song_key })
                      : arrangement.is_default
                        ? t('editItem.arrangementDefault', { name: arrangement.name })
                        : arrangement.name}
                  </option>
                ))}
                {draft.arrangementId && !song.isLoading && !arrangements.some((a) => a.id === draft.arrangementId) && (
                  <option value={draft.arrangementId}>{t('editItem.unavailableArrangement')}</option>
                )}
              </select>
              {draft.arrangementId && !song.isLoading && !arrangements.some((a) => a.id === draft.arrangementId) && (
                <p className="mt-1 text-xs text-rose-700">{t('editItem.arrangementGone')}</p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="edit-item-key">{t('editItem.serviceKey')}</label>
              <KeySelect
                id="edit-item-key"
                value={draft.keyOverride}
                onChange={(value) => set('keyOverride', value)}
                placeholder={chosenArrangement?.song_key ? t('editItem.arrangementKeyNamed', { key: chosenArrangement.song_key }) : t('editItem.arrangementKey')}
                resetLabel={t('editItem.useArrangementKey')}
              />
              {!!labeledKeys.data?.keys.length && <div className="mt-2">
                <label className="label" htmlFor="edit-item-labeled-key">{t('editItem.labeledKey')}</label>
                <select className="input" id="edit-item-labeled-key" value={labeledKeys.data.keys.some((k) => k.song_key === draft.keyOverride) ? draft.keyOverride! : ''} onChange={(e) => set('keyOverride', e.target.value || null)}>
                  <option value="">{t('editItem.labeledKeyNone')}</option>
                  {labeledKeys.data.keys.map((k) => (
                    <option key={k.id} value={k.song_key}>
                      {[k.label, k.song_key, ...(k.capo ? [t('editItem.capo', { capo: k.capo })] : []), ...(k.vocal_label ? [k.vocal_label] : [])].join(' · ')}
                    </option>
                  ))}
                </select>
              </div>}
              <ErrorNotice error={labeledKeys.error} />
              <p className="mt-1 text-xs text-slate-500">{chosenArrangement?.song_key ? t('editItem.planOnlyKeyHint', { key: chosenArrangement.song_key }) : t('editItem.planOnlyKeyHintOwnKey')}</p>
            </div>

            <fieldset>
              <legend className="label">{t('editItem.sequence')}</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.inheritSequence} onChange={(event) => setDraft((current) =>
                  withInheritSequence(current, event.target.checked, chosenArrangement?.sequence ?? []))} />
                {chosenArrangement?.sequence.length
                  ? t('editItem.useArrangementSequence', { sequence: chosenArrangement.sequence.join(', ') })
                  : t('editItem.useArrangementSequenceNone')}
              </label>
              {!draft.inheritSequence && (
                <div className="mt-2">
                  <label className="sr-only" htmlFor="edit-item-sequence">{t('editItem.sequenceLabel')}</label>
                  <input id="edit-item-sequence" className="input" value={draft.sequence} onChange={(event) => set('sequence', event.target.value)} placeholder="Intro, V1, C, V2, C" aria-describedby="edit-item-sequence-help" />
                  <p id="edit-item-sequence-help" className="mt-1 text-xs text-slate-500">{t('editItem.sequenceHelp')}</p>
                  {sectionLabels.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {sectionLabels.map((label) => (
                        <button key={label} type="button" className="rounded bg-slate-100 px-2 py-0.5 text-xs hover:bg-slate-200" onClick={() => set('sequence', appendSequenceStep(draft.sequence, label))}>
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
              <label className="label" htmlFor="edit-item-length">{t('editItem.length')}</label>
              <input id="edit-item-length" className="input" value={draft.length} onChange={(event) => set('length', event.target.value)} placeholder="4:30" inputMode="numeric" />
            </div>
            <div>
              <label className="label" htmlFor="edit-item-segment">{t('editItem.when')}</label>
              <select id="edit-item-segment" className="input" value={draft.segment} onChange={(event) => set('segment', event.target.value as PlanItemSegment)}>
                {PLAN_ITEM_SEGMENTS.map((segment) => (
                  <option key={segment} value={segment}>{t(`segment.${segment}`)}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {draft.itemType !== 'header' && (
          <div>
            <label className="label" htmlFor="edit-item-description">{t('editItem.description')}</label>
            <textarea id="edit-item-description" className="input" rows={2} maxLength={4000} value={draft.description} onChange={(event) => set('description', event.target.value)} />
          </div>
        )}

        {draft.itemType !== 'header' && (
          <fieldset>
            <legend className="label">{t('editItem.leader')}</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {(['none', 'person', 'position'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-1.5">
                  <input type="radio" name="leader-mode" checked={draft.leaderMode === mode} onChange={() => set('leaderMode', mode)} />
                  {t(`editItem.leaderMode.${mode}`)}
                </label>
              ))}
            </div>
            {draft.leaderMode === 'person' && (
              <select aria-label={t('editItem.personWhoLeads')} className="input mt-2" value={draft.leaderPersonId} onChange={(event) => set('leaderPersonId', event.target.value)}>
                <option value="">{t('editItem.choosePerson')}</option>
                {roster.map((person) => (
                  <option key={person.person_id!} value={person.person_id!}>{person.full_name ?? t('common:fallback.unnamed')}</option>
                ))}
                {draft.leaderPersonId && !roster.some((person) => person.person_id === draft.leaderPersonId) && (
                  <option value={draft.leaderPersonId}>{item.leader_person?.full_name ?? t('editItem.currentLeader')}</option>
                )}
              </select>
            )}
            {draft.leaderMode === 'position' && (
              <>
                <select aria-label={t('editItem.positionWhoLeads')} className="input mt-2" value={draft.leaderPositionId} onChange={(event) => set('leaderPositionId', event.target.value)}>
                  <option value="">{t('editItem.choosePosition')}</option>
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>{position.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">{t('editItem.positionFollowsHint')}</p>
              </>
            )}
          </fieldset>
        )}

        <ErrorNotice error={formError} />
        {stale ? (
          <div role="alert" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/20">
            <p>{t('editItem.stale')}</p>
            <Button type="button" variant="secondary" className="mt-2" onClick={() => void reloadLatest()}>
              {t('editItem.loadLatest')}
            </Button>
          </div>
        ) : (
          <ErrorNotice error={save.error} />
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          {!dirty && <span className="mr-auto text-xs text-slate-500">{t('editItem.noChanges')}</span>}
          <Button type="button" variant="secondary" onClick={close}>{t('common:actions.cancel')}</Button>
          <Button type="submit" loading={save.isPending} disabled={!dirty || stale}>{t('common:actions.saveChanges')}</Button>
        </div>
      </form>
    </Modal>
  );
};
