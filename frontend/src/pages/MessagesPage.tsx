import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_STATUS_LABELS,
  MESSAGE_AUDIENCE_REASON_LABELS,
  deliveryErrorLabel,
  formatDateTime,
  type DeliveryStatus,
  type MessageRecipientOutcome,
} from '@service-center/shared';
import { api } from '../lib/api';
import { useInvalidateOrg, useMessage, useMessages, useTeams } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
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

/** Messages sent to me, and (for senders) messages I sent with their outcomes. */
export const MessagesPage = () => {
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
        title="Messages"
        subtitle="Operational messages from leaders. Replies go to the sender’s email."
        actions={isSender && <Button onClick={() => setComposing(true)}>Message team members</Button>}
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
              {value === 'sent' ? 'Sent' : 'Received'}
            </button>
          ))}
        </div>
      )}
      {messages.isLoading ? (
        <Loading />
      ) : messages.error ? (
        <ErrorNotice error={messages.error} />
      ) : (messages.data ?? []).length === 0 ? (
        <EmptyState title={box === 'sent' ? 'No messages sent yet' : 'No messages for you'} description={box === 'sent' ? 'Message a team or the people on a plan from the plan’s Teams tab.' : undefined} />
      ) : (
        <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
          {(messages.data ?? []).map((message) => (
            <li key={message.id}>
              <Link to={`/messages/${message.id}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900">
                <span className="font-medium">{message.subject}</span>
                <span className="text-xs text-slate-500">
                  {message.sent_by_me ? `${message.recipient_count} recipients` : `From ${message.sender_name ?? 'a leader'}`} · {formatDateTime(message.created_at)}
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

const OutcomeRow = ({ outcome }: { outcome: MessageRecipientOutcome }) => (
  <li className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
    <div>
      <p className="font-medium">{[outcome.first_name, outcome.last_name].filter(Boolean).join(' ')}</p>
      <p className="text-xs text-slate-500">{outcome.reasons.map((r) => MESSAGE_AUDIENCE_REASON_LABELS[r]).join(' · ')}</p>
    </div>
    <div className="flex flex-wrap items-center gap-1">
      {outcome.status === 'excluded_no_address' && <Badge tone={NEUTRAL}>Not sent · no email or sign-in</Badge>}
      {outcome.status === 'excluded_by_sender' && <Badge tone={NEUTRAL}>Removed before sending</Badge>}
      {outcome.channels.map((channel) => (
        <Badge key={channel.delivery_id} tone={TONE[channel.status] ?? NEUTRAL}>
          <span title={deliveryErrorLabel(channel.error_code) ?? undefined}>
            {DELIVERY_CHANNEL_LABELS[channel.channel]}: {DELIVERY_STATUS_LABELS[channel.status]}
          </span>
        </Badge>
      ))}
    </div>
  </li>
);

export const MessageDetailPage = () => {
  const { messageId } = useParams<{ messageId: string }>();
  const message = useMessage(messageId);
  const invalidate = useInvalidateOrg();
  const retry = useMutation({ mutationFn: () => api.retryMessage(messageId!), onSuccess: invalidate });

  if (message.isLoading) return <Loading />;
  if (message.error) {
    return <EmptyState title="Message not available" description="It was not sent to you, or you are no longer an active member." />;
  }
  if (!message.data) return null;
  const { message: row, sender_name, outcomes, can_retry, rendered_for_me } = message.data;
  const failed = (outcomes ?? []).filter((o) => o.retryable).length;

  return (
    <div className="max-w-3xl">
      <Link to="/messages" className="text-sm text-slate-500 hover:underline">← Messages</Link>
      <h1 className="mt-2 text-xl font-semibold">{rendered_for_me?.subject ?? row.subject}</h1>
      <p className="text-sm text-slate-500">From {sender_name ?? 'a leader'} · {formatDateTime(row.created_at)}</p>
      <div className="card mt-4 whitespace-pre-wrap p-4 text-sm">{rendered_for_me?.body ?? row.body}</div>
      {!rendered_for_me && /\{\{/.test(`${row.subject}${row.body}`) && (
        <p className="mt-1 text-xs text-slate-500">Shown as written; each recipient received it with their own variables filled in.</p>
      )}

      {outcomes && (
        <section className="mt-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">
              Recipients · {row.recipient_count} included{row.excluded_count ? `, ${row.excluded_count} not included` : ''}
            </h2>
            {can_retry && (
              <Button variant="secondary" loading={retry.isPending} onClick={() => retry.mutate()}>
                Retry {failed} failed
              </Button>
            )}
          </div>
          {retry.isSuccess && <p role="status" className="mb-2 text-sm text-slate-600">Re-queued {retry.data.requeued} delivery{retry.data.requeued === 1 ? '' : 'ies'}.</p>}
          <ErrorNotice error={retry.error} />
          <p className="mb-2 text-xs text-slate-500">“Simulated” means no email provider is configured — the email was not sent. Only failed or uncertain deliveries can be retried.</p>
          <ul className="card divide-y divide-slate-100 px-4 dark:divide-slate-800">
            {outcomes.map((outcome) => <OutcomeRow key={outcome.person_id} outcome={outcome} />)}
          </ul>
        </section>
      )}
    </div>
  );
};
