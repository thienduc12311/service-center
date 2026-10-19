import { reportTable, type AnyReport } from '@service-center/shared';

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const cell = (value: string | number | boolean | null): string => escapeHtml(value === null ? '' : String(value));

/**
 * Print view of a report: the same table the screen and CSV use, with the
 * generation time, timezone, filters and metric definitions.
 */
export const reportPrintHtml = (report: AnyReport): string => {
  const table = reportTable(report);
  const f = report.filters;
  const followUps =
    report.kind === 'staffing' && report.summary.follow_ups.length
      ? `<h2>Follow up</h2><table><thead><tr><th>Plan</th><th>Person</th><th>Team</th><th>Position</th><th>Response</th></tr></thead><tbody>${report.summary.follow_ups
          .map(
            (row) =>
              `<tr><td>${cell(row.plan_title)}</td><td>${cell(row.person_name)}</td><td>${cell(row.team_name)}</td><td>${cell(row.position_name)}</td><td>${cell(row.response === 'unconfirmed' ? 'Pending' : 'Declined')}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title>
<style>
  @page { size: landscape; margin: 12mm; }
  body { font: 11px/1.4 system-ui, sans-serif; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 13px; margin: 16px 0 6px; }
  .meta { color: #444; margin-bottom: 10px; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #ccc; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #f3f3f3; } tr { break-inside: avoid; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin-top: 14px; color: #333; } dt { font-weight: 600; }
</style></head><body>
<h1>${escapeHtml(report.title)}</h1>
<div class="meta">${escapeHtml(`${f.from} to ${f.to} · ${f.timezone} · generated ${report.generated_at} (UTC) · plan statuses: ${f.plan_statuses.join(', ')} · responses: ${f.assignment_statuses.join(', ')} · archived people ${f.include_archived_people ? 'included' : 'excluded'} · rehearsals ${f.include_rehearsals ? 'included' : 'excluded'}`)}${report.scope_note ? `<br>${escapeHtml(report.scope_note)}` : ''}${report.truncated ? '<br>Truncated: narrow the filters for the full result.' : ''}</div>
<table><thead><tr>${table.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
<tbody>${table.rows.map((row) => `<tr>${row.map((v) => `<td>${cell(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
${followUps}
<dl>${report.definitions.map((d) => `<dt>${escapeHtml(d.label)}</dt><dd>${escapeHtml(d.definition)}</dd>`).join('')}</dl>
</body></html>`;
};
