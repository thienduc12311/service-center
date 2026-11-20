import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  MENTION_PICKER_ROWS,
  filterMentionCandidates,
  activeMentionQuery,
  insertMention,
  resolveMentionIds,
  splitMentions,
  type MentionCandidate,
} from '@service-center/shared';
import { useErrorText } from '../../i18n';
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
  onSubmit: (submission: DiscussionSubmission) => void | Promise<void>;
  /** Shown above the box, e.g. "Replying to Sam". */
  context?: string | null;
  onClearContext?: () => void;
}

/** Box and highlight layer share these so their text wraps identically. */
const TEXT_BOX = 'block w-full whitespace-pre-wrap break-words px-3.5 pt-3 pb-1 text-sm';
/** Height of one picker row (px), for capping the list at `MENTION_PICKER_ROWS`. */
const PICKER_ROW_PX = 36;

/**
 * Text box with `@` mentions: typing `@` (or the `@` button) opens a picker
 * filtered by what follows, and picked names are highlighted in place. Enter
 * sends, Shift+Enter adds a line. Only picks whose `@Name` is still intact at
 * send time are mentioned. The draft keeps one client id until its submission
 * succeeds or the caller takes ownership of it.
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
  const pickerId = useId();
  const draftId = useRef<string>(crypto.randomUUID());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  /** Caret to restore after the next render (a pick or `@` changes the text). */
  const pendingCaret = useRef<number | null>(null);
  const [body, setBody] = useState('');
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<MentionCandidate[]>([]);
  const [active, setActive] = useState(0);
  /** `@` position the reader closed the picker for (Esc); it reopens for another `@`. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const query = activeMentionQuery(body, caret, picked);
  const matches = query ? filterMentionCandidates(candidates, query.query) : [];
  const pickerOpen = query !== null && query.start !== dismissedAt && (matches.length > 0 || query.query === '');
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0));
  const activeMatch = pickerOpen ? matches[activeIndex] : undefined;

  useLayoutEffect(() => {
    if (pendingCaret.current === null || !textarea.current) return;
    textarea.current.focus();
    textarea.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  /** New caret: a different (or no) `@` forgets an earlier Esc. */
  const moveCaret = (text: string, nextCaret: number) => {
    setCaret(nextCaret);
    if (activeMentionQuery(text, nextCaret, picked)?.start !== dismissedAt) setDismissedAt(null);
  };

  const edit = (text: string, nextCaret: number) => {
    setBody(text);
    moveCaret(text, nextCaret);
    setActive(0);
  };

  const pick = (candidate: MentionCandidate) => {
    if (!query) return;
    const next = insertMention(body, query, candidate.name);
    setPicked((current) => current.some((person) => person.person_id === candidate.person_id) ? current : [...current, candidate]);
    pendingCaret.current = next.caret;
    edit(next.text, next.caret);
  };

  /** Types `@` at the caret (after a space when needed) so the picker opens. */
  const startMention = () => {
    const at = textarea.current?.selectionStart ?? body.length;
    const end = textarea.current?.selectionEnd ?? at;
    const before = body.slice(0, at);
    const inserted = before === '' || /\s$/.test(before) ? '@' : ' @';
    pendingCaret.current = at + inserted.length;
    edit(`${before}${inserted}${body.slice(end)}`, at + inserted.length);
  };

  const submit = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    setError(null);
    const text = body.trim();
    try {
      const result = onSubmit({ id: draftId.current, body: text, mentionIds: resolveMentionIds(text, picked) });
      if (result) await result;
      draftId.current = crypto.randomUUID();
      edit('', 0);
      setPicked([]);
      onClearContext?.();
      if (!result) textarea.current?.focus();
    } catch (failure) {
      setError(failure);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // An IME (e.g. a Vietnamese keyboard) uses Enter to finish a character.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (query && pickerOpen && event.key === 'Escape') {
      event.preventDefault();
      setDismissedAt(query.start);
      return;
    }
    if (activeMatch) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((activeIndex + step + matches.length) % matches.length);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        event.preventDefault();
        pick(activeMatch);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const syncCaret = () => moveCaret(body, textarea.current?.selectionStart ?? 0);
  const optionId = (personId: string) => `${pickerId}-${personId}`;

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
      <div className="relative">
        {pickerOpen && (
          <ul
            id={pickerId}
            role="listbox"
            aria-label={t('composer.mentionLabel')}
            className="absolute bottom-full left-0 z-20 mb-1 w-64 max-w-full overflow-y-auto rounded-xl border bg-[var(--app-surface)] py-1 text-sm shadow-lg"
            style={{ borderColor: 'var(--app-border-strong)', maxHeight: PICKER_ROW_PX * MENTION_PICKER_ROWS + 8 }}
          >
            {matches.length === 0 ? (
              <li role="option" aria-disabled="true" aria-selected="false" className="px-3 py-2 text-slate-400">
                {t('composer.noOneToMention')}
              </li>
            ) : (
              matches.map((candidate, index) => (
                <li
                  key={candidate.person_id}
                  id={optionId(candidate.person_id)}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`flex cursor-pointer items-center truncate px-3 ${
                    index === activeIndex ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-100' : 'text-slate-700 dark:text-slate-200'
                  }`}
                  style={{ height: PICKER_ROW_PX }}
                  // Keep focus (and the caret) in the text box.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(candidate)}
                >
                  {candidate.name}
                </li>
              ))
            )}
          </ul>
        )}
        <div
          className="group overflow-hidden rounded-xl border bg-[var(--app-field)] transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100 dark:focus-within:ring-brand-500/20"
          style={{ borderColor: 'var(--app-border-strong)' }}
        >
          <div className="relative">
            <div ref={highlight} aria-hidden="true" className={`${TEXT_BOX} pointer-events-none absolute inset-0 overflow-hidden text-transparent`}>
              {splitMentions(body, picked).map((segment, index) =>
                segment.kind === 'mention' ? (
                  <mark key={index} className="rounded bg-brand-100 text-transparent dark:bg-brand-500/25">{segment.text}</mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )}
              {/* A trailing line break needs content to take up its line. */}
              {'​'}
            </div>
            <textarea
              ref={textarea}
              className={`${TEXT_BOX} relative resize-none border-0 bg-transparent text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100`}
              rows={2}
              maxLength={4000}
              value={body}
              placeholder={placeholder}
              aria-label={placeholder}
              aria-autocomplete="list"
              aria-controls={pickerOpen ? pickerId : undefined}
              aria-activedescendant={activeMatch ? optionId(activeMatch.person_id) : undefined}
              onChange={(event) => edit(event.target.value, event.target.selectionStart)}
              onSelect={syncCaret}
              onKeyDown={onKeyDown}
              onScroll={(event) => {
                if (highlight.current) highlight.current.scrollTop = event.currentTarget.scrollTop;
              }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className="grid size-8 place-items-center rounded-lg text-base font-semibold text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-400 dark:hover:bg-slate-800"
                aria-label={t('composer.mentionLabel')}
                title={t('composer.mentionLabel')}
                onClick={startMention}
              >
                @
              </button>
              <span className="invisible truncate text-xs text-slate-400 group-focus-within:visible">{t('composer.enterHint')}</span>
            </div>
            <Button type="submit" size="sm" icon={error ? undefined : 'chevronRight'} loading={sending} disabled={!body.trim()}>
              {error ? t('common:actions.retry') : submitLabel}
            </Button>
          </div>
        </div>
      </div>
      <ErrorNotice error={error ? new LocalizedError({ key: 'messages:composer.notSent', values: { reason: errorText(error) } }) : null} />
    </form>
  );
};
