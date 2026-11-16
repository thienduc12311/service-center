import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CHURCH_JOIN_TEXT_MAX,
  churchJoinView,
  churchSlugFromInput,
  isChurchSlug,
  type ChurchLookup,
  type CreateChurchJoinRequestRequest,
  type MyChurchJoinRequest,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { accountKeys, useMyChurchJoinRequests } from '../../hooks/queries';
import { useFormatters } from '../../i18n/useFormatters';
import { Button, ErrorNotice, Loading, Notice } from '../ui';

/**
 * The requester's side of joining an existing church by its slug: find the
 * church, confirm it and send a request; then the pending request (withdraw
 * it), a decline with its reason, or an approval (the invitation is on its
 * way by email). See supabase/migrations/20261117000000_church_join_requests.sql.
 */
export const ChurchJoinPanel = () => {
  const { t } = useTranslation(['settings', 'common']);
  const { date } = useFormatters();
  const queryClient = useQueryClient();
  const requests = useMyChurchJoinRequests();
  // "Try another church" after a decision shows the form over it.
  const [askingAnother, setAskingAnother] = useState(false);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: accountKeys.churchJoinRequests });
  };

  const withdraw = useMutation({
    mutationFn: (request: MyChurchJoinRequest) => api.withdrawChurchJoinRequest(request.id),
    onSuccess: refresh,
  });

  if (requests.isLoading) return <Loading />;
  if (requests.error) return <ErrorNotice error={requests.error} />;

  const list = requests.data ?? [];
  const view = churchJoinView(list);

  if (view.kind === 'pending') {
    const { request } = view;
    return (
      <div className="space-y-4">
        <Notice tone="info">
          <p className="font-medium">{t('churchJoin.pending.title')}</p>
          <p className="mt-1">
            {t('churchJoin.pending.body', { church: request.organization_name, date: date(request.created_at) })}
          </p>
        </Notice>
        <ErrorNotice error={withdraw.error} />
        <Button
          variant="secondary"
          loading={withdraw.isPending}
          onClick={() => {
            if (window.confirm(t('churchJoin.pending.withdrawConfirm', { church: request.organization_name }))) {
              withdraw.mutate(request);
            }
          }}
        >
          {t('churchJoin.pending.withdraw')}
        </Button>
      </div>
    );
  }

  if (view.kind === 'declined' && !askingAnother) {
    const { request } = view;
    return (
      <div className="space-y-4">
        <Notice tone="warning">
          <p className="font-medium">{t('churchJoin.declined.title')}</p>
          <p className="mt-1">{t('churchJoin.declined.body', { church: request.organization_name })}</p>
          {request.decline_reason && (
            <p className="mt-1">{t('churchJoin.declined.reason', { reason: request.decline_reason })}</p>
          )}
        </Notice>
        <Button onClick={() => setAskingAnother(true)}>{t('churchJoin.declined.tryAnother')}</Button>
      </div>
    );
  }

  if (view.kind === 'approved' && !askingAnother) {
    const { request } = view;
    return (
      <div className="space-y-4">
        <Notice tone="success">
          <p className="font-medium">{t('churchJoin.approved.title')}</p>
          <p className="mt-1">{t('churchJoin.approved.body', { church: request.organization_name })}</p>
        </Notice>
        <Button variant="secondary" onClick={() => setAskingAnother(true)}>
          {t('churchJoin.approved.tryAnother')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {view.kind === 'form' && list[0]?.status === 'withdrawn' && (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('churchJoin.withdrawn')}</p>
      )}
      <JoinChurchForm
        onSent={async () => {
          setAskingAnother(false);
          await refresh();
        }}
        onCancel={askingAnother ? () => setAskingAnother(false) : undefined}
      />
    </div>
  );
};

export interface JoinChurchFormProps {
  /** The request was created. */
  onSent: () => Promise<void>;
  /** Back to the decision shown before "Try another church". */
  onCancel?: () => void;
}

/** Slug → church name to confirm → optional message → request. */
export const JoinChurchForm = ({ onSent, onCancel }: JoinChurchFormProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const [input, setInput] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [church, setChurch] = useState<ChurchLookup | null>(null);
  const [message, setMessage] = useState('');

  const find = useMutation({ mutationFn: (slug: string) => api.findChurchBySlug(slug), onSuccess: setChurch });
  const send = useMutation({
    mutationFn: (body: CreateChurchJoinRequestRequest) => api.requestToJoinChurch(body),
    onSuccess: onSent,
  });

  const submitFind = (event: FormEvent) => {
    event.preventDefault();
    const slug = churchSlugFromInput(input);
    if (!isChurchSlug(slug)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    find.mutate(slug);
  };

  const submitRequest = (event: FormEvent) => {
    event.preventDefault();
    if (church) send.mutate({ slug: church.slug, message: message.trim() || null });
  };

  if (church) {
    return (
      <form onSubmit={submitRequest} className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200 dark:bg-slate-800/50 dark:ring-slate-700">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('churchJoin.confirmTitle')}
          </p>
          <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{church.name}</p>
          <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{church.slug}</p>
        </div>
        <div>
          <label className="label" htmlFor="church-join-message">
            {t('common:format.fieldOptional', { label: t('churchJoin.messageLabel') })}
          </label>
          <textarea
            id="church-join-message"
            className="input min-h-24"
            value={message}
            maxLength={CHURCH_JOIN_TEXT_MAX}
            placeholder={t('churchJoin.messagePlaceholder')}
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>
        <ErrorNotice error={send.error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={send.isPending}>
            {t('churchJoin.send')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={send.isPending}
            onClick={() => {
              setChurch(null);
              send.reset();
            }}
          >
            {t('churchJoin.notThisOne')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitFind} className="space-y-4" noValidate>
      <p className="text-sm text-slate-600 dark:text-slate-300">{t('churchJoin.intro')}</p>
      <div>
        <label className="label" htmlFor="church-join-slug">
          {t('churchJoin.slugLabel')}
        </label>
        <input
          id="church-join-slug"
          className="input h-11 font-mono"
          value={input}
          placeholder={t('churchJoin.slugPlaceholder')}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby="church-join-slug-hint"
          onChange={(event) => {
            setInput(event.target.value);
            setInvalid(false);
            find.reset();
          }}
        />
        <p id="church-join-slug-hint" className={`mt-1.5 text-xs ${invalid ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
          {invalid ? t('churchJoin.slugInvalid') : t('churchJoin.slugHint')}
        </p>
      </div>
      <ErrorNotice error={find.error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" icon="search" loading={find.isPending} disabled={!input.trim()}>
          {t('churchJoin.find')}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common:actions.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
};
