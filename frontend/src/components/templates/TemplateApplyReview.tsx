import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TemplateApplyPreview, TemplatePreviewNotice } from '@service-center/shared';
import { useFormatters } from '../../i18n';
import { useTemplateNames, useTemplateNoticeText, type TemplateNoticeContext } from './useTemplateNames';

export interface TemplateApplyReviewProps {
  preview: TemplateApplyPreview;
  /** Generation previews describe a new plan: nothing is replaced or kept. */
  newPlan?: boolean;
}

interface NoticeListProps {
  notices: TemplatePreviewNotice[];
  tone: 'block' | 'warn';
  context: TemplateNoticeContext;
}

const NoticeList = ({ notices, tone, context }: NoticeListProps) => {
  const noticeText = useTemplateNoticeText();
  return notices.length === 0 ? null : (
    <ul
      role={tone === 'block' ? 'alert' : undefined}
      className={`space-y-1 rounded-lg p-3 text-sm ring-1 ${
        tone === 'block'
          ? 'bg-red-50 text-red-800 ring-red-600/20 dark:bg-red-950/40 dark:text-red-200'
          : 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-200'
      }`}
    >
      {notices.map((notice) => (
        <li key={`${notice.code}-${notice.message}`}>{noticeText(notice, context)}</li>
      ))}
    </ul>
  );
};

interface RowProps {
  label: string;
  children: ReactNode;
}

const Row = ({ label, children }: RowProps) => (
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
  const { t } = useTranslation('templates');
  const fmt = useFormatters();
  const names = useTemplateNames();
  const replace = preview.mode === 'replace';
  const context: TemplateNoticeContext = { template: preview.template };
  return (
    <div className="space-y-3">
      <NoticeList notices={preview.blocking} tone="block" context={context} />
      <NoticeList notices={preview.warnings} tone="warn" context={context} />
      <dl className="rounded-lg bg-slate-50 px-3 py-1 dark:bg-slate-900">
        {preview.items && (
          <Row label={t('review.items')}>
            <span className="block">
              {!newPlan && !replace
                ? t('review.itemsAddedAt', {
                    count: preview.items.add.length,
                    position: preview.items.insert_at + 1,
                    total: preview.items.existing_count + 1,
                  })
                : t('review.itemsAdded', { count: preview.items.add.length })}
            </span>
            {replace && preview.items.remove_count > 0 && (
              <span className="block">{t('review.itemsRemoved', { count: preview.items.remove_count })}</span>
            )}
            {preview.items.add.length > 0 && (
              <span className="block text-xs text-slate-500">{preview.items.add.map((item) => item.title).join(' · ')}</span>
            )}
            {preview.items.skipped.map((skip) => (
              <span key={skip.title} className="block text-xs text-amber-700 dark:text-amber-300">
                {t('review.skippedItem', { title: skip.title, reason: t(`skipReasons.${skip.reason}`) })}
              </span>
            ))}
          </Row>
        )}
        {preview.times && (
          <Row label={t('review.times')}>
            {preview.times.add.length === 0 ? t('review.noTimes') : (
              <ul>
                {preview.times.add.map((time) => (
                  <li key={time.starts_at}>
                    {t('review.timeLine', {
                      name: time.name ?? t(`timeKinds.${time.kind}`),
                      when: fmt.dateTime(time.starts_at, { timeZone: preview.timezone }),
                      timezone: preview.timezone,
                    })}
                    <span className="text-xs text-slate-400"> · {t('review.yourTime', { time: fmt.dateTime(time.starts_at) })}</span>
                  </li>
                ))}
              </ul>
            )}
            {replace && preview.times.remove_count > 0 && (
              <span className="block text-xs">{t('review.timesRemoved', { count: preview.times.remove_count })}</span>
            )}
          </Row>
        )}
        {preview.notes && (
          <Row label={t('review.notes')}>
            {preview.notes.action === 'none' ? t('review.notesNone')
              : preview.notes.action === 'set' ? t('review.notesSet') : t('review.notesAppend')}
          </Row>
        )}
        {preview.needs && (
          <Row label={t('review.needs')}>
            <span className="block">{t('review.needsSet', { count: preview.needs.add.length })}</span>
            {preview.needs.kept.length > 0 && (
              <span className="block">{t('review.needsKept', { count: preview.needs.kept.length })}</span>
            )}
            {replace && preview.needs.remove_count > 0 && (
              <span className="block">{t('review.needsCleared', { count: preview.needs.remove_count })}</span>
            )}
            {preview.needs.add.map((need) => (
              <span key={need.position_id} className="block text-xs text-slate-500">
                {t('review.needLine', { position: names.position(need.position_id), needed: need.needed })}
              </span>
            ))}
            {preview.needs.skipped.map((skip) => (
              <span key={skip.position_id} className="block text-xs text-amber-700 dark:text-amber-300">
                {t('review.skippedPosition', { reason: t(`skipReasons.${skip.reason}`) })}
              </span>
            ))}
          </Row>
        )}
        {preview.roster && (
          <Row label={t('review.roster')}>
            <span className="block">{t('review.rosterAdded', { count: preview.roster.add.length })}</span>
            {preview.roster.existing_count > 0 && (
              <span className="block">{t('review.rosterExisting', { count: preview.roster.existing_count })}</span>
            )}
            {preview.roster.add.map((entry) => (
              <span key={`${entry.person_id}-${entry.team_id}-${entry.position_id}`} className="block text-xs text-slate-500">
                {t('names.rosterEntry', {
                  person: names.person(entry.person_id),
                  target: entry.position_id ? names.position(entry.position_id) : names.team(entry.team_id),
                })}
              </span>
            ))}
            {preview.roster.skipped.map((skip) => (
              <span key={`${skip.person_id}-${skip.team_id}-${skip.position_id}`} className="block text-xs text-amber-700 dark:text-amber-300">
                {t('review.skippedPerson', { name: names.person(skip.person_id), reason: t(`skipReasons.${skip.reason}`) })}
              </span>
            ))}
          </Row>
        )}
      </dl>
      <p className="text-xs text-slate-500">
        {preview.template.revision !== preview.template.latest_revision
          ? t('review.templateRevisionOlder', {
              name: preview.template.name,
              revision: preview.template.revision,
              latest: preview.template.latest_revision,
            })
          : t('review.templateRevision', { name: preview.template.name, revision: preview.template.revision })}{' '}
        {t('review.neverCopied')}
      </p>
    </div>
  );
};
