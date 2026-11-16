import { useParams } from 'react-router-dom';
import { ApiError } from '@service-center/shared';
import { useAdminApplication } from '../hooks/queries';
import { useApplicationOutcome } from '../hooks/useApplicationOutcome';
import { ApplicationCard } from '../components/ApplicationCard';
import { ApplicationOutcomeNotice } from '../components/ApplicationOutcomeNotice';
import { EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';

type ApplicationRouteParams = { id: string };

/** One application, the target of the links in admin emails. */
export const ApplicationDetailPage = () => {
  const { id = '' } = useParams<ApplicationRouteParams>();
  const applications = useAdminApplication(id);
  const { outcome, report, dismiss } = useApplicationOutcome();
  const application = applications.data;

  return (
    <>
      <PageHeader title={application?.church_name ?? 'Application'} back={{ to: '/applications', label: 'Applications' }} />
      <ApplicationOutcomeNotice outcome={outcome} onDismiss={dismiss} />
      {applications.isPending ? (
        <Loading />
      ) : applications.isError && !(applications.error instanceof ApiError && applications.error.status === 404) ? (
        <ErrorNotice error={applications.error} onRetry={() => void applications.refetch()} />
      ) : !application ? (
        <EmptyState icon="search" title="Application not found" description="It may have been removed, or the link is wrong." />
      ) : (
        <ApplicationCard application={application} linkTitle={false} onOutcome={report} />
      )}
    </>
  );
};
