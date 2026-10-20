import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { addLocalDays, type AvailabilityFreshness } from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useAvailabilityRequest, useAvailabilityRequests, useInvalidateOrg } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { useFormatters } from '../../i18n';
import { Badge, Button, ErrorNotice, Loading, Modal } from '../ui';

export interface AvailabilityRequestsModalProps {
  team: { id: string; name: string };
  onClose: () => void;
}

const FRESHNESS_TONE: Record<AvailabilityFreshness, string> = {
  current: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  stale: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  unknown: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

/** `YYYY-MM-DD` for the date inputs (a machine format, not display text). */
const todayLocal = (): string => new Date().toLocaleDateString('en-CA');

/**
 * F03 Pass B: ask a team to review their availability. The audience is
 * previewed first and sent exactly as reviewed; one idempotency key per
 * draft makes a retried send a single request. Freshness tells "never
 * reviewed" and "needs review" apart from an explicit blockout.
 */
export const AvailabilityRequestsModal = ({ team, onClose }: AvailabilityRequestsModalProps) => {
  const { t } = useTranslation(['teams', 'common']);
  const format = useFormatters();
  const { organizationId } = useAuth();
  const invalidate = useInvalidateOrg();
  const audience = useQuery({
    queryKey: [...keys.availabilityRequests(organizationId, team.id), 'audience'],
    queryFn: () => api.previewAvailabilityRequest({ team_id: team.id }),
  });
  const history = useAvailabilityRequests(team.id);
  const [openRequest, setOpenRequest] = useState<string | null>(null);
  const detail = useAvailabilityRequest(openRequest);

  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => setSelected((audience.data ?? []).map((m) => m.person_id)), [audience.data]);
  const [windowStart, setWindowStart] = useState(todayLocal());
  const [windowEnd, setWindowEnd] = useState(addLocalDays(todayLocal(), 90));
  const [respondBy, setRespondBy] = useState('');
  const [message, setMessage] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const unreachable = useMemo(
    () => (audience.data ?? []).filter((m) => selected.includes(m.person_id) && !m.has_login && !m.has_email),
    [audience.data, selected],
  );

  const send = useMutation({
    mutationFn: () => api.createAvailabilityRequest({
      team_id: team.id, person_ids: selected, message: message.trim() || null,
      window_start: windowStart, window_end: windowEnd, respond_by: respondBy || null,
      idempotency_key: idempotencyKey,
    }),
    onSuccess: async (result) => {
      await invalidate();
      setOpenRequest(result.request_id);
      setMessage('');
      setIdempotencyKey(crypto.randomUUID());
    },
  });

  const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  return (
    <Modal open title={t('availabilityRequests.title', { team: team.name })} onClose={onClose}>
      <div className="space-y-6">
        <form className="space-y-3" onSubmit={(event: FormEvent) => { event.preventDefault(); send.mutate(); }}>
          <h3 className="text-sm font-semibold">{t('availabilityRequests.ask')}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="label">{t('availabilityRequests.from')}<input className="input mt-1" type="date" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} required /></label>
            <label className="label">{t('availabilityRequests.to')}<input className="input mt-1" type="date" min={windowStart} value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} required /></label>
            <label className="label">{t('availabilityRequests.replyBy')}<input className="input mt-1" type="date" value={respondBy} onChange={(e) => setRespondBy(e.target.value)} /></label>
          </div>
          <label className="label">{t('common:format.fieldOptional', { label: t('availabilityRequests.message') })}
            <textarea className="input mt-1" rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <div>
            <p className="label">{t('availabilityRequests.whoGetsIt')}</p>
            {audience.isLoading ? <Loading /> : (
              <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1">
                {(audience.data ?? []).map((member) => (
                  <label key={member.person_id} className="flex min-h-11 items-center gap-2 rounded px-2 text-sm hover:bg-slate-50">
                    <input type="checkbox" checked={selected.includes(member.person_id)} onChange={() => toggle(member.person_id)} />
                    <span className="flex-1">{[member.first_name, member.last_name].filter(Boolean).join(' ')}</span>
                    {!member.has_login && <span className="text-xs text-slate-500">{t('availabilityRequests.emailOnly')}</span>}
                    <Badge tone={FRESHNESS_TONE[member.freshness]}>
                      {t(`availabilityRequests.freshness.${member.freshness}`)}
                    </Badge>
                  </label>
                ))}
                {audience.data?.length === 0 && <p className="px-2 py-3 text-sm text-slate-400">{t('teamsPage.noMembers')}</p>}
              </div>
            )}
          </div>
          {unreachable.length > 0 && (
            <p className="text-xs text-amber-700">{t('availabilityRequests.unreachable', { count: unreachable.length })}</p>
          )}
          <Button type="submit" loading={send.isPending} disabled={selected.length === 0}>
            {t('availabilityRequests.send', { count: selected.length })}
          </Button>
          <ErrorNotice error={audience.error ?? send.error} />
        </form>

        <div>
          <h3 className="mb-2 text-sm font-semibold">{t('availabilityRequests.earlier')}</h3>
          {history.isLoading ? <Loading /> : history.data?.length ? (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {history.data.map((request) => (
                <li key={request.id}>
                  <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                    onClick={() => setOpenRequest(openRequest === request.id ? null : request.id)} aria-expanded={openRequest === request.id}>
                    <span className="flex-1">{t('common:format.dateRange', { start: format.calendarDate(request.window_start), end: format.calendarDate(request.window_end) })}</span>
                    <span className="text-xs text-slate-500">{t('availabilityRequests.requestSummary', { responded: request.responded_count, total: request.recipient_count, date: format.date(request.created_at) })}</span>
                  </button>
                  {openRequest === request.id && (
                    <div className="border-t border-slate-100 px-3 py-2">
                      {detail.isLoading ? <Loading /> : (
                        <ul className="space-y-1">
                          {detail.data?.recipients.map((recipient) => (
                            <li key={recipient.person_id} className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="flex-1 text-sm">{recipient.name}</span>
                              <span className="text-slate-500">
                                {recipient.responded_at
                                  ? t(recipient.response_kind === 'affirmed' ? 'availabilityRequests.respondedAffirmed' : 'availabilityRequests.respondedUpdated', { when: format.dateTime(recipient.responded_at) })
                                  : t('availabilityRequests.noReply')}
                              </span>
                              <Badge tone={FRESHNESS_TONE[recipient.freshness]}>{t(`availabilityRequests.freshness.${recipient.freshness}`)}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                      <ErrorNotice error={detail.error} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-400">{t('availabilityRequests.noRequests')}</p>}
          <ErrorNotice error={history.error} />
        </div>
      </div>
    </Modal>
  );
};
