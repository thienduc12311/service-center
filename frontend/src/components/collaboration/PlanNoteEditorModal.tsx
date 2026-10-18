import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  NOTE_AUDIENCE_LABELS,
  type NoteAudience,
  type NoteCategoryRow,
  type PlanNote,
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

const AUDIENCES: NoteAudience[] = ['organization', 'scheduled', 'teams', 'leaders'];

/** Create or edit one note. Saving sends the revision it opened; a stale edit is refused. */
export const PlanNoteEditorModal = ({ planId, note, planItemId, categories, teams, onClose }: PlanNoteEditorModalProps) => {
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
    setTeamIds((current) => (current.includes(id) ? current.filter((t) => t !== id) : [...current, id]));

  const invalid = !body.trim() || (audience === 'teams' && teamIds.length === 0);

  return (
    <Modal open title={note ? 'Edit note' : itemId ? 'Add item note' : 'Add plan note'} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Category</span>
          <select className="input" value={categoryId ?? ''} onChange={(event) => chooseCategory(event.target.value)}>
            <option value="">General</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>

        <fieldset className="text-sm">
          <legend className="mb-1 font-medium text-slate-700">Who can read it</legend>
          <div className="space-y-1">
            {AUDIENCES.map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name="audience" checked={audience === value} onChange={() => setAudience(value)} />
                {NOTE_AUDIENCE_LABELS[value]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">Plan leaders can always read every note. Only “Everyone” notes appear in older apps.</p>
        </fieldset>

        {audience === 'teams' && (
          <fieldset className="text-sm">
            <legend className="mb-1 font-medium text-slate-700">Teams</legend>
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

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Note</span>
          <textarea
            className="input"
            rows={6}
            maxLength={8000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Cues, logistics or anything this audience should read."
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
                  if (window.confirm('Delete this note?')) remove.mutate();
                }}
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.isPending} disabled={invalid}>Save note</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
