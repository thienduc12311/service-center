import type { TFunction } from 'i18next';
import { reportTable, type AnyReport, type AssignmentStatus, type ReportKind } from '@service-center/shared';
import type { Formatters } from '../i18n';

/** Translator for report text: the `reports` namespace, plus `common` for plan statuses. */
export type ReportTranslator = TFunction<['reports', 'common']>;

/** Everything needed to show a report in the viewer's language. */
export interface ReportLocalization {
  t: ReportTranslator;
  formatters: Formatters;
  /** The displayed language code, used as the print document's `lang`. */
  locale: string;
}

/** A report table cell value as the shared builder produces it. */
export type ReportCellValue = string | number | boolean | null;

/** A report table with translated headings and display-formatted cells. */
export interface LocalizedReportTable {
  columns: string[];
  rows: string[][];
}

type ReportColumnKey =
  | 'date'
  | 'plan'
  | 'serviceType'
  | 'team'
  | 'position'
  | 'needed'
  | 'confirmed'
  | 'pending'
  | 'declined'
  | 'vacancies'
  | 'person'
  | 'archived'
  | 'teams'
  | 'assignments'
  | 'personPlans'
  | 'present'
  | 'absent'
  | 'unknown'
  | 'lastScheduled'
  | 'song'
  | 'author'
  | 'occurrences'
  | 'plans'
  | 'keys'
  | 'firstUsed'
  | 'lastUsed'
  | 'time'
  | 'planned'
  | 'actual'
  | 'difference'
  | 'items'
  | 'itemsOver'
  | 'corrected'
  | 'response'
  | 'times';

/** How a cell is shown: as-is, a calendar date, a yes/no flag or an assignment response. */
type ReportCellFormat = 'text' | 'date' | 'yesNo' | 'response';

interface ReportColumn {
  key: ReportColumnKey;
  format: ReportCellFormat;
}

const col = (key: ReportColumnKey, format: ReportCellFormat = 'text'): ReportColumn => ({ key, format });

/**
 * The columns of `reportTable` (packages/shared/src/lib/reports.ts), in the
 * same order. Screen and print translate headings by these keys; CSV keeps
 * the shared English headings as its machine format.
 */
const REPORT_COLUMNS: Record<ReportKind, readonly ReportColumn[]> = {
  staffing: [
    col('date', 'date'), col('plan'), col('serviceType'), col('team'), col('position'),
    col('needed'), col('confirmed'), col('pending'), col('declined'), col('vacancies'),
  ],
  participation: [
    col('person'), col('archived', 'yesNo'), col('teams'), col('assignments'), col('personPlans'), col('confirmed'),
    col('pending'), col('declined'), col('present'), col('absent'), col('unknown'), col('lastScheduled', 'date'),
  ],
  song_usage: [col('song'), col('author'), col('occurrences'), col('plans'), col('keys'), col('firstUsed', 'date'), col('lastUsed', 'date')],
  run_times: [
    col('date', 'date'), col('plan'), col('time'), col('planned'), col('actual'), col('difference'),
    col('items'), col('itemsOver'), col('corrected', 'yesNo'),
  ],
  schedule: [col('date', 'date'), col('plan'), col('serviceType'), col('team'), col('position'), col('person'), col('response', 'response'), col('times')],
};

const RESPONSE_KEYS: Record<AssignmentStatus, 'responses.confirmed' | 'responses.pending' | 'responses.declined'> = {
  confirmed: 'responses.confirmed',
  unconfirmed: 'responses.pending',
  declined: 'responses.declined',
};

const isAssignmentStatus = (value: string): value is AssignmentStatus =>
  value === 'confirmed' || value === 'unconfirmed' || value === 'declined';

const formatCell = (value: ReportCellValue, format: ReportCellFormat, { t, formatters }: ReportLocalization): string => {
  if (value === null) return '';
  const text = String(value);
  switch (format) {
    case 'date':
      return formatters.calendarDate(text, 'medium');
    case 'yesNo':
      return text === 'yes' ? t('values.yes') : text === 'no' ? t('values.no') : text;
    case 'response':
      return isAssignmentStatus(text) ? t(RESPONSE_KEYS[text]) : text;
    case 'text':
      return typeof value === 'number' ? formatters.number(value) : text;
  }
};

/** The shared report table with translated headings and display-formatted cells. */
export const localizedReportTable = (report: AnyReport, localization: ReportLocalization): LocalizedReportTable => {
  const table = reportTable(report);
  const columns = REPORT_COLUMNS[report.kind];
  // If the shared table ever gains a column this map does not know, show its own heading.
  const columnAt = (index: number): ReportColumn | undefined => (columns.length === table.columns.length ? columns[index] : undefined);
  return {
    columns: table.columns.map((heading, index) => {
      const column = columnAt(index);
      return column ? localization.t(`columns.${column.key}`) : heading;
    }),
    rows: table.rows.map((row) => row.map((value, index) => formatCell(value, columnAt(index)?.format ?? 'text', localization))),
  };
};

/** The report's title in the viewer's language. */
export const reportTitle = (kind: ReportKind, t: ReportTranslator): string => t(`kinds.${kind}`);

