import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@service-center/shared';
import { api } from '../lib/api';
import { Loading } from '../components/ui';
import { PublicPlanView } from '../components/PublicPlanView';
import { AnonymousLanguageToggle } from '../i18n';

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
  const { t } = useTranslation('auth');
  const { slug = '' } = useParams<{ slug: string }>();
  const projection = useQuery({
    queryKey: ['public', kind, slug],
    queryFn: () => (kind === 'plan' ? api.publicPlan(slug) : api.publicSetList(slug)),
    retry: false,
  });
  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-white px-4 py-10 dark:bg-slate-950">
      <div className="flex justify-end pb-4">
        <AnonymousLanguageToggle />
      </div>
      {projection.isLoading ? (
        <Loading />
      ) : projection.data ? (
        <PublicPlanView projection={projection.data} />
      ) : (
        <div className="py-16 text-center">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{t('publicPlan.unavailableTitle')}</h1>
          <p className="mt-2 text-sm text-slate-500">
            {projection.error instanceof ApiError && projection.error.status === 404
              ? t('publicPlan.notShared')
              : t('publicPlan.tryLater')}
          </p>
        </div>
      )}
    </main>
  );
};
