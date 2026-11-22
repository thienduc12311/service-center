import { useId, useRef, useState, type FormEvent, type Ref } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  keyedPlanItemRequest,
  parseQuickAddLine,
  quickAddRequest,
  type CreatePlanItemRequest,
  type QuickAddProblem,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { ErrorNotice } from '../ui';
import { Icon } from '../icons';

export interface QuickAddLineProps {
  planId: string;
  /** The text field, so the order tab's "N" shortcut can focus it. */
  inputRef: Ref<HTMLInputElement>;
}

/**
 * One line at the end of the order: "Welcome 3:00" + Enter adds an item with
 * that length, "# Worship" adds a header. Focus stays in the field for the
 * next one. Uses the normal add endpoint with an idempotency key, so a retry
 * after a lost response does not add the item twice.
 */
export const QuickAddLine = ({ planId, inputRef }: QuickAddLineProps) => {
  const { t } = useTranslation('plans');
  const invalidate = useInvalidateOrg();
  const helpId = useId();
  const problemId = useId();
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<QuickAddProblem | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  // The last unanswered add: the same line sent again reuses its key.
  const pending = useRef<CreatePlanItemRequest | null>(null);

  const add = useMutation({
    mutationFn: (body: CreatePlanItemRequest) => {
      const keyed = keyedPlanItemRequest(body, pending.current, () => crypto.randomUUID());
      pending.current = keyed;
      return api.addPlanItem(planId, keyed);
    },
    onSuccess: async (item) => {
      pending.current = null;
      setValue('');
      setLastAdded(item.title);
      await invalidate();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (add.isPending) return;
    const parsed = parseQuickAddLine(value);
    if (!parsed.ok) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    setLastAdded(null);
    add.mutate(quickAddRequest(parsed.entry));
  };

  return (
    <form onSubmit={submit} className="border-t border-app-border px-4 py-3">
      <label htmlFor={`${helpId}-input`} className="sr-only">
        {t('quickAdd.label')}
      </label>
      <div className="flex items-center gap-2">
        <Icon name="plus" className="size-4 shrink-0 text-slate-400" />
        <input
          id={`${helpId}-input`}
          ref={inputRef}
          className="input h-9 flex-1 py-1"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (problem) setProblem(null);
          }}
          placeholder={t('quickAdd.placeholder')}
          aria-describedby={problem ? `${problemId} ${helpId}` : helpId}
          aria-invalid={problem ? true : undefined}
          aria-busy={add.isPending}
          maxLength={260}
          autoComplete="off"
          enterKeyHint="enter"
        />
      </div>
      <p id={helpId} className="mt-1 pl-6 text-xs text-slate-500 dark:text-slate-400">
        {t('quickAdd.help')}
      </p>
      {problem && (
        <p id={problemId} role="alert" className="mt-1 pl-6 text-xs text-rose-600 dark:text-rose-400">
          {t(`quickAdd.errors.${problem}`)}
        </p>
      )}
      <p role="status" className="sr-only">
        {lastAdded ? t('quickAdd.added', { title: lastAdded }) : ''}
      </p>
      {add.error && (
        <div className="mt-2">
          <ErrorNotice error={add.error} />
        </div>
      )}
    </form>
  );
};
