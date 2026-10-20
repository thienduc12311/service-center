import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n';
import { api } from '../../lib/api';
import { useAvailabilityReview, useInvalidateOrg, useMyAvailabilityRequests } from '../../hooks/queries';
import { Button, ErrorNotice } from '../ui';

export interface AvailabilityReviewProps {
  /** A person you help (F03 delegate); omitted for yourself. */
  personId?: string;
}

/**
 * F03 Pass B freshness: when availability was last reviewed, a one-tap
 * "up to date" affirmation, and any open requests from leaders.
 */
export const AvailabilityReview = ({ personId }: AvailabilityReviewProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const { calendarDate, dateTime } = useFormatters();
  const invalidate = useInvalidateOrg();
  const review = useAvailabilityReview(personId);
  const requests = useMyAvailabilityRequests();
  const affirm = useMutation({
    mutationFn: () => api.affirmAvailability(personId ? { person_id: personId } : {}),
    onSuccess: invalidate,
  });
  const open = personId ? [] : requests.data ?? [];

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {review.data ? t(`freshness.${review.data.freshness}`) : t('settingsPage.availability.title')}
          </p>
          <p className="text-xs text-slate-500">
            {review.data?.reviewed_at
              ? t(review.data.kind === 'affirmed' ? 'review.lastReviewedAffirmed' : 'review.lastReviewed', { when: dateTime(review.data.reviewed_at) })
              : t('review.neverReviewed')}
          </p>
        </div>
        <Button variant="secondary" loading={affirm.isPending} onClick={() => affirm.mutate()}>
          {personId ? t('review.affirmTheirs') : t('review.affirmMine')}
        </Button>
      </div>
      {open.length > 0 && (
        <div className="mt-3 rounded-md bg-brand-50 p-3 text-sm ring-1 ring-brand-600/20">
          <p className="font-medium">{t('review.requestTitle')}</p>
          <ul className="mt-1 space-y-1 text-xs text-slate-600">
            {open.map((request) => (
              <li key={request.request_id}>
                {t('common:format.dateRange', { start: calendarDate(request.window_start), end: calendarDate(request.window_end) })}
                {request.respond_by ? ` · ${t('review.respondBy', { date: calendarDate(request.respond_by) })}` : ''}
                {request.message ? ` — ${t('review.quotedMessage', { message: request.message })}` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">{t('review.requestHint')}</p>

        </div>
      )}
      <ErrorNotice error={review.error ?? affirm.error} />
    </div>
  );
};
