import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAdminActivity, useAdminOrganizations } from '../hooks/queries';
import { ActivityList } from '../components/ActivityList';
import { Button, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader, SelectField } from '../components/ui';

/**
 * Every super-admin action, newest first, optionally for one church
 * (`?church=<id>`) or about one account (`?user=<id>`).
 */
export const ActivityPage = () => {
  const [params, setParams] = useSearchParams();
  const churchId = params.get('church');
  const userId = params.get('user');
  const churches = useAdminOrganizations();
  const activity = useAdminActivity({ organizationId: churchId, targetUserId: userId });

  const churchOptions = useMemo(
    () => [...(churches.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
    [churches.data],
  );
  const entries = useMemo(() => activity.data?.pages.flatMap((page) => page.entries) ?? [], [activity.data]);
  // A church from the link that is not in the list (deleted, or the list still loading) stays selectable.
  const unknownChurch = churchId !== null && !churchOptions.some((church) => church.id === churchId);

  return (
    <>
      <PageHeader title="Activity" subtitle="Everything super admins did, including changes made while inside a church." />

      {userId && (
        <Notice className="mb-4">
          Showing actions about one account.{' '}
          <Link to={`/users/${userId}`} className="font-medium underline">
            Open the account
          </Link>{' '}
          ·{' '}
          <button type="button" className="font-medium underline" onClick={() => setParams(churchId ? { church: churchId } : {})}>
            Show everything
          </button>
        </Notice>
      )}

      <div className="mb-4 max-w-sm">
        <SelectField
          label="Church"
          value={churchId ?? ''}
          onChange={(event) => {
            const next: Record<string, string> = {};
            if (event.target.value) next.church = event.target.value;
            if (userId) next.user = userId;
            setParams(next);
          }}
          hint={churches.isError ? 'Could not load the church list.' : undefined}
        >
          <option value="">All churches and settings</option>
          {unknownChurch && <option value={churchId}>{churches.isPending ? 'Loading…' : 'Selected church'}</option>}
          {churchOptions.map((church) => (
            <option key={church.id} value={church.id}>
              {church.name}
            </option>
          ))}
        </SelectField>
      </div>

      {activity.isPending ? (
        <Loading />
      ) : activity.isError ? (
        <ErrorNotice error={activity.error} onRetry={() => void activity.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon="clock" title="No activity yet" description="Admin actions are recorded here as they happen." />
      ) : (
        <>
          <Card padding="none">
            <ActivityList entries={entries} showChurch={churchId === null} />
          </Card>
          <div className="mt-4 flex justify-center">
            {activity.hasNextPage ? (
              <Button variant="secondary" loading={activity.isFetchingNextPage} onClick={() => void activity.fetchNextPage()}>
                Load more
              </Button>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">That's everything.</p>
            )}
          </div>
        </>
      )}
    </>
  );
};
