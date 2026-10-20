import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { DeliveryStatus, MessageRecipientOutcome } from '@service-center/shared';
import { api } from '../lib/api';
import { useInvalidateOrg, useMessage, useMessages, useTeams } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { useFormatters } from '../i18n';
import { Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { MessageComposerModal } from '../components/collaboration/MessageComposerModal';

const TONE: Partial<Record<DeliveryStatus, string>> = {
  failed: 'bg-red-50 text-red-700 ring-red-600/20',
  ambiguous: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  provider_accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
};
const NEUTRAL = 'bg-slate-100 text-slate-600 ring-slate-500/20';

type MessageBox = 'received' | 'sent';

/** Delivery error codes with a plain-language reason in `messages:delivery.errors`. */
const DELIVERY_ERROR_CODES = [
  'no_email_address',
  'no_active_device',
  'recipient_not_eligible',
  'scheduler_not_active',
  'plan_missing',
  'request_missing',
  'already_reviewed',
  'provider_rate_limited',
  'provider_unavailable',
  'provider_rejected',
  'provider_misconfigured',
  'provider_timeout',
  'outcome_unknown',
  'worker_lease_expired',
  'internal_error',
  'reminder_obsolete',
  'provider_duplicate_key',
  'content_removed',
  'conversation_muted',
  'channel_not_used',
] as const;

type DeliveryErrorCode = (typeof DELIVERY_ERROR_CODES)[number];

const isDeliveryErrorCode = (code: string): code is DeliveryErrorCode =>
  (DELIVERY_ERROR_CODES as readonly string[]).includes(code);

/** Messages sent to me, and (for senders) messages I sent with their outcomes. */
export const MessagesPage = () => {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const { canAnywhere, can } = useAuth();
  const isSender = canAnywhere('scheduling.manage') || canAnywhere('teams.manage');
  const [box, setBox] = useState<MessageBox>(isSender ? 'sent' : 'received');
  const [composing, setComposing] = useState(false);
  const messages = useMessages({ box });
  const teams = useTeams();
  const myTeams = (teams.data ?? []).filter((team) =>
    can('scheduling.manage', { teamId: team.id, serviceTypeId: team.service_type_id }) || can('teams.manage', { teamId: team.id, serviceTypeId: team.service_type_id }));

  return (
    <div>
      <PageHeader
        title={t('messagesPage.title')}
        subtitle={t('messagesPage.subtitle')}
        actions={isSender && <Button onClick={() => setComposing(true)}>{t('messagesPage.compose')}</Button>}
      />
      {isSender && (
        <div className="mb-4 flex gap-4 border-b border-slate-200 text-sm dark:border-slate-800">
          {(['sent', 'received'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-current={box === value ? 'page' : undefined}
              onClick={() => setBox(value)}
              className={`-mb-px border-b-2 px-1 pb-2 font-medium ${box === value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500'}`}
            >
              {t(`messagesPage.tabs.${value}`)}
            </button>
          ))}
        </div>
      )}
      {messages.isLoading ? (
        <Loading />
      ) : messages.error ? (
        <ErrorNotice error={messages.error} />
      ) : (messages.data ?? []).length === 0 ? (
        <EmptyState title={box === 'sent' ? t('messagesPage.empty.sentTitle') : t('messagesPage.empty.receivedTitle')} description={box === 'sent' ? t('messagesPage.empty.sentDescription') : undefined} />
      ) : (
        <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
          {(messages.data ?? []).map((message) => (
            <li key={message.id}>
              <Link to={`/messages/${message.id}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900">
                <span className="font-medium">{message.subject}</span>
                <span className="text-xs text-slate-500">
                  {t('messagesPage.listMeta', {
                    summary: message.sent_by_me
                      ? t('messagesPage.recipients', { count: message.recipient_count })
                      : message.sender_name
                        ? t('messagesPage.from', { name: message.sender_name })
                        : t('messagesPage.fromUnknown'),
                    date: format.dateTime(message.created_at),
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {composing && <MessageComposerModal plan={null} teams={myTeams} onClose={() => setComposing(false)} />}
    </div>
  );
};

interface OutcomeRowProps {
  outcome: MessageRecipientOutcome;
}

/** Plain-language reason for a delivery error code; unknown codes show as-is. */
const deliveryErrorText = (code: string | null, t: TFunction<'messages'>): string | undefined =>
  code ? (isDeliveryErrorCode(code) ? t(`delivery.errors.${code}`) : code) : undefined;

const OutcomeRow = ({ outcome }: OutcomeRowProps) => {
  const { t } = useTranslation('messages');
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
      <div>
        <p className="font-medium">{[outcome.first_name, outcome.last_name].filter(Boolean).join(' ')}</p>
        <p className="text-xs text-slate-500">{outcome.reasons.map((reason) => t(`audienceReasons.${reason}`)).join(' · ')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {outcome.status === 'excluded_no_address' && <Badge tone={NEUTRAL}>{t('messageDetail.notSentNoAddress')}</Badge>}
        {outcome.status === 'excluded_by_sender' && <Badge tone={NEUTRAL}>{t('messageDetail.removedBeforeSending')}</Badge>}
        {outcome.channels.map((channel) => (
          <Badge key={channel.delivery_id} tone={TONE[channel.status] ?? NEUTRAL}>
            <span title={deliveryErrorText(channel.error_code, t)}>
              {t('messageDetail.channelStatus', { channel: t(`delivery.channels.${channel.channel}`), status: t(`delivery.status.${channel.status}`) })}
            </span>
          </Badge>
        ))}
      </div>
    </li>
  );
};

export const MessageDetailPage = () => {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const { messageId } = useParams<{ messageId: string }>();
  const message = useMessage(messageId);
  const invalidate = useInvalidateOrg();
  const retry = useMutation({ mutationFn: () => api.retryMessage(messageId!), onSuccess: invalidate });

  if (message.isLoading) return <Loading />;
  if (message.error) {
    return <EmptyState title={t('messageDetail.notAvailableTitle')} description={t('messageDetail.notAvailableDescription')} />;
  }
  if (!message.data) return null;
  const { message: row, sender_name, outcomes, can_retry, rendered_for_me } = message.data;
  const failed = (outcomes ?? []).filter((o) => o.retryable).length;

  return (
    <div className="max-w-3xl">
      <Link to="/messages" className="text-sm text-slate-500 hover:underline">{t('messageDetail.back')}</Link>
      <h1 className="mt-2 text-xl font-semibold">{rendered_for_me?.subject ?? row.subject}</h1>
      <p className="text-sm text-slate-500">
        {sender_name
          ? t('messageDetail.fromLine', { name: sender_name, date: format.dateTime(row.created_at) })
          : t('messageDetail.fromLineUnknown', { date: format.dateTime(row.created_at) })}
      </p>
      <div className="card mt-4 whitespace-pre-wrap p-4 text-sm">{rendered_for_me?.body ?? row.body}</div>
      {!rendered_for_me && /\{\{/.test(`${row.subject}${row.body}`) && (
        <p className="mt-1 text-xs text-slate-500">{t('messageDetail.variablesNote')}</p>
      )}

      {outcomes && (
        <section className="mt-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">
              {row.excluded_count
                ? t('messageDetail.recipientsHeadingWithExcluded', { included: row.recipient_count, excluded: row.excluded_count })
                : t('messageDetail.recipientsHeading', { included: row.recipient_count })}
            </h2>
            {can_retry && (
              <Button variant="secondary" loading={retry.isPending} onClick={() => retry.mutate()}>
                {t('messageDetail.retry', { count: failed })}
              </Button>
            )}
          </div>
          {retry.isSuccess && <p role="status" className="mb-2 text-sm text-slate-600">{t('messageDetail.requeued', { count: retry.data.requeued })}</p>}
          <ErrorNotice error={retry.error} />
          <p className="mb-2 text-xs text-slate-500">{t('messageDetail.simulatedNote')}</p>
          <ul className="card divide-y divide-slate-100 px-4 dark:divide-slate-800">
            {outcomes.map((outcome) => <OutcomeRow key={outcome.person_id} outcome={outcome} />)}
          </ul>
        </section>
      )}
    </div>
  );
};
