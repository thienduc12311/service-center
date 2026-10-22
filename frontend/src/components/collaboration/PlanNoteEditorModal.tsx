import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  NOTE_AUDIENCES,
  noteCategoryLabel,
  noteTeamNames,
  planNoteDraftFrom,
  planNoteLeavesSimple,
  planNoteRequest,
  toggleNoteTeam,
  validatePlanNoteDraft,
  withNoteCategory,
  type NoteCategoryRow,
  type PlanNote,
  type PlanNoteDraft,
  type TeamWithPositions,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Modal } from '../ui';

export interface PlanNoteEditorModalProps {
  planId: string;
  /** The note being edited; null creates one. */
  note: PlanNote | null;
  /** Set to file a new note on one item. */
  planItemId: string | null;
  categories: NoteCategoryRow[];
  teams: TeamWithPositions[];
  onClose: () => void;
}

/** Create or edit one note. Saving sends the revision it opened; a stale edit is refused. */
export const PlanNoteEditorModal = ({ planId, note, planItemId, categories, teams, onClose }: PlanNoteEditorModalProps) => {
  const { t } = useTranslation(['messages', 'common']);
  const invalidate = useInvalidateOrg();
  // Shared with the native editor (`plan-notes`), so both save the same note.
  const [draft, setDraft] = useState<PlanNoteDraft>(() => planNoteDraftFrom(note, planItemId));
  const { categoryId, audience, teamIds, body } = draft;
  const itemId = draft.planItemId;

  const save = useMutation({
    mutationFn: () =>
      note
        ? api.updatePlanNote(planId, note.id, planNoteRequest(draft, note))
        : api.createPlanNote(planId, planNoteRequest(draft, null)),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deletePlanNote(planId, note!.id, note!.revision),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });

  // A category suggests an audience for a new note; it never changes an existing one.
  const chooseCategory = (id: string) => setDraft((current) => withNoteCategory(current, id || null, categories, !note));
  const toggleTeam = (id: string) => setDraft((current) => toggleNoteTeam(current, id));

  const invalid = validatePlanNoteDraft(draft) !== null;
  const archivedCategory = noteCategoryLabel(categoryId, categories).kind === 'unavailable';
  const chosenTeams = noteTeamNames(teamIds, teams);
  const audienceDetail = audience === 'teams'
    ? chosenTeams.length ? t('noteEditor.audienceDetail.teams', { teams: chosenTeams.join(', ') }) : t('noteEditor.audienceDetail.teamsNone')
    : t(`noteEditor.audienceDetail.${audience}`);

  return (
    <Modal open title={note ? t('noteEditor.editTitle') : itemId ? t('noteEditor.addItemTitle') : t('noteEditor.addPlanTitle')} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label className="block">
          <span className="label">{t('noteEditor.category')}</span>
          <select className="input" value={categoryId ?? ''} onChange={(event) => chooseCategory(event.target.value)}>
            <option value="">{t('noteEditor.general')}</option>
            {archivedCategory && categoryId && <option value={categoryId}>{t('noteEditor.categoryUnavailable')}</option>}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>

        <fieldset className="text-sm">
          <legend className="label">{t('noteEditor.whoCanRead')}</legend>
          <div className="space-y-1">
            {NOTE_AUDIENCES.map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name="audience" checked={audience === value} onChange={() => setDraft((current) => ({ ...current, audience: value }))} />
                {t(`noteEditor.audience.${value}`)}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-700 dark:text-slate-200" aria-live="polite">{audienceDetail}</p>
          <p className="mt-1 text-xs text-slate-500">{t('noteEditor.audienceHint')}</p>
        </fieldset>

        {audience === 'teams' && (
          <fieldset className="text-sm">
            <legend className="label">{t('noteEditor.teams')}</legend>
            <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto">
              {teams.map((team) => (
                <label key={team.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={teamIds.includes(team.id)} onChange={() => toggleTeam(team.id)} />
                  {team.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="block">
          <span className="label">{t('noteEditor.note')}</span>
          <textarea
            className="input"
            rows={6}
            maxLength={8000}
            value={body}
            onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
            placeholder={t('noteEditor.placeholder')}
          />
        </label>

        {note?.is_legacy && (
          <p className={`rounded-lg px-3 py-2 text-xs ${planNoteLeavesSimple(note, draft) ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-500'}`}>
            {t('noteEditor.simpleNoteHint')}
          </p>
        )}
        <ErrorNotice error={save.error ?? remove.error} />
        <div className="flex items-center justify-between gap-2">
          <div>
            {note && (
              <Button
                type="button"
                variant="ghost"
                className="text-rose-600"
                loading={remove.isPending}
                onClick={() => {
                  if (window.confirm(t('noteEditor.deleteConfirm'))) remove.mutate();
                }}
              >
                {t('common:actions.delete')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
            <Button type="submit" loading={save.isPending} disabled={invalid}>{t('noteEditor.save')}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
