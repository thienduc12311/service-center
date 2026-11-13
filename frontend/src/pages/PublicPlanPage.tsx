import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@service-center/shared';
import { api } from '../lib/api';
import { Loading } from '../components/ui';
import { Icon } from '../components/icons';
import { PublicPlanView } from '../components/PublicPlanView';
import { LocaleSwitcher } from '../i18n';

export interface PublicPlanPageProps {
  /** `/p/:slug` is one plan; `/s/:slug` is a service type's upcoming/recent link. */
  kind: 'plan' | 'set-list';
}

/**
 * F16: the anonymous page. It renders the allowlisted projection the API
 * returns and nothing else; a revoked, draft or not-yet-visible plan reads as
 * "not available".
 */
export const PublicPlanPage = ({ kind }: PublicPlanPageProps) => {
  const { t } = useTranslation(['auth', 'common']);
  const { slug = '' } = useParams<{ slug: string }>();
  const projection = useQuery({
    queryKey: ['public', kind, slug],
    queryFn: () => (kind === 'plan' ? api.publicPlan(slug) : api.publicSetList(slug)),
    retry: false,
  });
  return (
    <main className="min-h-screen bg-app-canvas">
      <div className="border-b border-app-border bg-app-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-2.5">
            <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-700 text-xs font-bold text-white shadow-sm shadow-brand-600/30">
              SC
            </span>
            <span className="text-sm font-semibold text-slate-900 dark:text-white">{t('common:app.name')}</span>
          </span>
          <LocaleSwitcher />
        </div>
      </div>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
      {projection.isLoading ? (
        <Loading />
      ) : projection.data ? (
        <PublicPlanView projection={projection.data} />
      ) : (
        <div className="card flex flex-col items-center px-6 py-16 text-center">
          <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            <Icon name="plans" className="size-6" />
          </span>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{t('publicPlan.unavailableTitle')}</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {projection.error instanceof ApiError && projection.error.status === 404
              ? t('publicPlan.notShared')
              : t('publicPlan.tryLater')}
          </p>
        </div>
      )}
      </div>
    </main>
  );
};
