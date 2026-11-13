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
  /** `bubble` draws a chat bubble (own messages on the right); `list` a flat comment row. */
  variant?: 'list' | 'bubble';
  /** The signed-in person wrote this entry; only changes how a bubble is drawn. */
  mine?: boolean;
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
  variant = 'list',
  mine = false,
}: DiscussionEntryProps) => {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const errorText = useErrorText();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bubble = variant === 'bubble';
  const ownBubble = bubble && mine;
  const timeLabel = editedAt && !removedLabel ? t('entry.edited', { time: format.dateTime(createdAt) }) : format.dateTime(createdAt);

  const editor = (
    <div className="mt-1 space-y-2">
      <textarea className="input" rows={3} maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} />
      {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
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
        <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(body); }}>{t('common:actions.cancel')}</Button>
      </div>
    </div>
  );

  const mentionOutcomes = showMentionOutcomes && mentions.some((m) => isUnnotified(m.resolution)) && (
    <ul className="mt-1 space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
      {mentions.map((m) =>
        isUnnotified(m.resolution) ? (
          <li key={m.person_id}>{t('entry.mentionOutcome', { name: m.name, outcome: t(`entry.resolution.${m.resolution}`) })}</li>
        ) : null,
      )}
    </ul>
  );

  const actionRow = !editing && ((canEdit && !removedLabel) || actions.length > 0) && (
    <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-slate-500 dark:text-slate-400 ${ownBubble ? 'justify-end' : ''} ${bubble ? 'opacity-80 transition group-hover:opacity-100' : ''}`}>
      {canEdit && !removedLabel && <button type="button" className="hover:text-slate-900 hover:underline dark:hover:text-white" onClick={() => { setDraft(body); setEditing(true); }}>{t('common:actions.edit')}</button>}
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className={`hover:underline ${action.danger ? 'text-rose-600 dark:text-rose-400' : 'hover:text-slate-900 dark:hover:text-white'}`}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </div>
  );

  if (bubble) {
    return (
      <li className={`group flex gap-2.5 py-1.5 ${ownBubble ? 'flex-row-reverse' : ''}`}>
        {!ownBubble && <Avatar name={authorName} size="sm" />}
        <div className={`flex min-w-0 max-w-[85%] flex-col text-sm sm:max-w-[75%] ${ownBubble ? 'items-end' : 'items-start'}`}>
          <p className={`mb-0.5 flex flex-wrap items-baseline gap-x-2 px-1 ${ownBubble ? 'justify-end' : ''}`}>
            {!ownBubble && <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{authorName ?? t('common:fallback.someone')}</span>}
            <span className="text-[11px] text-slate-400">{timeLabel}</span>
          </p>
          {editing ? (
            <div className="w-full min-w-[16rem]">{editor}</div>
          ) : (
            <div
              className={`max-w-full rounded-2xl px-3.5 py-2 ${
                removedLabel
                  ? 'bg-transparent italic text-slate-400 ring-1 ring-inset ring-slate-200 dark:ring-slate-700'
                  : ownBubble
                    ? 'rounded-br-md bg-brand-600 text-white'
                    : 'rounded-bl-md bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
              }`}
            >
              {quote && (
                <p
                  className={`mb-1 border-l-2 pl-2 text-xs ${
                    ownBubble && !removedLabel ? 'border-white/40 text-white/80' : 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400'
                  }`}
                >
                  {quote}
                </p>
              )}
              <p className="whitespace-pre-wrap break-words">{removedLabel ?? body}</p>
            </div>
          )}
          {mentionOutcomes}
          {actionRow}
        </div>
      </li>
    );
  }

  return (
    <li className="flex gap-3 py-3">
      <Avatar name={authorName} size="sm" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-slate-800 dark:text-slate-100">{authorName ?? t('common:fallback.someone')}</span>
          <span className="text-xs text-slate-400">{timeLabel}</span>
        </p>
        {quote && <p className="mt-0.5 border-l-2 border-slate-200 pl-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">{quote}</p>}
        {removedLabel ? (
          <p className="italic text-slate-400">{removedLabel}</p>
        ) : editing ? (
          editor
        ) : (
          <p className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">{body}</p>
        )}
        {mentionOutcomes}
        {actionRow}
      </div>
    </li>
  );
};
