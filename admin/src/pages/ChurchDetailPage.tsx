import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  disableOrganizationSchema,
  enterOrganizationSchema,
  formatFileSize,
  type AdminOrganizationDetail,
  type AdminOrganizationMember,
  type AdminOrganizationSummary,
  type AdminStorageBucketUsage,
  type PlatformAccessGrant,
} from '@service-center/shared';
import {
  useAdminActivity,
  useAdminOrganization,
  useDisableOrganization,
  useEnableOrganization,
  useEnterOrganization,
  useExitOrganization,
  useSetOrganizationQuota,
} from '../hooks/queries';
import { env } from '../lib/env';
import { serviceCenterChurchUrl } from '../lib/churches';
import { formatCount, formatDate, formatDateTime, formatRelativeTime } from '../lib/format';
import { MEMBER_STATUS_LABELS, ROLE_LABELS, sortMembers, type MemberStatus } from '../lib/members';
import { megabytesFieldValue, quotaBytesFromInput } from '../lib/units';
import { ActivityList } from '../components/ActivityList';
import { ChurchStatusBadge, StorageBar } from '../components/status';
import { Icon } from '../components/icons';
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  DetailList,
  EmptyState,
  ErrorNotice,
  Loading,
  Modal,
  Notice,
  PageHeader,
  SectionHeader,
  TextAreaField,
  TextField,
  type BadgeTone,
} from '../components/ui';

const MEMBER_STATUS_TONES: Record<MemberStatus, BadgeTone> = {
  active: 'green',
  invited: 'brand',
  inactive: 'slate',
  suspended: 'red',
};

/** How many recent lines the church page shows before linking to Activity. */
const RECENT_ACTIVITY_LIMIT = 10;

type ChurchRouteParams = { id: string };

export const ChurchDetailPage = () => {
  const { id = '' } = useParams<ChurchRouteParams>();
  const detail = useAdminOrganization(id);

  if (detail.isPending) return <Loading />;
  if (detail.isError) {
    return (
      <>
        <PageHeader title="Church" back={{ to: '/churches', label: 'Churches' }} />
        <ErrorNotice error={detail.error} fallback="Could not load this church." onRetry={() => void detail.refetch()} />
      </>
    );
  }
  return <ChurchDetail detail={detail.data} />;
};

interface ChurchDetailProps {
  detail: AdminOrganizationDetail;
}

