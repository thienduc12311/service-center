import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { planNotesFor, type PlanItemComment, type PlanItemDetail, type PlanNote } from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useItemComments, useMentionCandidates, usePlanNotes, useTeams } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Loading, Modal } from '../ui';
import { DiscussionComposer } from './DiscussionComposer';
import { DiscussionEntry } from './DiscussionEntry';
import { NoteList } from './PlanNotesPanel';
import { PlanNoteEditorModal } from './PlanNoteEditorModal';

export interface ItemDiscussionModalProps {
  planId: string;
  item: PlanItemDetail;
  onClose: () => void;
}

/**
 * One item's notes (only those the reader may see) and its discussion
 * thread. The thread is open to plan leaders and people scheduled on the
 * plan; anyone else gets an explicit "not available" state.
 */
export const ItemDiscussionModal = ({ planId, item, onClose }: ItemDiscussionModalProps) => {
  const { t } = useTranslation(['messages', 'common']);
  const { organizationId } = useAuth();
  const client = useQueryClient();
  const notes = usePlanNotes(planId);
  const teams = useTeams();
  const thread = useItemComments(item.id);
  const candidates = useMentionCandidates(thread.data ? { plan_id: planId } : null);
  const [older, setOlder] = useState<PlanItemComment[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [editingNote, setEditingNote] = useState<PlanNote | 'new' | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: keys.itemComments(organizationId, item.id) });
  const itemNotes = planNotesFor(notes.data?.notes ?? [], item.id);
  const cursor = olderCursor === undefined ? thread.data?.next_before ?? null : olderCursor;

  const loadOlder = useMutation({
    mutationFn: () => api.itemComments(item.id, { before: cursor ?? undefined, limit: 50 }),
    onSuccess: (page) => {
      setOlder((current) => [...page.data, ...current]);
      setOlderCursor(page.next_before);
    },
  });
  const remove = useMutation({
    mutationFn: (comment: PlanItemComment) => api.deleteItemComment(item.id, comment.id),
    onSuccess: refresh,
  });

  const comments = [...older, ...(thread.data?.data ?? [])];
  const unavailable = thread.error && /only open|not found/i.test(thread.error.message);

  return (
    <Modal open title={t('itemDiscussion.title', { item: item.title })} onClose={onClose} size="wide">
      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-700">{t('itemDiscussion.itemNotes')}</h3>
          {notes.data?.can_edit && (
            <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setEditingNote('new')}>{t('itemDiscussion.addNote')}</Button>
          )}
        </div>
        {itemNotes.length === 0 ? (
          <p className="text-xs text-slate-400">{t('itemDiscussion.noItemNotes')}</p>
        ) : (
          <NoteList
            notes={itemNotes}
            categories={notes.data?.categories ?? []}
            teams={teams.data ?? []}
            canEdit={notes.data?.can_edit ?? false}
            onEdit={setEditingNote}
          />
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium text-slate-700">{t('itemDiscussion.discussion')}</h3>
        {thread.isLoading ? (
          <Loading />
        ) : unavailable ? (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">
            {t('itemDiscussion.unavailable')}
          </p>
        ) : thread.error ? (
          <div className="space-y-2">
            <ErrorNotice error={thread.error} />
            <Button variant="secondary" onClick={() => thread.refetch()}>{t('common:actions.retry')}</Button>
          </div>
        ) : (
          <>
            {cursor && (
              <Button variant="ghost" className="mb-2 text-xs" loading={loadOlder.isPending} onClick={() => loadOlder.mutate()}>
                {t('itemDiscussion.showOlder')}
              </Button>
            )}
            {comments.length === 0 ? (
              <p className="mb-3 text-sm text-slate-400">{t('itemDiscussion.noComments')}</p>
            ) : (
              <ul className="mb-3 divide-y divide-slate-100 dark:divide-slate-800">
                {comments.map((comment) => (
                  <DiscussionEntry
                    key={comment.id}
                    authorName={comment.author_name}
                    body={comment.body}
                    createdAt={comment.created_at}
                    editedAt={comment.edited_at}
                    removedLabel={comment.deleted_at ? t('itemDiscussion.commentDeleted') : null}
                    mentions={comment.mentions}
                    showMentionOutcomes={comment.is_mine}
                    canEdit={comment.is_mine}
                    onSaveEdit={async (body) => {
                      await api.editItemComment(item.id, comment.id, { body });
                      await refresh();
                    }}
                    actions={
                      !comment.deleted_at && (comment.is_mine || thread.data?.can_moderate)
                        ? [{
                            label: t('common:actions.delete'),
                            danger: true,
                            onClick: () => {
                              if (window.confirm(t('itemDiscussion.deleteConfirm'))) remove.mutate(comment);
                            },
                          }]
                        : []
                    }
                  />
                ))}
              </ul>
            )}
            <ErrorNotice error={remove.error ?? loadOlder.error} />
            <DiscussionComposer
              candidates={candidates.data ?? []}
              placeholder={t('itemDiscussion.placeholder')}
              submitLabel={t('itemDiscussion.submit')}
              onSubmit={async ({ id, body, mentionIds }) => {
                await api.postItemComment(item.id, { id, body, mention_person_ids: mentionIds });
                await refresh();
              }}
            />
            <p className="mt-2 text-xs text-slate-400">{t('itemDiscussion.mentionNote')}</p>
          </>
        )}
      </section>

      {editingNote && notes.data && (
        <PlanNoteEditorModal
          planId={planId}
          note={editingNote === 'new' ? null : editingNote}
          planItemId={item.id}
          categories={notes.data.categories}
          teams={teams.data ?? []}
          onClose={() => setEditingNote(null)}
        />
      )}
    </Modal>
  );
};
