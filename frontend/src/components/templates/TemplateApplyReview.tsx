import type { ReactNode } from 'react';
import {
  TEMPLATE_SKIP_REASON_LABELS,
  formatDateTime,
  type TemplateApplyPreview,
  type TemplatePreviewNotice,
} from '@service-center/shared';
import { useTemplateNames } from './useTemplateNames';

export interface TemplateApplyReviewProps {
  preview: TemplateApplyPreview;
  /** Generation previews describe a new plan: nothing is replaced or kept. */
  newPlan?: boolean;
}

const NoticeList = ({ notices, tone }: { notices: TemplatePreviewNotice[]; tone: 'block' | 'warn' }) =>
  notices.length === 0 ? null : (
    <ul
      role={tone === 'block' ? 'alert' : undefined}
      className={`space-y-1 rounded-lg p-3 text-sm ring-1 ${
        tone === 'block'
          ? 'bg-red-50 text-red-800 ring-red-600/20 dark:bg-red-950/40 dark:text-red-200'
          : 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-200'
      }`}
    >
      {notices.map((notice) => (
        <li key={`${notice.code}-${notice.message}`}>{notice.message}</li>
      ))}
    </ul>
  );

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex gap-3 border-t border-slate-100 py-2 text-sm first:border-t-0 dark:border-slate-800">
    <dt className="w-40 shrink-0 font-medium text-slate-600 dark:text-slate-300">{label}</dt>
    <dd className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">{children}</dd>
  </div>
);

/**
 * Exactly what applying will do, component by component: what is added,
 * removed, kept and skipped (with why), plus blocking problems and warnings.
 */
export const TemplateApplyReview = ({ preview, newPlan = false }: TemplateApplyReviewProps) => {
  const names = useTemplateNames();
  const replace = preview.mode === 'replace';
  return (
    <div className="space-y-3">
      <NoticeList notices={preview.blocking} tone="block" />
      <NoticeList notices={preview.warnings} tone="warn" />
      <dl className="rounded-lg bg-slate-50 px-3 py-1 dark:bg-slate-900">
        {preview.items && (
          <Row label="Order of service">
            {preview.items.add.length} item{preview.items.add.length === 1 ? '' : 's'} added
            {!newPlan && !replace && ` at position ${preview.items.insert_at + 1} of ${preview.items.existing_count + 1}`}
            {replace && preview.items.remove_count > 0 && `; ${preview.items.remove_count} current item(s) removed`}
            {preview.items.add.length > 0 && (
              <span className="block text-xs text-slate-500">{preview.items.add.map((item) => item.title).join(' · ')}</span>
            )}
            {preview.items.skipped.map((skip) => (
              <span key={skip.title} className="block text-xs text-amber-700 dark:text-amber-300">
                Skipped “{skip.title}”: {TEMPLATE_SKIP_REASON_LABELS[skip.reason] ?? skip.reason}
              </span>
            ))}
          </Row>
        )}
        {preview.times && (
          <Row label="Times">
            {preview.times.add.length === 0 ? 'No times in this template' : (
              <ul>
                {preview.times.add.map((time) => (
                  <li key={time.starts_at}>
                    {time.name ?? time.kind} — {time.local_date} {time.local_start} ({preview.timezone})
                    <span className="text-xs text-slate-400"> · {formatDateTime(time.starts_at)} your time</span>
                  </li>
                ))}
              </ul>
            )}
            {replace && preview.times.remove_count > 0 && <span className="block text-xs">{preview.times.remove_count} current time(s) removed</span>}
          </Row>
        )}
        {preview.notes && (
          <Row label="Plan notes">
            {preview.notes.action === 'none' ? 'The template has no notes; nothing changes'
              : preview.notes.action === 'set' ? 'Set to the template’s notes' : 'Template notes added after the current notes'}
          </Row>
        )}
        {preview.needs && (
          <Row label="Needed positions">
            {preview.needs.add.length} set
            {preview.needs.kept.length > 0 && `; ${preview.needs.kept.length} kept as this plan already has them`}
            {replace && preview.needs.remove_count > 0 && `; ${preview.needs.remove_count} current need(s) cleared first`}
            {preview.needs.add.map((need) => (
              <span key={need.position_id} className="block text-xs text-slate-500">
                {names.position(need.position_id)} × {need.needed}
              </span>
            ))}
            {preview.needs.skipped.map((skip) => (
              <span key={skip.position_id} className="block text-xs text-amber-700 dark:text-amber-300">
                Skipped a position: {TEMPLATE_SKIP_REASON_LABELS[skip.reason] ?? skip.reason}
              </span>
            ))}
          </Row>
        )}
        {preview.roster && (
          <Row label="Roster pattern">
            {preview.roster.add.length} prepared, unconfirmed request{preview.roster.add.length === 1 ? '' : 's'} (nobody is notified)
            {preview.roster.existing_count > 0 && `; ${preview.roster.existing_count} already on the plan`}
            {preview.roster.add.map((entry) => (
              <span key={`${entry.person_id}-${entry.team_id}-${entry.position_id}`} className="block text-xs text-slate-500">
                {names.person(entry.person_id)} — {entry.position_id ? names.position(entry.position_id) : names.team(entry.team_id)}
              </span>
            ))}
            {preview.roster.skipped.map((skip) => (
              <span key={`${skip.person_id}-${skip.team_id}-${skip.position_id}`} className="block text-xs text-amber-700 dark:text-amber-300">
                Skipped {names.person(skip.person_id)}: {TEMPLATE_SKIP_REASON_LABELS[skip.reason] ?? skip.reason}
              </span>
            ))}
          </Row>
        )}
      </dl>
      <p className="text-xs text-slate-500">
        Template “{preview.template.name}” revision {preview.template.revision}
        {preview.template.revision !== preview.template.latest_revision && ` (latest is ${preview.template.latest_revision})`}.
        Answers, delivery history and release state are never copied.
      </p>
    </div>
  );
};
