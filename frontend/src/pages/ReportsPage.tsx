import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  canRebuildReportExport,
  defaultReportFilters,
  reportExportErrorKey,
  reportExportStatusAt,
  reportExportsInProgress,
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
import {
  followUpResponse,
  localizedDefinitions,
  localizedReportTable,
  reportPrintHtml,
  reportScopeNote,
  reportTitle,
  type ReportLocalization,
} from '../lib/report-print';
import { useFormatters, useLanguage } from '../i18n';

const KINDS: readonly ReportKind[] = ['staffing', 'participation', 'schedule', 'song_usage', 'run_times'];
const PLAN_STATUSES = ['published', 'draft', 'archived'] as const;
const RESPONSES = [
  ['confirmed', 'responses.confirmed'],
  ['unconfirmed', 'responses.pending'],
  ['declined', 'responses.declined'],
] as const;

/** Translator, formatters and language for one render of the page. */
const useReportLocalization = (): ReportLocalization => {
  const { t } = useTranslation(['reports', 'common']);
  const formatters = useFormatters();
  const { locale } = useLanguage();
  return useMemo(() => ({ t, formatters, locale }), [t, formatters, locale]);
};

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
  const localization = useReportLocalization();
  const { t, formatters } = localization;
  const timezone = user?.memberships.find((m) => m.organization.id === organizationId)?.organization.timezone ?? 'UTC';
  const available = KINDS.filter((kind) =>
    kind === 'song_usage'
      ? canAnywhere('plans.edit') || canAnywhere('songs.manage')
      : kind === 'run_times'
        ? canAnywhere('plans.edit')
        : canAnywhere('scheduling.manage'),
  );
  const [kind, setKind] = useState<ReportKind>(available[0] ?? 'staffing');
  // The same starting filters as the native report screen (MOB-022).
  const [draft, setDraft] = useState<ReportFiltersRequest>(() => defaultReportFilters(Date.now(), timezone));
  const [filters, setFilters] = useState<ReportFiltersRequest | null>(null);
  const serviceTypes = useServiceTypes();
  const teams = useTeams();
  const queryClient = useQueryClient();

  const report = useQuery({
    queryKey: keys.report(organizationId, kind, filters),
    queryFn: () => fetchReport(kind, filters!),
    enabled: Boolean(filters),
  });
  const table = useMemo(() => (report.data ? localizedReportTable(report.data, localization) : null), [report.data, localization]);

  const csv = useMutation({
    mutationFn: async () => downloadText(await api.reportCsv(kind, filters!), `${kind.replace('_', '-')}-${filters!.from}-to-${filters!.to}.csv`),
  });
  const exports = useQuery({
    queryKey: keys.reportExports(organizationId),
    queryFn: () => api.reportExports(),
    refetchInterval: (query) => (reportExportsInProgress(query.state.data) ? 5000 : false),
  });
  const queueExport = useMutation({
    mutationFn: () => api.requestReportExport({ kind, filters: filters!, idempotency_key: crypto.randomUUID() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.reportExports(organizationId) }),
  });

  if (available.length === 0) {
    return <EmptyState title={t('page.leadersOnlyTitle')} description={t('page.leadersOnlyDescription')} />;
  }

  const toggle = <T extends string>(list: T[] | undefined, value: T, on: boolean): T[] =>
    on ? [...new Set([...(list ?? []), value])] : (list ?? []).filter((item) => item !== value);

  return (
    <div className="space-y-6">
      <PageHeader title={t('page.title')} subtitle={t('page.subtitle', { timezone })} />

      <div role="tablist" aria-label={t('page.tabsLabel')} className="flex flex-wrap gap-2">
        {available.map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={kind === value}
            onClick={() => setKind(value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${kind === value ? 'bg-brand-600 text-white ring-brand-600' : 'text-slate-600 ring-slate-300'}`}
          >
            {reportTitle(value, t)}
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
        <label className="field">
          {t('filters.from')}
          <input type="date" className="input" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} required />
        </label>
        <label className="field">
          {t('filters.to')}
          <input type="date" className="input" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} required />
        </label>
        <label className="field">
          {t('filters.serviceType')}
          <select
            className="input"
            value={draft.service_type_ids?.[0] ?? ''}
            onChange={(e) => setDraft({ ...draft, service_type_ids: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">{t('filters.allVisible')}</option>
            {(serviceTypes.data ?? []).map((st) => (
              <option key={st.id} value={st.id}>{st.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('filters.team')}
          <select
            className="input"
            value={draft.team_ids?.[0] ?? ''}
            onChange={(e) => setDraft({ ...draft, team_ids: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">{t('filters.allVisible')}</option>
            {(teams.data ?? []).map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </label>
        <fieldset className="text-sm">
          <legend className="label">{t('filters.planStatus')}</legend>
          {PLAN_STATUSES.map((status) => (
            <label key={status} className="mr-3 inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.plan_statuses?.includes(status) ?? false}
                onChange={(e) => setDraft({ ...draft, plan_statuses: toggle(draft.plan_statuses, status, e.target.checked) })}
              />
              {t(`common:planStatus.${status}`)}
            </label>
          ))}
        </fieldset>
        <fieldset className="text-sm">
          <legend className="label">{t('filters.responses')}</legend>
          {RESPONSES.map(([value, label]) => (
            <label key={value} className="mr-3 inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.assignment_statuses?.includes(value) ?? false}
                onChange={(e) => setDraft({ ...draft, assignment_statuses: toggle(draft.assignment_statuses, value, e.target.checked) })}
              />
              {t(label)}
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
            {t('filters.includeArchivedPeople')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.include_rehearsals ?? false}
              onChange={(e) => setDraft({ ...draft, include_rehearsals: e.target.checked })}
            />
            {t('filters.includeRehearsals')}
          </label>
        </div>
        <div className="flex items-end">
          <Button type="submit">{t('filters.run')}</Button>
        </div>
      </form>

      {!filters ? (
        <EmptyState title={t('results.choose')} />
      ) : report.isLoading ? (
        <Loading label={t('results.building')} />
      ) : report.error ? (
        <div className="space-y-2">
          <ErrorNotice error={report.error} />
          <Button variant="secondary" onClick={() => report.refetch()}>{t('common:actions.retry')}</Button>
        </div>
      ) : report.data && table ? (
        <section className="space-y-4" aria-label={reportTitle(report.data.kind, t)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {[
                t('results.generated', {
                  time: formatters.dateTime(report.data.generated_at, { timeZone: report.data.filters.timezone }),
                  timezone: report.data.filters.timezone,
                }),
                reportScopeNote(report.data, t),
                report.data.truncated ? t('results.truncated') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => printDocument(reportPrintHtml(report.data!, localization), reportTitle(report.data!.kind, t))}
              >
                {t('common:actions.print')}
              </Button>
              <Button variant="secondary" loading={csv.isPending} onClick={() => csv.mutate()}>{t('results.downloadCsv')}</Button>
              <Button variant="secondary" loading={queueExport.isPending} onClick={() => queueExport.mutate()}>{t('results.queueExport')}</Button>
            </div>
          </div>
          <ErrorNotice error={csv.error ?? queueExport.error} />
          <ReportSummary report={report.data} />
          {table.rows.length === 0 ? (
            <EmptyState title={t('results.noMatches')} />
          ) : (
            <div className="card overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-900">
                  <tr>{table.columns.map((column) => <th key={column} scope="col" className="px-3 py-2 font-medium">{column}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {table.rows.map((row, index) => (
                    <tr key={index}>{row.map((value, i) => <td key={i} className="whitespace-nowrap px-3 py-1.5">{value}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">{t('results.howCounted')}</summary>
            <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
              {localizedDefinitions(report.data, t).map((d) => (
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
        <h2 id="exports-heading" className="text-base font-semibold">{t('exports.title')}</h2>
        <p className="text-xs text-slate-500">{t('exports.help')}</p>
        {exports.error && <ErrorNotice error={exports.error} />}
        <ul className="card divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {(exports.data ?? []).length === 0 && <li className="px-4 py-3 text-slate-500">{t('exports.empty')}</li>}
          {(exports.data ?? []).map((row) => (
            <ExportRow key={row.id} row={row} />
          ))}
        </ul>
      </section>
    </div>
  );
};

/** One summary tile: a translated label and its value. */
type SummaryKey =
  | 'plans'
  | 'needed'
  | 'confirmed'
  | 'pending'
  | 'declined'
  | 'vacancies'
  | 'people'
  | 'assignments'
  | 'personPlans'
  | 'present'
  | 'absent'
  | 'songs'
  | 'occurrences'
  | 'endedRuns'
  | 'averageDifference';

interface ReportSummaryProps {
  report: AnyReport;
}

const ReportSummary = ({ report }: ReportSummaryProps) => {
  const { t } = useTranslation(['reports', 'common']);
  const formatters = useFormatters();
  const entries: Array<[SummaryKey, number]> =
    report.kind === 'staffing'
      ? [['plans', report.summary.plans], ['needed', report.summary.needed], ['confirmed', report.summary.confirmed], ['pending', report.summary.pending], ['declined', report.summary.declined], ['vacancies', report.summary.vacancies]]
      : report.kind === 'participation'
        ? [['people', report.summary.people], ['assignments', report.summary.assignments], ['personPlans', report.summary.person_plans], ['present', report.summary.present], ['absent', report.summary.absent]]
        : report.kind === 'song_usage'
          ? [['songs', report.summary.songs], ['occurrences', report.summary.occurrences], ['plans', report.summary.plans]]
          : report.kind === 'run_times'
            ? [['endedRuns', report.summary.runs], ['averageDifference', report.summary.average_difference_seconds]]
            : [['plans', report.summary.plans], ['assignments', report.summary.assignments], ['people', report.summary.people]];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {entries.map(([key, value]) => (
          <div key={key} className="card px-3 py-2">
            <dt className="text-xs text-slate-500">{t(`summary.${key}`)}</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatters.number(value)}</dd>
          </div>
        ))}
      </dl>
      {report.kind === 'staffing' && report.summary.follow_ups.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">{t('followUp.title', { total: formatters.number(report.summary.follow_ups.length) })}</h3>
          <ul className="space-y-1 text-sm">
            {report.summary.follow_ups.slice(0, 50).map((row, index) => (
              <li key={index}>
                {t('followUp.line', {
                  person: row.person_name,
                  team: row.team_name,
                  position: row.position_name,
                  plan: row.plan_title,
                  response: followUpResponse(row.response, t),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

interface ExportRowProps {
  row: ReportExportSummary;
}

const ExportRow = ({ row }: ExportRowProps) => {
  const { t } = useTranslation(['reports', 'common']);
  const formatters = useFormatters();
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
  const status = reportExportStatusAt(row, Date.now());
  const errorKey = reportExportErrorKey(row.error_code);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
      <span>
        {t('exports.range', {
          kind: reportTitle(row.kind, t),
          from: formatters.calendarDate(String(row.filters.from), 'medium'),
          to: formatters.calendarDate(String(row.filters.to), 'medium'),
        })}{' '}
        <Badge tone={EXPORT_TONES[status]}>{t(`exports.status.${status}`)}</Badge>
        {errorKey && <span className="ml-2 text-xs text-rose-600">{t(`exports.errors.${errorKey}`)}</span>}
        {row.expires_at && status === 'ready' && (
          <span className="ml-2 text-xs text-slate-500">{t('exports.until', { time: formatters.dateTime(row.expires_at) })}</span>
        )}
      </span>
      <span className="flex gap-2">
        {status === 'ready' && (
          <Button variant="secondary" loading={download.isPending} onClick={() => download.mutate()}>
            {t('common:actions.download')}
          </Button>
        )}
        {canRebuildReportExport(status) && (
          <Button variant="ghost" loading={retry.isPending} onClick={() => retry.mutate()}>{t('exports.buildAgain')}</Button>
        )}
      </span>
      <ErrorNotice error={download.error ?? retry.error} />
    </li>
  );
};
