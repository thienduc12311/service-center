import { useSearchParams } from 'react-router-dom';
import type { ChurchApplicationStatus } from '@service-center/shared';
import { useAdminApplications, useAdminOverview } from '../hooks/queries';
import { useApplicationOutcome } from '../hooks/useApplicationOutcome';
import { APPLICATION_STATUS_LABELS, APPLICATION_STATUSES, isApplicationStatus, sortApplications } from '../lib/applications';
import { ApplicationCard } from '../components/ApplicationCard';
import { ApplicationOutcomeNotice } from '../components/ApplicationOutcomeNotice';
import { EmptyState, ErrorNotice, Loading, PageHeader, Tabs, type TabItem } from '../components/ui';

const EMPTY_DESCRIPTIONS: Record<ChurchApplicationStatus, string> = {
  pending: 'New applications show up here, and every Service Center admin gets an email.',
  approved: 'Approved applications and the churches they created show up here.',
  rejected: 'Rejected applications show up here with their reason.',
  withdrawn: 'Applications the applicant withdrew show up here.',
};

export const ApplicationsPage = () => {
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status');
  const status: ChurchApplicationStatus = isApplicationStatus(statusParam) ? statusParam : 'pending';
  const applications = useAdminApplications(status);
  const overview = useAdminOverview();
  const { outcome, report, dismiss } = useApplicationOutcome();

  const tabs: TabItem<ChurchApplicationStatus>[] = APPLICATION_STATUSES.map((value) => ({
    value,
    label: APPLICATION_STATUS_LABELS[value],
    count: value === 'pending' ? overview.data?.pending_applications : undefined,
  }));

  const selectStatus = (next: ChurchApplicationStatus) => {
    dismiss();
    setParams(next === 'pending' ? {} : { status: next });
  };

  return (
    <>
      <PageHeader title="Applications" subtitle="Requests to run a new church on Service Center." />
      <Tabs items={tabs} value={status} onChange={selectStatus} label="Application status" className="mb-4" />
      <ApplicationOutcomeNotice outcome={outcome} onDismiss={dismiss} />

      {applications.isPending ? (
        <Loading />
      ) : applications.isError ? (
        <ErrorNotice error={applications.error} onRetry={() => void applications.refetch()} />
      ) : applications.data.length === 0 ? (
        <EmptyState
          icon="document"
          title={`No ${APPLICATION_STATUS_LABELS[status].toLowerCase()} applications`}
          description={EMPTY_DESCRIPTIONS[status]}
        />
      ) : (
        <div className="space-y-4">
          {sortApplications(applications.data, status).map((application) => (
            <ApplicationCard key={application.id} application={application} onOutcome={report} />
          ))}
        </div>
      )}
    </>
  );
};
