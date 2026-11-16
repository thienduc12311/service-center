import { Link } from 'react-router-dom';
import { formatFileSize, type AdminChurchApplication, type AdminOrganizationSummary } from '@service-center/shared';
import { useAdminApplications, useAdminOrganizations, useAdminOverview } from '../hooks/queries';
import { churchesNearQuota } from '../lib/churches';
import { applicationLocation } from '../lib/applications';
import { formatCount, formatRelativeTime } from '../lib/format';
import { StorageBar } from '../components/status';
import { Icon } from '../components/icons';
import { Card, EmptyState, ErrorNotice, Loading, PageHeader, SectionHeader, StatCard } from '../components/ui';

export const OverviewPage = () => {
  const overview = useAdminOverview();

  return (
    <>
      <PageHeader title="Overview" subtitle="Every church on Service Center at a glance." />
      {overview.isPending ? (
        <Loading />
      ) : overview.isError ? (
        <ErrorNotice error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Churches"
            value={formatCount(overview.data.churches.total)}
            icon="grid"
            hint={`${formatCount(overview.data.churches.active)} active · ${formatCount(overview.data.churches.disabled)} disabled`}
            to="/churches"
          />
          <StatCard
            label="Pending applications"
            value={formatCount(overview.data.pending_applications)}
            icon="document"
            tone={overview.data.pending_applications > 0 ? 'amber' : 'slate'}
            hint={overview.data.pending_applications > 0 ? 'Waiting for review' : 'Nothing to review'}
            to="/applications"
          />
          <StatCard label="Accounts" value={formatCount(overview.data.accounts)} icon="people" tone="green" hint="People with a login" />
          <StatCard
            label="Storage used"
            value={formatFileSize(overview.data.storage_used_bytes)}
            icon="upload"
            tone="slate"
            hint="Across every church"
          />
        </div>
      )}

      <NeedsAttention />
    </>
  );
};

const NeedsAttention = () => {
  const pending = useAdminApplications('pending');
  const churches = useAdminOrganizations();

  const nearQuota = churches.data ? churchesNearQuota(churches.data) : [];
  const loading = pending.isPending || churches.isPending;
  const empty = !loading && (pending.data?.length ?? 0) === 0 && nearQuota.length === 0;

  return (
    <section className="mt-8" aria-labelledby="attention-heading">
      <SectionHeader id="attention-heading" title="Needs attention" />
      <ErrorNotice error={pending.error} onRetry={() => void pending.refetch()} className="mb-3" />
      <ErrorNotice error={churches.error} onRetry={() => void churches.refetch()} className="mb-3" />
      {loading ? (
        <Loading />
      ) : empty ? (
        <EmptyState icon="check" title="All caught up" description="No pending applications and no church is near its storage quota." />
      ) : (
        <Card padding="none" className="row-list">
          {pending.data?.map((application) => <PendingApplicationRow key={application.id} application={application} />)}
          {nearQuota.map((church) => (
            <NearQuotaRow key={church.id} church={church} />
          ))}
        </Card>
      )}
    </section>
  );
};

interface PendingApplicationRowProps {
  application: AdminChurchApplication;
}

const PendingApplicationRow = ({ application }: PendingApplicationRowProps) => (
  <Link
    to={`/applications/${application.id}`}
    className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
  >
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
      <Icon name="document" className="size-4" />
    </span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
        Application: {application.church_name}
      </p>
      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
        {applicationLocation(application)} · {application.applicant_name ?? application.applicant_email ?? 'Unknown applicant'} ·
        submitted {formatRelativeTime(application.created_at)}
      </p>
    </div>
    <Icon name="chevronRight" className="size-4 text-slate-400" />
  </Link>
);

interface NearQuotaRowProps {
  church: AdminOrganizationSummary;
}

const NearQuotaRow = ({ church }: NearQuotaRowProps) => (
  <Link to={`/churches/${church.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/40">
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
      <Icon name="alert" className="size-4" />
    </span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">Storage almost full: {church.name}</p>
      <p className="truncate text-xs text-slate-500 dark:text-slate-400">/{church.slug}</p>
    </div>
    <StorageBar usedBytes={church.storage_used_bytes} quotaBytes={church.storage_quota_bytes} className="hidden w-40 sm:block" />
    <Icon name="chevronRight" className="size-4 text-slate-400" />
  </Link>
);
