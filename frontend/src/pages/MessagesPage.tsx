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
import { Avatar, Badge, Button, EmptyState, ErrorNotice, Notice, PageHeader, SectionHeader, SkeletonList, Tabs } from '../components/ui';
import { Icon } from '../components/icons';
import { MessageComposerModal } from '../components/collaboration/MessageComposerModal';

const TONE: Partial<Record<DeliveryStatus, string>> = {
  failed: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/25',
  ambiguous: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25',
  provider_accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25',
  delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25',
};
const NEUTRAL = 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600/40';

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

  const list = messages.data ?? [];

  return (
    <div>
      <PageHeader
        title={t('messagesPage.title')}
        subtitle={t('messagesPage.subtitle')}
        actions={isSender && <Button icon="pencil" onClick={() => setComposing(true)}>{t('messagesPage.compose')}</Button>}
      />
      {isSender && (
        <Tabs<MessageBox>
          className="mb-5"
          label={t('messagesPage.title')}
          value={box}
          onChange={setBox}
          items={(['sent', 'received'] as const).map((value) => ({ value, label: t(`messagesPage.tabs.${value}`) }))}
        />
      )}
      {messages.isLoading ? (
        <SkeletonList rows={5} />
      ) : messages.error ? (
        <ErrorNotice error={messages.error} />
      ) : list.length === 0 ? (
        <EmptyState icon="mail" title={box === 'sent' ? t('messagesPage.empty.sentTitle') : t('messagesPage.empty.receivedTitle')} description={box === 'sent' ? t('messagesPage.empty.sentDescription') : undefined} />
      ) : (
        <ul className="card row-list overflow-hidden">
          {list.map((message) => (
            <li key={message.id}>
              <Link to={`/messages/${message.id}`} className="group flex items-center gap-3 px-4 py-3.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/40">
                {message.sent_by_me ? (
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-200">
                    <Icon name="mail" className="size-4" />
                  </span>
                ) : (
                  <Avatar name={message.sender_name ?? '?'} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-200">{message.subject}</span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                    {t('messagesPage.listMeta', {
                      summary: message.sent_by_me
                        ? t('messagesPage.recipients', { count: message.recipient_count })
                        : message.sender_name
                          ? t('messagesPage.from', { name: message.sender_name })
                          : t('messagesPage.fromUnknown'),
                      date: format.dateTime(message.created_at),
                    })}
                  </span>
                </span>
                <Icon name="chevronRight" className="size-4 shrink-0 text-slate-300 transition group-hover:text-brand-500 dark:text-slate-600" />
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
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={[outcome.first_name, outcome.last_name].filter(Boolean).join(' ')} size="sm" />
        <div className="min-w-0">
        <p className="truncate font-medium text-slate-900 dark:text-white">{[outcome.first_name, outcome.last_name].filter(Boolean).join(' ')}</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{outcome.reasons.map((reason) => t(`audienceReasons.${reason}`)).join(' · ')}</p>
        </div>
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

  if (message.isLoading) return <SkeletonList rows={3} />;
  if (message.error) {
    return <EmptyState icon="mail" title={t('messageDetail.notAvailableTitle')} description={t('messageDetail.notAvailableDescription')} />;
  }
  if (!message.data) return null;
  const { message: row, sender_name, outcomes, can_retry, rendered_for_me } = message.data;
  const failed = (outcomes ?? []).filter((o) => o.retryable).length;

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ to: '/messages', label: t('common:nav.messages') }}
        title={rendered_for_me?.subject ?? row.subject}
        subtitle={sender_name
          ? t('messageDetail.fromLine', { name: sender_name, date: format.dateTime(row.created_at) })
          : t('messageDetail.fromLineUnknown', { date: format.dateTime(row.created_at) })}
      />
      <div className="card flex gap-4 p-5 sm:p-6">
        <Avatar name={sender_name ?? '?'} />
        <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-200">{rendered_for_me?.body ?? row.body}</div>
      </div>
      {!rendered_for_me && /\{\{/.test(`${row.subject}${row.body}`) && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('messageDetail.variablesNote')}</p>
      )}

      {outcomes && (
        <section className="mt-8 space-y-3">
          <SectionHeader
            className="!mb-0"
            title={row.excluded_count
              ? t('messageDetail.recipientsHeadingWithExcluded', { included: row.recipient_count, excluded: row.excluded_count })
              : t('messageDetail.recipientsHeading', { included: row.recipient_count })}
            action={can_retry ? (
              <Button variant="secondary" size="sm" loading={retry.isPending} onClick={() => retry.mutate()}>
                {t('messageDetail.retry', { count: failed })}
              </Button>
            ) : undefined}
          />
          {retry.isSuccess && <Notice tone="success">{t('messageDetail.requeued', { count: retry.data.requeued })}</Notice>}
          <ErrorNotice error={retry.error} />
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('messageDetail.simulatedNote')}</p>
          <ul className="card row-list overflow-hidden">
            {outcomes.map((outcome) => <OutcomeRow key={outcome.person_id} outcome={outcome} />)}
          </ul>
        </section>
      )}
    </div>
  );
};
