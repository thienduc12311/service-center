import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LocalizedError, type MentionCandidate } from '@service-center/shared';
import { useErrorText } from '../../i18n';
import { Button, ErrorNotice } from '../ui';
import { Icon } from '../icons';

export interface DiscussionSubmission {
  /** Stable for this draft: a retry after a lost response reuses it. */
  id: string;
  body: string;
  mentionIds: string[];
}

export interface DiscussionComposerProps {
  candidates: MentionCandidate[];
  placeholder: string;
  submitLabel: string;
  onSubmit: (submission: DiscussionSubmission) => Promise<unknown>;
  /** Shown above the box, e.g. "Replying to Sam". */
  context?: string | null;
  onClearContext?: () => void;
}

/**
 * Text box with explicit mentions. The draft keeps one client id until the
 * server confirms it, so pressing Send again after a timeout cannot post a
 * second copy. The draft survives a failed send.
 */
export const DiscussionComposer = ({
  candidates,
  placeholder,
  submitLabel,
  onSubmit,
  context,
  onClearContext,
}: DiscussionComposerProps) => {
  const { t } = useTranslation(['messages', 'common']);
  const errorText = useErrorText();
  const draftId = useRef<string>(crypto.randomUUID());
  const [body, setBody] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const mention = (personId: string) => {
    const person = candidates.find((candidate) => candidate.person_id === personId);
    if (!person || mentionIds.includes(personId)) return;
    setMentionIds((current) => [...current, personId]);
    setBody((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${person.name} `);
  };

  const submit = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSubmit({ id: draftId.current, body: body.trim(), mentionIds });
      draftId.current = crypto.randomUUID();
      setBody('');
      setMentionIds([]);
      onClearContext?.();
    } catch (failure) {
      setError(failure);
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {context && (
        <p className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-xs text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">
          <span className="min-w-0 flex-1 truncate">{context}</span>
          {onClearContext && (
            <button type="button" className="font-medium hover:underline" onClick={onClearContext}>{t('common:actions.cancel')}</button>
          )}
        </p>
      )}
      <div
        className="overflow-hidden rounded-xl border bg-[var(--app-field)] transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100 dark:focus-within:ring-brand-500/20"
        style={{ borderColor: 'var(--app-border-strong)' }}
      >
        <textarea
          className="block w-full resize-none border-0 bg-transparent px-3.5 pt-3 pb-1 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
          rows={2}
          maxLength={4000}
          value={body}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {mentionIds.length > 0 && (
          <ul className="flex flex-wrap gap-1 px-3 pb-1 text-xs" aria-label={t('composer.mentionsLabel')}>
            {mentionIds.map((id) => (
              <li key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pr-1 pl-2 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
                @{candidates.find((candidate) => candidate.person_id === id)?.name ?? t('common:fallback.someone')}
                <button
                  type="button"
                  className="grid size-4 place-items-center rounded-full hover:bg-brand-100 dark:hover:bg-brand-500/25"
                  aria-label={t('composer.removeMention')}
                  onClick={() => setMentionIds((current) => current.filter((value) => value !== id))}
                >
                  <Icon name="close" className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
          <select
            className="h-8 max-w-[60%] cursor-pointer rounded-lg border-0 bg-transparent px-2 text-xs font-medium text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
            value=""
            aria-label={t('composer.mentionLabel')}
            disabled={candidates.length === 0}
            onChange={(event) => mention(event.target.value)}
          >
            <option value="">{candidates.length ? t('composer.mentionPrompt') : t('composer.noOneToMention')}</option>
            {candidates.map((candidate) => (
              <option key={candidate.person_id} value={candidate.person_id}>{candidate.name}</option>
            ))}
          </select>
          <Button type="submit" size="sm" icon={error ? undefined : 'chevronRight'} loading={sending} disabled={!body.trim()}>
            {error ? t('common:actions.retry') : submitLabel}
          </Button>
        </div>
      </div>
      <ErrorNotice error={error ? new LocalizedError({ key: 'messages:composer.notSent', values: { reason: errorText(error) } }) : null} />
    </form>
  );
};
