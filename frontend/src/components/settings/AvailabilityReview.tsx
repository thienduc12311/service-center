import { useMutation } from '@tanstack/react-query';
import { AVAILABILITY_FRESHNESS_LABELS, formatCivilDate, formatDateTime } from '@service-center/shared';
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
            {review.data ? AVAILABILITY_FRESHNESS_LABELS[review.data.freshness] : 'Availability'}
          </p>
          <p className="text-xs text-slate-500">
            {review.data?.reviewed_at
              ? `Last reviewed ${formatDateTime(review.data.reviewed_at)}${review.data.kind === 'affirmed' ? ' (confirmed up to date)' : ''}.`
              : 'Leaders can’t tell yet whether these dates are current.'}
          </p>
        </div>
        <Button variant="secondary" loading={affirm.isPending} onClick={() => affirm.mutate()}>
          {personId ? 'Their availability is up to date' : 'My availability is up to date'}
        </Button>
      </div>
      {open.length > 0 && (
        <div className="mt-3 rounded-md bg-brand-50 p-3 text-sm ring-1 ring-brand-600/20">
          <p className="font-medium">A leader asked you to review your availability</p>
          <ul className="mt-1 space-y-1 text-xs text-slate-600">
            {open.map((request) => (
              <li key={request.request_id}>
                {formatCivilDate(request.window_start)} – {formatCivilDate(request.window_end)}
                {request.respond_by ? ` · by ${formatCivilDate(request.respond_by)}` : ''}
                {request.message ? ` — “${request.message}”` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Add blockout dates below, or confirm your availability is up to date.</p>
        </div>
      )}
      <ErrorNotice error={review.error ?? affirm.error} />
    </div>
  );
};