const ChurchDetail = ({ detail }: ChurchDetailProps) => {
  const { summary } = detail;
  return (
    <>
      <PageHeader
        title={summary.name}
        back={{ to: '/churches', label: 'Churches' }}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <ChurchStatusBadge status={summary.status} />
            <span>/{summary.slug}</span>
          </span>
        }
      />

      {summary.status === 'disabled' && (
        <Notice tone="warning" className="mb-5">
          <p className="font-medium">
            Disabled{summary.disabled_at ? ` on ${formatDateTime(summary.disabled_at)}` : ''}. Members can't use this church.
          </p>
          {summary.disabled_reason && <p className="mt-0.5">Reason: {summary.disabled_reason}</p>}
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <SummaryCard summary={summary} />
          <MembersSection members={detail.members} />
          <StorageSection summary={summary} buckets={detail.storage} />
          <RecentActivity organizationId={summary.id} />
        </div>
        <div className="space-y-6">
          <AccessCard summary={summary} expiresAt={detail.my_platform_access_expires_at} />
          <QuotaCard summary={summary} />
          <StatusCard summary={summary} />
        </div>
      </div>
    </>
  );
};

/* -------------------------------------------------------------------------
 * Summary, members, storage, activity
 * ---------------------------------------------------------------------- */

interface SummaryCardProps {
  summary: AdminOrganizationSummary;
}

const SummaryCard = ({ summary }: SummaryCardProps) => (
  <Card>
    <DetailList
      items={[
        {
          label: 'Owner',
          value: summary.owner ? (
            <>
              {summary.owner.full_name ?? '—'}
              {summary.owner.email && <span className="block text-xs text-slate-500 dark:text-slate-400">{summary.owner.email}</span>}
            </>
          ) : null,
        },
        {
          label: 'Accounts',
          value: `${formatCount(summary.accounts)}${summary.invited ? ` (+${formatCount(summary.invited)} invited)` : ''}`,
        },
        { label: 'People on roster', value: formatCount(summary.people) },
        { label: 'Created', value: formatDate(summary.created_at) },
        {
          label: 'Last activity',
          value: summary.last_activity_at ? (
            <time dateTime={summary.last_activity_at} title={formatDateTime(summary.last_activity_at)}>
              {formatRelativeTime(summary.last_activity_at)}
            </time>
          ) : (
            'Never'
          ),
        },
        {
          label: 'Storage',
          value: (
            <StorageBar
              usedBytes={summary.storage_used_bytes}
              quotaBytes={summary.storage_quota_bytes}
              custom={summary.quota_is_custom}
              className="max-w-56"
            />
          ),
        },
      ]}
    />
  </Card>
);

interface MembersSectionProps {
  members: readonly AdminOrganizationMember[];
}

const MembersSection = ({ members }: MembersSectionProps) => (
  <section aria-labelledby="members-heading">
    <SectionHeader id="members-heading" title="Members" meta={formatCount(members.length)} />
    {members.length === 0 ? (
      <EmptyState compact icon="people" title="No members" />
    ) : (
      <Card padding="none" className="overflow-x-auto">
        <table className="data-table min-w-[640px]">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">Joined</th>
            </tr>
          </thead>
          <tbody>
            {sortMembers(members).map((member) => (
              <tr key={member.user_id}>
                <td className="font-medium text-slate-900 dark:text-slate-100">{member.full_name ?? '—'}</td>
                <td className="text-slate-600 dark:text-slate-300">{member.email ?? '—'}</td>
                <td>{ROLE_LABELS[member.role]}</td>
                <td>
                  <Badge tone={MEMBER_STATUS_TONES[member.status]}>{MEMBER_STATUS_LABELS[member.status]}</Badge>
                </td>
                <td className="whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(member.joined_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    )}
  </section>
);

interface StorageSectionProps {
  summary: AdminOrganizationSummary;
  buckets: readonly AdminStorageBucketUsage[];
}

const StorageSection = ({ summary, buckets }: StorageSectionProps) => (
  <section aria-labelledby="storage-heading">
    <SectionHeader id="storage-heading" title="Storage by bucket" meta={formatFileSize(summary.storage_used_bytes)} />
    {buckets.length === 0 ? (
      <EmptyState compact icon="upload" title="No files stored" />
    ) : (
      <Card padding="none" className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Bucket</th>
              <th scope="col" className="text-right">
                Files
              </th>
              <th scope="col" className="text-right">
                Size
              </th>
            </tr>
          </thead>
          <tbody>
            {[...buckets]
              .sort((a, b) => b.used_bytes - a.used_bytes)
              .map((bucket) => (
                <tr key={bucket.bucket_id}>
                  <td className="font-mono text-xs">{bucket.bucket_id}</td>
                  <td className="text-right tabular-nums">{formatCount(bucket.object_count)}</td>
                  <td className="text-right tabular-nums">{formatFileSize(bucket.used_bytes)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
    )}
  </section>
);

interface RecentActivityProps {
  organizationId: string;
}

const RecentActivity = ({ organizationId }: RecentActivityProps) => {
  const activity = useAdminActivity({ organizationId }, RECENT_ACTIVITY_LIMIT);
  const entries = activity.data?.pages[0]?.entries ?? [];
  return (
    <section aria-labelledby="activity-heading">
      <SectionHeader
        id="activity-heading"
        title="Recent activity"
        action={
          <Link to={`/activity?church=${organizationId}`} className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-200">
            View all
          </Link>
        }
      />
      {activity.isPending ? (
        <Loading />
      ) : activity.isError ? (
        <ErrorNotice error={activity.error} onRetry={() => void activity.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState compact icon="clock" title="No admin activity for this church yet" />
      ) : (
        <Card padding="none">
          <ActivityList entries={entries} showChurch={false} />
        </Card>
      )}
    </section>
  );
};

/* -------------------------------------------------------------------------
 * Controls
 * ---------------------------------------------------------------------- */

interface AccessCardProps {
  summary: AdminOrganizationSummary;
  /** The caller's own temporary owner access here. */
  expiresAt: string | null;
}

interface OpenInServiceCenterProps {
  organizationId: string;
}

/** Opens the main app with this church selected (`?organization=`). */
const OpenInServiceCenter = ({ organizationId }: OpenInServiceCenterProps) => (
  <a
    href={serviceCenterChurchUrl(env.appUrl, organizationId)}
    target="_blank"
    rel="noopener noreferrer"
    className={buttonClasses('primary', 'sm')}
  >
    Open in Service Center
    <Icon name="chevronRight" className="size-3.5" />
  </a>
);

const AccessCard = ({ summary, expiresAt }: AccessCardProps) => {
  const enter = useEnterOrganization();
  const exit = useExitOrganization();
  const [hours, setHours] = useState('8');
  const [hoursError, setHoursError] = useState<string | undefined>();
  const [grant, setGrant] = useState<PlatformAccessGrant | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = enterOrganizationSchema.safeParse({ hours: Number(hours) });
    if (!parsed.success) {
      setHoursError('Choose 1 to 24 hours.');
      return;
    }
    setHoursError(undefined);
    exit.reset();
    enter.mutate({ organizationId: summary.id, hours: parsed.data.hours }, { onSuccess: setGrant });
  };

  const leave = () => {
    enter.reset();
    exit.mutate(summary.id, { onSuccess: () => setGrant(null) });
  };

  const alreadyMember = grant?.outcome === 'already_member';

  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Enter as owner</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Get temporary owner access to help this church. Every change you make inside is recorded in Activity.
      </p>

      {alreadyMember ? (
        <Notice tone="info" className="mt-3">
          You are already a member of this church, so nothing was added.
          <div className="mt-2">
            <OpenInServiceCenter organizationId={summary.id} />
          </div>
        </Notice>
      ) : expiresAt ? (
        <Notice tone="success" className="mt-3">
          {grant?.outcome === 'extended' ? 'Access extended. ' : grant?.outcome === 'granted' ? 'You are in. ' : ''}
          You have owner access until <strong className="font-semibold">{formatDateTime(expiresAt)}</strong> (
          {formatRelativeTime(expiresAt)}).
          <div className="mt-2 flex flex-wrap gap-2">
            <OpenInServiceCenter organizationId={summary.id} />
            <Button variant="secondary" size="sm" loading={exit.isPending} onClick={leave}>
              Exit church
            </Button>
          </div>
        </Notice>
      ) : null}

      {summary.status === 'disabled' && !expiresAt && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">This church is disabled; enable it before working inside it.</p>
      )}

      {!alreadyMember && (
        <form onSubmit={submit} className="mt-3 flex items-end gap-2" noValidate>
          <TextField
            label="Hours"
            type="number"
            min={1}
            max={24}
            step={1}
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            error={hoursError}
            className="w-24"
          />
          <Button type="submit" variant={expiresAt ? 'secondary' : 'primary'} loading={enter.isPending} className={hoursError ? 'mb-5' : ''}>
            {expiresAt ? 'Extend' : 'Enter as owner'}
          </Button>
        </form>
      )}
      <ErrorNotice error={enter.error ?? exit.error} className="mt-3" />
    </Card>
  );
};

interface QuotaCardProps {
  summary: AdminOrganizationSummary;
}

const QuotaCard = ({ summary }: QuotaCardProps) => {
  const save = useSetOrganizationQuota();
  const [value, setValue] = useState(() => (summary.quota_is_custom ? megabytesFieldValue(summary.storage_quota_bytes) : ''));
  const [inputError, setInputError] = useState<string | undefined>();
  const [saved, setSaved] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = quotaBytesFromInput(value);
    if (!result.ok) {
      setInputError(result.message);
      return;
    }
    setInputError(undefined);
    setSaved(null);
    save.mutate(
      { organizationId: summary.id, storageQuotaBytes: result.bytes },
      { onSuccess: () => setSaved(`Quota set to ${formatFileSize(result.bytes)}.`) },
    );
  };

  const resetToDefault = () => {
    setInputError(undefined);
    setSaved(null);
    save.mutate(
      { organizationId: summary.id, storageQuotaBytes: null },
      {
        onSuccess: () => {
          setValue('');
          setSaved('This church now uses the platform default.');
        },
      },
    );
  };

  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Storage quota</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Now {formatFileSize(summary.storage_quota_bytes)} ({summary.quota_is_custom ? 'custom' : 'platform default'}), {formatFileSize(summary.storage_used_bytes)} used.
      </p>
      <form onSubmit={submit} className="mt-3 space-y-3" noValidate>
        <TextField
          label="Custom quota (MB)"
          inputMode="decimal"
          placeholder={summary.quota_is_custom ? undefined : 'Platform default'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          error={inputError}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" loading={save.isPending && save.variables?.storageQuotaBytes !== null}>
            Save quota
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!summary.quota_is_custom}
            loading={save.isPending && save.variables?.storageQuotaBytes === null}
            onClick={resetToDefault}
          >
            Use platform default
          </Button>
        </div>
      </form>
      {saved && !save.isPending && (
        <Notice tone="success" className="mt-3">
          {saved}
        </Notice>
      )}
      <ErrorNotice error={save.error} className="mt-3" />
    </Card>
  );
};

interface StatusCardProps {
  summary: AdminOrganizationSummary;
}

const StatusCard = ({ summary }: StatusCardProps) => {
  const [confirming, setConfirming] = useState(false);
  const disabled = summary.status === 'disabled';
  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{disabled ? 'Enable church' : 'Disable church'}</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {disabled
          ? 'Members get their access back. Their data was kept while the church was disabled.'
          : 'Members lose access until you enable it again. No data is deleted.'}
      </p>
      <Button variant={disabled ? 'primary' : 'danger'} size="sm" className="mt-3" onClick={() => setConfirming(true)}>
        {disabled ? 'Enable…' : 'Disable…'}
      </Button>
      {confirming &&
        (disabled ? (
          <EnableModal summary={summary} onClose={() => setConfirming(false)} />
        ) : (
          <DisableModal summary={summary} onClose={() => setConfirming(false)} />
        ))}
    </Card>
  );
};

interface StatusModalProps {
  summary: AdminOrganizationSummary;
  onClose: () => void;
}

const DisableModal = ({ summary, onClose }: StatusModalProps) => {
  const disable = useDisableOrganization();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();

  const confirm = () => {
    const parsed = disableOrganizationSchema.safeParse({ reason });
    if (!parsed.success) {
      setReasonError('Give a reason (up to 500 characters).');
      return;
    }
    setReasonError(undefined);
    disable.mutate({ organizationId: summary.id, reason: parsed.data.reason }, { onSuccess: onClose });
  };

  return (
    <Modal
      open
      title={`Disable ${summary.name}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={disable.isPending} onClick={confirm}>
            Disable church
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>
            {summary.accounts === 1
              ? 'Its 1 member loses access on the web, mobile and API right away.'
              : `All ${formatCount(summary.accounts)} members lose access on the web, mobile and API right away.`}
          </li>
          <li>Scheduled emails and notifications stop.</li>
          <li>No data is deleted. Enabling the church restores everyone's access.</li>
        </ul>
        <TextAreaField
          label="Reason"
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={reasonError}
          hint="Shown to the church's owners."
          maxLength={500}
        />
        <ErrorNotice error={disable.error} />
      </div>
    </Modal>
  );
};

const EnableModal = ({ summary, onClose }: StatusModalProps) => {
  const enable = useEnableOrganization();
  return (
    <Modal
      open
      title={`Enable ${summary.name}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={enable.isPending} onClick={() => enable.mutate(summary.id, { onSuccess: onClose })}>
            Enable church
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Members who were active when the church was disabled get their access back. Members who were already inactive stay inactive.
        </p>
        <ErrorNotice error={enable.error} />
      </div>
    </Modal>
  );
};
