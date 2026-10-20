import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { NoteAudience, NoteCategoryRow, PlanNote, TeamWithPositions } from '@service-center/shared';
import { usePlanNotes, useTeams } from '../../hooks/queries';
import { Badge, Button, ErrorNotice, Spinner } from '../ui';
import { PlanNoteEditorModal } from './PlanNoteEditorModal';

const AUDIENCE_TONE: Record<NoteAudience, string> = {
  organization: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  scheduled: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  teams: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  leaders: 'bg-amber-50 text-amber-800 ring-amber-600/20',
};

export const audienceText = (note: PlanNote, teams: readonly TeamWithPositions[], t: TFunction<'messages'>): string => {
  if (note.audience !== 'teams') return t(`notesPanel.audienceShort.${note.audience}`);
  const names = note.team_ids.map((id) => teams.find((team) => team.id === id)?.name).filter(Boolean);
  return names.length ? names.join(', ') : t('notesPanel.audienceShort.teams');
};

export interface NoteListProps {
  notes: PlanNote[];
  categories: NoteCategoryRow[];
  teams: TeamWithPositions[];
  canEdit: boolean;
  onEdit: (note: PlanNote) => void;
}

/** Notes grouped by category, each with who can read it. */
export const NoteList = ({ notes, categories, teams, canEdit, onEdit }: NoteListProps) => {
  const { t } = useTranslation(['messages', 'common']);
  const name = (id: string | null) => categories.find((category) => category.id === id)?.name ?? t('noteEditor.general');
  return (
    <ul className="space-y-2">
      {notes.map((note) => (
        <li key={note.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-slate-700 dark:text-slate-200">{name(note.category_id)}</span>
            <Badge tone={AUDIENCE_TONE[note.audience]}>{audienceText(note, teams, t)}</Badge>
            {canEdit && (
              <button type="button" className="ml-auto text-slate-500 hover:text-brand-600 hover:underline" onClick={() => onEdit(note)}>
                {t('common:actions.edit')}
              </button>
            )}
          </div>
          <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-300">{note.body}</p>
        </li>
      ))}
    </ul>
  );
};

export interface PlanNotesPanelProps {
  planId: string;
}

/**
 * Plan-level notes the signed-in person may read (the API returns nothing
 * else). Editors add and edit; everyone else reads.
 */
export const PlanNotesPanel = ({ planId }: PlanNotesPanelProps) => {
  const { t } = useTranslation(['messages', 'common']);
  const notes = usePlanNotes(planId);
  const teams = useTeams();
  const [editing, setEditing] = useState<PlanNote | 'new' | null>(null);
  const planNotes = (notes.data?.notes ?? []).filter((note) => !note.plan_item_id);

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden="true" className="text-slate-400">🗒</span>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('notesPanel.title')}</h2>
        {notes.data?.can_edit && (
          <Button variant="ghost" className="ml-auto !px-2 !py-1 text-xs" onClick={() => setEditing('new')}>{t('common:actions.add')}</Button>
        )}
      </div>
      {notes.isLoading ? (
        <div className="flex justify-center py-3 text-slate-400"><Spinner className="size-4" /></div>
      ) : notes.error ? (
        <ErrorNotice error={notes.error} />
      ) : planNotes.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400 dark:bg-slate-900">{t('notesPanel.empty')}</p>
      ) : (
        <NoteList
          notes={planNotes}
          categories={notes.data?.categories ?? []}
          teams={teams.data ?? []}
          canEdit={notes.data?.can_edit ?? false}
          onEdit={setEditing}
        />
      )}
      {editing && notes.data && (
        <PlanNoteEditorModal
          planId={planId}
          note={editing === 'new' ? null : editing}
          planItemId={null}
          categories={notes.data.categories}
          teams={teams.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
};
