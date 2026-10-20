import { useMutation } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useIdentityReconciliations, useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Loading } from '../ui';

/**
 * Possible duplicate people, never merged automatically. Merging moves the
 * no-login record's requests, team places, tags and links to the other
 * Person; keeping them separate just closes the report.
 */
export const IdentityReconciliationSettings = () => {
  const { t } = useTranslation('settings');
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
      <h2 className="text-base font-semibold">{t('identity.title')}</h2>
      <p className="mb-3 text-sm text-slate-500">{t('identity.description')}</p>
      <ErrorNotice error={reports.error ?? resolve.error} />
      {reports.isLoading ? (
        <Loading />
      ) : open.length === 0 ? (
        <p className="text-sm text-slate-500">{t('identity.empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {open.map((report) => (
            <li key={report.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              <span>
                <Trans
                  t={t}
                  i18nKey={`identity.reason.${report.reason}`}
                  values={{ person: report.person_name, candidate: report.candidate_name }}
                  components={[<strong key="person" />, <strong key="candidate" />]}
                />
                <span className="block text-xs text-slate-500">
                  {t('identity.mergeHint', { person: report.person_name, candidate: report.candidate_name })}
                </span>
              </span>
              <span className="flex gap-2">
                <Button
                  variant="secondary"
                  loading={resolve.isPending && resolve.variables?.id === report.id && resolve.variables.action === 'keep_separate'}
                  onClick={() => resolve.mutate({ id: report.id, action: 'keep_separate' })}
                >
                  {t('identity.keepSeparate')}
                </Button>
                <Button
                  loading={resolve.isPending && resolve.variables?.id === report.id && resolve.variables.action === 'merge'}
                  onClick={() => resolve.mutate({ id: report.id, action: 'merge' })}
                >
                  {t('identity.merge')}

                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
