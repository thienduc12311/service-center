import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addLocalDays,
  formatDateTime,
  localDateAt,
  reportTable,
  REPORT_TITLES,
  type AnyReport,
  type ReportExportSummary,
  type ReportFiltersRequest,
  type ReportKind,
} from '@service-center/shared';
import { api } from '../lib/api';
import { keys, useServiceTypes, useTeams } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { printDocument } from '../lib/print-document';
import { reportPrintHtml } from '../lib/report-print';

const KINDS: readonly ReportKind[] = ['staffing', 'participation', 'schedule', 'song_usage', 'run_times'];
const PLAN_STATUSES = ['published', 'draft', 'archived'] as const;
const RESPONSES = [
  ['confirmed', 'Confirmed'],
  ['unconfirmed', 'Pending'],
  ['declined', 'Declined'],
] as const;

const fetchReport = (kind: ReportKind, filters: ReportFiltersRequest): Promise<AnyReport> => {
  switch (kind) {
    case 'staffing':
      return api.staffingReport(filters);
    case 'participation':
      return api.participationReport(filters);
    case 'song_usage':
      return api.songUsageReport(filters);
    case 'run_times':
      return api.runTimesReport(filters);
    case 'schedule':
      return api.scheduleReport(filters);
  }
};

const downloadText = (text: string, filename: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const EXPORT_TONES: Record<ReportExportSummary['status'], string> = {
  queued: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  running: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  ready: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  failed: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  expired: 'bg-slate-100 text-slate-500 ring-slate-500/20',
};

/**
 * F16 operational reports. Screen, print and CSV all come from the same built
 * report, so they reconcile; each identifies its filters, timezone,
 * generation time and metric definitions.
 */
export const ReportsPage = () => {
  const { organizationId, canAnywhere, user } = useAuth();
  const timezone = user?.memberships.find((m) => m.organization.id === organizationId)?.organization.timezone ?? 'UTC';
  const today = localDateAt(Date.now(), timezone);
  const available = KINDS.filter((kind) =>
    kind === 'song_usage'
      ? canAnywhere('plans.edit') || canAnywhere('songs.manage')
      : kind === 'run_times'
        ? canAnywhere('plans.edit')
        : canAnywhere('scheduling.manage'),
  );
  const [kind, setKind] = useState<ReportKind>(available[0] ?? 'staffing');
  const [draft, setDraft] = useState<ReportFiltersRequest>({
    from: addLocalDays(today, -28),
    to: addLocalDays(today, 28),
    plan_statuses: ['published'],
    assignment_statuses: ['confirmed', 'unconfirmed', 'declined'],
    include_archived_people: true,
    include_rehearsals: false,
  });
  const [filters, setFilters] = useState<ReportFiltersRequest | null>(null);
  const serviceTypes = useServiceTypes();
  const teams = useTeams();
  const queryClient = useQueryClient();

  const report = useQuery({
    queryKey: keys.report(organizationId, kind, filters),
    queryFn: () => fetchReport(kind, filters!),
    enabled: Boolean(filters),
  });
  const table = useMemo(() => (report.data ? reportTable(report.data) : null), [report.data]);

  const csv = useMutation({
    mutationFn: async () => downloadText(await api.reportCsv(kind, filters!), `${kind.replace('_', '-')}-${filters!.from}-to-${filters!.to}.csv`),
  });
  const exports = useQuery({
    queryKey: keys.reportExports(organizationId),
    queryFn: () => api.reportExports(),
    refetchInterval: (query) => (query.state.data?.some((row) => row.status === 'queued' || row.status === 'running') ? 5000 : false),
  });
  const queueExport = useMutation({
    mutationFn: () => api.requestReportExport({ kind, filters: filters!, idempotency_key: crypto.randomUUID() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.reportExports(organizationId) }),
  });

  if (available.length === 0) {
    return <EmptyState title="Reports are for leaders" description="Ask an administrator for scheduling or planning access." />;
  }

  const toggle = <T extends string>(list: T[] | undefined, value: T, on: boolean): T[] =>
    on ? [...new Set([...(list ?? []), value])] : (list ?? []).filter((item) => item !== value);

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" subtitle={`Dates are in ${timezone}. Confirmed answers are planned participation, not attendance.`} />

      <div role="tablist" aria-label="Report" className="flex flex-wrap gap-2">
        {available.map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={kind === value}
            onClick={() => setKind(value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${kind === value ? 'bg-brand-600 text-white ring-brand-600' : 'text-slate-600 ring-slate-300'}`}
          >
            {REPORT_TITLES[value]}
          </button>
        ))}
      </div>

      <form
        className="card grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters({ ...draft });
        }}
      >
        <label className="text-sm">
          From
          <input type="date" className="input mt-1" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} required />
        </label>
        <label className="text-sm">
          To
          <input type="date" className="input mt-1" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} required />
        </label>
        <label className="text-sm">
          Service type
          <select
            className="input mt-1"
            value={draft.service_type_ids?.[0] ?? ''}
            onChange={(e) => setDraft({ ...draft, service_type_ids: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">All I can see</option>
            {(serviceTypes.data ?? []).map((st) => (
              <option key={st.id} value={st.id}>{st.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Team
          <select
            className="input mt-1"
            value={draft.team_ids?.[0] ?? ''}
            onChange={(e) => setDraft({ ...draft, team_ids: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">All I can see</option>
            {(teams.data ?? []).map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </label>
        <fieldset className="text-sm">
          <legend>Plan status</legend>
          {PLAN_STATUSES.map((status) => (
            <label key={status} className="mr-3 inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.plan_statuses?.includes(status) ?? false}
                onChange={(e) => setDraft({ ...draft, plan_statuses: toggle(draft.plan_statuses, status, e.target.checked) })}
              />
              {status}
            </label>
          ))}
        </fieldset>
        <fieldset className="text-sm">
          <legend>Responses</legend>
          {RESPONSES.map(([value, label]) => (
            <label key={value} className="mr-3 inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.assignment_statuses?.includes(value) ?? false}
                onChange={(e) => setDraft({ ...draft, assignment_statuses: toggle(draft.assignment_statuses, value, e.target.checked) })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.include_archived_people ?? true}
              onChange={(e) => setDraft({ ...draft, include_archived_people: e.target.checked })}
            />
            Include archived people
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.include_rehearsals ?? false}
              onChange={(e) => setDraft({ ...draft, include_rehearsals: e.target.checked })}
            />
            Include rehearsals
          </label>
        </div>
        <div className="flex items-end">
          <Button type="submit">Run report</Button>
        </div>
      </form>

      {!filters ? (
        <EmptyState title="Choose filters and run the report" />
      ) : report.isLoading ? (
        <Loading label="Building report…" />
      ) : report.error ? (
        <div className="space-y-2">
          <ErrorNotice error={report.error} />
          <Button variant="secondary" onClick={() => report.refetch()}>Try again</Button>
        </div>
      ) : report.data && table ? (
        <section className="space-y-4" aria-label={report.data.title}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Generated {formatDateTime(report.data.generated_at)} · {report.data.filters.timezone}
              {report.data.scope_note ? ` · ${report.data.scope_note}` : ''}
              {report.data.truncated ? ' · Truncated: narrow the filters, or queue an export.' : ''}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => printDocument(reportPrintHtml(report.data!), report.data!.title)}>Print</Button>
              <Button variant="secondary" loading={csv.isPending} onClick={() => csv.mutate()}>Download CSV</Button>
              <Button variant="secondary" loading={queueExport.isPending} onClick={() => queueExport.mutate()}>Queue export</Button>
            </div>
          </div>
          <ErrorNotice error={csv.error ?? queueExport.error} />
          <ReportSummary report={report.data} />
          {table.rows.length === 0 ? (
            <EmptyState title="Nothing matches these filters" />
          ) : (
            <div className="card overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-900">
                  <tr>{table.columns.map((column) => <th key={column} scope="col" className="px-3 py-2 font-medium">{column}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {table.rows.map((row, index) => (
                    <tr key={index}>{row.map((value, i) => <td key={i} className="whitespace-nowrap px-3 py-1.5">{value === null ? '' : String(value)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">How these numbers are counted</summary>
            <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
              {report.data.definitions.map((d) => (
                <div key={d.key} className="contents">
                  <dt className="font-medium">{d.label}</dt>
                  <dd className="text-slate-600">{d.definition}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      ) : null}

      <section aria-labelledby="exports-heading" className="space-y-2">
        <h2 id="exports-heading" className="text-base font-semibold">My exports</h2>
        <p className="text-xs text-slate-500">
          Exports are built in the background, kept for 24 hours, and only you can download them while you still have access.
        </p>
        {exports.error && <ErrorNotice error={exports.error} />}
        <ul className="card divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {(exports.data ?? []).length === 0 && <li className="px-4 py-3 text-slate-500">No exports yet.</li>}
          {(exports.data ?? []).map((row) => (
            <ExportRow key={row.id} row={row} />
          ))}
        </ul>
      </section>
    </div>
  );
};

const ReportSummary = ({ report }: { report: AnyReport }) => {
  const entries: Array<[string, number | string]> =
    report.kind === 'staffing'
      ? [['Plans', report.summary.plans], ['Needed', report.summary.needed], ['Confirmed', report.summary.confirmed], ['Pending', report.summary.pending], ['Declined', report.summary.declined], ['Vacancies', report.summary.vacancies]]
      : report.kind === 'participation'
        ? [['People', report.summary.people], ['Assignments', report.summary.assignments], ['Person-plans', report.summary.person_plans], ['Present', report.summary.present], ['Absent', report.summary.absent]]
        : report.kind === 'song_usage'
          ? [['Songs', report.summary.songs], ['Occurrences', report.summary.occurrences], ['Plans', report.summary.plans]]
          : report.kind === 'run_times'
            ? [['Ended runs', report.summary.runs], ['Average difference (s)', report.summary.average_difference_seconds]]
            : [['Plans', report.summary.plans], ['Assignments', report.summary.assignments], ['People', report.summary.people]];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {entries.map(([label, value]) => (
          <div key={label} className="card px-3 py-2">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {report.kind === 'staffing' && report.summary.follow_ups.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Follow up ({report.summary.follow_ups.length})</h3>
          <ul className="space-y-1 text-sm">
            {report.summary.follow_ups.slice(0, 50).map((row, index) => (
              <li key={index}>
                {row.person_name} — {row.team_name} · {row.position_name} on {row.plan_title}:{' '}
                {row.response === 'unconfirmed' ? 'pending' : 'declined'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const ExportRow = ({ row }: { row: ReportExportSummary }) => {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const download = useMutation({
    mutationFn: () => api.reportExportDownload(row.id),
    onSuccess: (link) => {
      window.location.assign(link.url);
    },
  });
  const retry = useMutation({
    mutationFn: () => api.retryReportExport(row.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.reportExports(organizationId) }),
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
      <span>
        {REPORT_TITLES[row.kind]} · {String(row.filters.from)} to {String(row.filters.to)}{' '}
        <Badge tone={EXPORT_TONES[row.status]}>{row.status}</Badge>
        {row.error_code && <span className="ml-2 text-xs text-rose-600">{row.error_code.replace(/_/g, ' ')}</span>}
        {row.expires_at && row.status === 'ready' && <span className="ml-2 text-xs text-slate-500">until {formatDateTime(row.expires_at)}</span>}
      </span>
      <span className="flex gap-2">
        {row.status === 'ready' && <Button variant="secondary" loading={download.isPending} onClick={() => download.mutate()}>Download</Button>}
        {(row.status === 'failed' || row.status === 'expired') && (
          <Button variant="ghost" loading={retry.isPending} onClick={() => retry.mutate()}>Build again</Button>
        )}
      </span>
      <ErrorNotice error={download.error ?? retry.error} />
    </li>
  );
};
