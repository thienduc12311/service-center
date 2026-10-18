import { useRef, useState } from 'react';
import type { MentionCandidate } from '@service-center/shared';
import { Button, ErrorNotice } from '../ui';

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
        <p className="flex items-center gap-2 text-xs text-slate-500">
          {context}
          {onClearContext && (
            <button type="button" className="hover:underline" onClick={onClearContext}>Cancel</button>
          )}
        </p>
      )}
      <textarea
        className="input"
        rows={3}
        maxLength={4000}
        value={body}
        placeholder={placeholder}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {mentionIds.length > 0 && (
        <ul className="flex flex-wrap gap-1 text-xs" aria-label="Will be notified">
          {mentionIds.map((id) => (
            <li key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">
              @{candidates.find((candidate) => candidate.person_id === id)?.name ?? 'Someone'}
              <button
                type="button"
                aria-label="Remove mention"
                onClick={() => setMentionIds((current) => current.filter((value) => value !== id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNotice error={error ? new Error(`Not sent: ${error instanceof Error ? error.message : 'try again'}. Your text is kept; sending again will not post twice.`) : null} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          className="input !w-auto text-sm"
          value=""
          aria-label="Mention someone"
          disabled={candidates.length === 0}
          onChange={(event) => mention(event.target.value)}
        >
          <option value="">{candidates.length ? '@ Mention…' : 'No one else to mention'}</option>
          {candidates.map((candidate) => (
            <option key={candidate.person_id} value={candidate.person_id}>{candidate.name}</option>
          ))}
        </select>
        <Button type="submit" loading={sending} disabled={!body.trim()}>{error ? 'Retry' : submitLabel}</Button>
      </div>
    </form>
  );
};
