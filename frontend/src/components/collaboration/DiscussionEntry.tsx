import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiscussionMention } from '@service-center/shared';
import { useErrorText, useFormatters } from '../../i18n';
import { Avatar, Button } from '../ui';

/** Mention outcomes worth telling the author about (everything but `notified`). */
type UnnotifiedResolution = Exclude<DiscussionMention['resolution'], 'notified'>;

const isUnnotified = (resolution: DiscussionMention['resolution']): resolution is UnnotifiedResolution =>
  resolution !== 'notified';

/** One button under an entry (reply, report, delete…); labels arrive translated. */
export interface DiscussionEntryAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export interface DiscussionEntryProps {
  authorName: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** Text for a removed entry, e.g. "Comment deleted". Null when live. */
  removedLabel: string | null;
  mentions: DiscussionMention[];
  /** Shown to the author only, so they know who was not told. */
  showMentionOutcomes: boolean;
  quote?: string | null;
  /** The author may edit (only while the entry is live). */
  canEdit: boolean;
  onSaveEdit?: (body: string) => Promise<unknown>;
  /** Shown even on a removed entry, so a moderator can restore it. */
  actions?: DiscussionEntryAction[];
}

/** One comment or chat message: author, time, text, mentions and actions. */
export const DiscussionEntry = ({
  authorName,
  body,
  createdAt,
  editedAt,
  removedLabel,
  mentions,
  showMentionOutcomes,
  quote,
  canEdit,
  onSaveEdit,
  actions = [],
}: DiscussionEntryProps) => {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const errorText = useErrorText();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex gap-3 py-2">
      <Avatar name={authorName} size="sm" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-slate-800 dark:text-slate-100">{authorName ?? t('common:fallback.someone')}</span>
          <span className="text-xs text-slate-400">{editedAt && !removedLabel ? t('entry.edited', { time: format.dateTime(createdAt) }) : format.dateTime(createdAt)}</span>
        </p>
        {quote && <p className="mt-0.5 border-l-2 border-slate-200 pl-2 text-xs text-slate-500">{quote}</p>}
        {removedLabel ? (
          <p className="italic text-slate-400">{removedLabel}</p>
        ) : editing ? (
          <div className="mt-1 space-y-2">
            <textarea className="input" rows={3} maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} />
            {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="!py-1 text-xs"
                loading={saving}
                disabled={!draft.trim()}
                onClick={async () => {
                  if (!onSaveEdit) return;
                  setSaving(true);
                  setError(null);
                  try {
                    await onSaveEdit(draft.trim());
                    setEditing(false);
                  } catch (failure) {
                    setError(errorText(failure));
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {t('common:actions.save')}
              </Button>
              <Button variant="ghost" className="!py-1 text-xs" onClick={() => { setEditing(false); setDraft(body); }}>{t('common:actions.cancel')}</Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">{body}</p>
        )}
        {showMentionOutcomes && mentions.some((m) => isUnnotified(m.resolution)) && (
          <ul className="mt-1 space-y-0.5 text-xs text-amber-700">
            {mentions.map((m) =>
              isUnnotified(m.resolution) ? (
                <li key={m.person_id}>{t('entry.mentionOutcome', { name: m.name, outcome: t(`entry.resolution.${m.resolution}`) })}</li>
              ) : null,
            )}
          </ul>
        )}
        {!editing && ((canEdit && !removedLabel) || actions.length > 0) && (
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
            {canEdit && !removedLabel && <button type="button" className="hover:underline" onClick={() => { setDraft(body); setEditing(true); }}>{t('common:actions.edit')}</button>}
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={`hover:underline ${action.danger ? 'text-rose-600' : ''}`}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
};
