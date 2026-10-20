import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { NoteAudience, NoteCategoryRow, PlanNote, TeamWithPositions } from '@service-center/shared';
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

const AUDIENCES: NoteAudience[] = ['organization', 'scheduled', 'teams', 'leaders'];

/** Create or edit one note. Saving sends the revision it opened; a stale edit is refused. */
export const PlanNoteEditorModal = ({ planId, note, planItemId, categories, teams, onClose }: PlanNoteEditorModalProps) => {
  const { t } = useTranslation(['messages', 'common']);
  const invalidate = useInvalidateOrg();
  const [categoryId, setCategoryId] = useState<string | null>(note?.category_id ?? null);
  const [audience, setAudience] = useState<NoteAudience>(note?.audience ?? 'organization');
  const [teamIds, setTeamIds] = useState<string[]>(note?.team_ids ?? []);
  const [body, setBody] = useState(note?.body ?? '');
  const itemId = note ? note.plan_item_id : planItemId;

  const save = useMutation({
    mutationFn: () => {
      const input = { plan_item_id: itemId, category_id: categoryId, audience, team_ids: teamIds, body };
      return note
        ? api.updatePlanNote(planId, note.id, { ...input, expected_revision: note.revision })
        : api.createPlanNote(planId, input);
    },
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

  const chooseCategory = (id: string) => {
    const next = id || null;
    setCategoryId(next);
    const category = categories.find((c) => c.id === next);
    // A category suggests an audience for a new note; it never changes an existing one.
    if (!note && category) setAudience(category.default_audience);
  };

  const toggleTeam = (id: string) =>
    setTeamIds((current) => (current.includes(id) ? current.filter((teamId) => teamId !== id) : [...current, id]));

  const invalid = !body.trim() || (audience === 'teams' && teamIds.length === 0);

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
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>

        <fieldset className="text-sm">
          <legend className="label">{t('noteEditor.whoCanRead')}</legend>
          <div className="space-y-1">
            {AUDIENCES.map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name="audience" checked={audience === value} onChange={() => setAudience(value)} />
                {t(`noteEditor.audience.${value}`)}
              </label>
            ))}
          </div>
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
            onChange={(event) => setBody(event.target.value)}
            placeholder={t('noteEditor.placeholder')}
          />
        </label>

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
