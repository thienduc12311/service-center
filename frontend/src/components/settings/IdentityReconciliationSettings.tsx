import { useMutation } from '@tanstack/react-query';
import type { IdentityReconciliationReason } from '@service-center/shared';
import { api } from '../../lib/api';
import { useIdentityReconciliations, useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Loading } from '../ui';

const REASONS: Record<IdentityReconciliationReason, string> = {
  email_match: 'has the same email as',
  invitation_conflict: 'accepted an invitation meant for',
};

/**
 * Possible duplicate people, never merged automatically. Merging moves the
 * no-login record's requests, team places, tags and links to the other
 * Person; keeping them separate just closes the report.
 */
export const IdentityReconciliationSettings = () => {
  const invalidate = useInvalidateOrg();
  const reports = useIdentityReconciliations(true);
  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'keep_separate' | 'merge' }) =>
      api.resolveIdentityReconciliation(id, { action }),
    onSuccess: invalidate,
  });

  const open = (reports.data ?? []).filter((report) => report.status === 'open');

  return (
    <section className="card p-5">
      <h2 className="text-base font-semibold">Possible duplicate people</h2>
      <p className="mb-3 text-sm text-slate-500">
        We never combine people just because their details match. Decide here whether two records are the same person.
      </p>
      <ErrorNotice error={reports.error ?? resolve.error} />
      {reports.isLoading ? (
        <Loading />
      ) : open.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing to review.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {open.map((report) => (
            <li key={report.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              <span>
                <strong>{report.person_name}</strong> {REASONS[report.reason]} <strong>{report.candidate_name}</strong>
                <span className="block text-xs text-slate-500">
                  Merging moves {report.candidate_name}’s requests and history to {report.person_name}.
                </span>
              </span>
              <span className="flex gap-2">
                <Button
                  variant="secondary"
                  loading={resolve.isPending && resolve.variables?.id === report.id && resolve.variables.action === 'keep_separate'}
                  onClick={() => resolve.mutate({ id: report.id, action: 'keep_separate' })}
                >
                  Different people
                </Button>
                <Button
                  loading={resolve.isPending && resolve.variables?.id === report.id && resolve.variables.action === 'merge'}
                  onClick={() => resolve.mutate({ id: report.id, action: 'merge' })}
                >
                  Same person — merge
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
