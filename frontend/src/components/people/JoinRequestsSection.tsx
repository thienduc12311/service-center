import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import {
  CHURCH_JOIN_TEXT_MAX,
  type ChurchJoinRequest,
  type ChurchJoinRequestApproval,
  type ChurchJoinRequestStatus,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useChurchJoinRequests } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { useFormatters } from '../../i18n/useFormatters';
import { Avatar, Badge, Button, ErrorNotice, Modal, Notice, SectionHeader, SkeletonList } from '../ui';

export interface JoinRequestsSectionProps {
  /** An invitation was sent: the page shows its link to share, like "Send invite". */
  onInvited: (personName: string, inviteUrl: string) => void;
}

type DecidedStatus = Exclude<ChurchJoinRequestStatus, 'pending'>;

const STATUS_TONES: Record<DecidedStatus, string> = {
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25',
  declined: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25',
  withdrawn: 'bg-slate-100 text-slate-500 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600/40',
};

/**
 * The server returns at most this many decided requests (the last 30 days,
 * newest first; `RECENT_JOIN_REQUEST_LIMIT` in the backend), so a full list is
 * a cap, not a total.
 */
const RECENT_JOIN_REQUEST_LIMIT = 20;

const requesterName = (request: ChurchJoinRequest): string => request.requester_name ?? request.requester_email;

/**
 * Owners only (the people who may send invitations): who asked to join the
 * church by its ID. Approving sends the normal invitation; the person joins
 * by accepting it. The database checks the owner again.
 */
export const JoinRequestsSection = ({ onInvited }: JoinRequestsSectionProps) => {
  const { t } = useTranslation(['people', 'common']);
  const { date } = useFormatters();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, organizationId } = useAuth();
  const requests = useChurchJoinRequests(true);
  const [declining, setDeclining] = useState<ChurchJoinRequest | null>(null);
  const [reason, setReason] = useState('');
  const [alreadyInvited, setAlreadyInvited] = useState<string | null>(null);
  const slug = user?.memberships.find((membership) => membership.organization.id === organizationId)?.organization.slug;

  // The roster gains (or links) a person on approval, so refresh all of it.
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.all(organizationId) });
  };

  const approve = useMutation({
    mutationFn: (request: ChurchJoinRequest) => api.approveChurchJoinRequest(request.id),
    onSuccess: async (approval: ChurchJoinRequestApproval, request) => {
      await refresh();
      if (approval.invite_url) {
        setAlreadyInvited(null);
        onInvited(requesterName(request), approval.invite_url);
      } else {
        setAlreadyInvited(requesterName(request));
      }
    },
  });

  const decline = useMutation({
    mutationFn: ({ request, text }: { request: ChurchJoinRequest; text: string }) =>
      api.declineChurchJoinRequest(request.id, { reason: text.trim() || null }),
    onSuccess: async () => {
      setDeclining(null);
      setReason('');
      await refresh();
    },
  });

  const pending = requests.data?.pending ?? [];
  const recent = requests.data?.recent ?? [];

  return (
    <section aria-labelledby="join-requests-title" className="space-y-3">
      <SectionHeader id="join-requests-title" title={t('joinRequests.title')} meta={pending.length} className="!mb-0" />

      {slug && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          <Trans
            t={t}
            i18nKey="joinRequests.shareHint"
            values={{ slug }}
            components={[<code key="slug" className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200" />]}
          />
        </p>
      )}

      {alreadyInvited && (
        <Notice tone="info">
          <p>{t('joinRequests.alreadyInvited', { name: alreadyInvited })}</p>
        </Notice>
      )}
      <ErrorNotice error={requests.error ?? approve.error} />

      {requests.isLoading ? (
        <SkeletonList rows={1} />
      ) : pending.length ? (
        <ul className="card row-list overflow-hidden">
          {pending.map((request) => (
            <li key={request.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Avatar name={requesterName(request)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900 dark:text-white">{requesterName(request)}</p>
                  <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                    {request.requester_email} · {t('joinRequests.askedOn', { date: date(request.created_at) })}
                  </p>
                  {request.message && (
                    <p className="mt-2 whitespace-pre-line break-words rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                      {request.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                <Button
                  size="sm"
                  icon="mail"
                  loading={approve.isPending && approve.variables?.id === request.id}
                  disabled={approve.isPending}
                  onClick={() => approve.mutate(request)}
                >
                  {t('joinRequests.approve')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={approve.isPending && approve.variables?.id === request.id}
                  onClick={() => {
                    decline.reset();
                    setReason('');
                    setDeclining(request);
                  }}
                >
                  {t('joinRequests.decline')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card px-4 py-3 text-sm text-slate-500 dark:text-slate-400">{t('joinRequests.empty')}</p>
      )}

      {recent.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer select-none text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
            {recent.length >= RECENT_JOIN_REQUEST_LIMIT
              ? t('joinRequests.recentLatest', { count: RECENT_JOIN_REQUEST_LIMIT })
              : t('joinRequests.recentCount', { count: recent.length })}
          </summary>
          <ul className="card row-list mt-2 overflow-hidden">
            {recent.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-slate-900 dark:text-white">{requesterName(request)}</span>{' '}
                  <span className="text-slate-500 dark:text-slate-400">{request.requester_email}</span>
                </span>
                {request.status !== 'pending' && (
                  <Badge tone={STATUS_TONES[request.status]}>{t(`joinRequests.status.${request.status}`)}</Badge>
                )}
                {request.status === 'approved' && request.person_id && (
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/people/${request.person_id}`)}>
                    {t('joinRequests.openPerson')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Modal
        open={declining !== null}
        title={declining ? t('joinRequests.declineTitle', { name: requesterName(declining) }) : ''}
        onClose={() => setDeclining(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeclining(null)} disabled={decline.isPending}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={decline.isPending}
              onClick={() => declining && decline.mutate({ request: declining, text: reason })}
            >
              {t('joinRequests.confirmDecline')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="label" htmlFor="join-request-decline-reason">
            {t('joinRequests.declineReason')}
          </label>
          <textarea
            id="join-request-decline-reason"
            className="input min-h-24"
            value={reason}
            maxLength={CHURCH_JOIN_TEXT_MAX}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {declining ? t('joinRequests.declineReasonHint', { name: requesterName(declining) }) : null}
          </p>
          <ErrorNotice error={decline.error} />
        </div>
      </Modal>
    </section>
  );
};