/**
 * What the caller's access left out. The server sends one fixed note per
 * report kind, so it is translated by kind.
 */
export const reportScopeNote = (report: Pick<AnyReport, 'kind' | 'scope_note'>, t: ReportTranslator): string | null => {
  if (!report.scope_note) return null;
  return report.kind === 'staffing' || report.kind === 'participation' || report.kind === 'schedule'
    ? t('scopeNote.scheduling')
    : t('scopeNote.plans');
};

type DefinitionKey =
  | 'needed'
  | 'confirmed'
  | 'pending'
  | 'declined'
  | 'vacancies'
  | 'assignments'
  | 'person_plans'
  | 'people'
  | 'present'
  | 'absent'
  | 'unknown'
  | 'occurrences'
  | 'plans'
  | 'planned_seconds'
  | 'actual_seconds'
  | 'difference_seconds'
  | 'response';

const DEFINITION_KEYS: readonly DefinitionKey[] = [
  'needed', 'confirmed', 'pending', 'declined', 'vacancies', 'assignments', 'person_plans', 'people', 'present',
  'absent', 'unknown', 'occurrences', 'plans', 'planned_seconds', 'actual_seconds', 'difference_seconds', 'response',
];

const isDefinitionKey = (key: string): key is DefinitionKey => (DEFINITION_KEYS as readonly string[]).includes(key);

/** A metric definition shown with a report. */
export interface LocalizedDefinition {
  key: string;
  label: string;
  definition: string;
}

/** Metric definitions translated by their stable key (unknown keys keep the server text). */
export const localizedDefinitions = (report: Pick<AnyReport, 'definitions'>, t: ReportTranslator): LocalizedDefinition[] =>
  report.definitions.map((d) =>
    isDefinitionKey(d.key)
      ? { key: d.key, label: t(`definitions.${d.key}.label`), definition: t(`definitions.${d.key}.definition`) }
      : { key: d.key, label: d.label, definition: d.definition },
  );

/** Follow-up response wording ("Pending" / "Declined"). */
export const followUpResponse = (response: AssignmentStatus, t: ReportTranslator): string => t(RESPONSE_KEYS[response]);

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Print view of a report: the same table the screen and CSV use, with the
 * generation time, timezone, filters and metric definitions — in the
 * viewer's language. User content (plan, person, team names) is unchanged.
 */
export const reportPrintHtml = (report: AnyReport, localization: ReportLocalization): string => {
  const { t, formatters } = localization;
  const table = localizedReportTable(report, localization);
  const f = report.filters;
  const title = reportTitle(report.kind, t);
  const followUps =
    report.kind === 'staffing' && report.summary.follow_ups.length
      ? `<h2>${escapeHtml(t('print.followUp'))}</h2><table><thead><tr>${[
          t('columns.plan'),
          t('columns.person'),
          t('columns.team'),
          t('columns.position'),
          t('columns.response'),
        ]
          .map((heading) => `<th>${escapeHtml(heading)}</th>`)
          .join('')}</tr></thead><tbody>${report.summary.follow_ups
          .map(
            (row) =>
              `<tr><td>${escapeHtml(row.plan_title)}</td><td>${escapeHtml(row.person_name)}</td><td>${escapeHtml(row.team_name)}</td><td>${escapeHtml(row.position_name)}</td><td>${escapeHtml(followUpResponse(row.response, t))}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '';
  const meta = [
    t('print.range', { from: formatters.calendarDate(f.from, 'medium'), to: formatters.calendarDate(f.to, 'medium') }),
    f.timezone,
    t('print.generated', { time: formatters.dateTime(report.generated_at, { timeZone: f.timezone, dateStyle: 'medium' }) }),
    t('print.planStatuses', { list: formatters.list(f.plan_statuses.map((status) => t(`common:planStatus.${status}`))) }),
    t('print.responses', { list: formatters.list(f.assignment_statuses.map((status) => t(RESPONSE_KEYS[status]))) }),
    f.include_archived_people ? t('print.archivedIncluded') : t('print.archivedExcluded'),
    f.include_rehearsals ? t('print.rehearsalsIncluded') : t('print.rehearsalsExcluded'),
  ].join(' · ');
  const scopeNote = reportScopeNote(report, t);
  return `<!doctype html><html lang="${escapeHtml(localization.locale)}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: landscape; margin: 12mm; }
  body { font: 11px/1.4 system-ui, sans-serif; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 13px; margin: 16px 0 6px; }
  .meta { color: #444; margin-bottom: 10px; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #ccc; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #f3f3f3; } tr { break-inside: avoid; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin-top: 14px; color: #333; } dt { font-weight: 600; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${escapeHtml(meta)}${scopeNote ? `<br>${escapeHtml(scopeNote)}` : ''}${report.truncated ? `<br>${escapeHtml(t('print.truncated'))}` : ''}</div>
<table><thead><tr>${table.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
<tbody>${table.rows.map((row) => `<tr>${row.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
${followUps}
<dl>${localizedDefinitions(report, t).map((d) => `<dt>${escapeHtml(d.label)}</dt><dd>${escapeHtml(d.definition)}</dd>`).join('')}</dl>
</body></html>`;
};
