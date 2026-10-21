import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { templateNoticeText, type TemplateApplyPreview, type TemplatePreviewNotice } from '@service-center/shared';
import { type Theme } from '../lib/theme';
import { useThemedStyles } from '../lib/useTheme';
import { useTemplateNames } from '../lib/useTemplateNames';
import { useFormatters, useStructuredText } from '../i18n';

export interface TemplateApplyReviewProps {
  preview: TemplateApplyPreview;
  /** Generation previews describe a new plan: nothing is replaced or kept. */
  newPlan?: boolean;
}

interface NoticeListProps {
  notices: readonly TemplatePreviewNotice[];
  tone: 'block' | 'warn';
  preview: TemplateApplyPreview;
}

const NoticeList = ({ notices, tone, preview }: NoticeListProps) => {
  const { t } = useTranslation('templates');
  const structured = useStructuredText();
  const styles = useThemedStyles(makeStyles);
  if (notices.length === 0) return null;
  // Same wording as the website: by stable code and params; older notices keep their text.
  const text = (notice: TemplatePreviewNotice): string =>
    notice.code === 'older_revision' && !notice.params
      ? t('notices.older_revision', { revision: preview.template.revision, latest: preview.template.latest_revision })
      : templateNoticeText(notice, structured);
  return (
    <View accessibilityRole={tone === 'block' ? 'alert' : undefined} style={[styles.notices, tone === 'block' ? styles.block : styles.warn]}>
      {notices.map((notice) => (
        <Text key={`${notice.code}-${notice.message}`} style={tone === 'block' ? styles.blockText : styles.warnText}>{text(notice)}</Text>
      ))}
    </View>
  );
};

interface RowProps {
  label: string;
  children: ReactNode;
}

const Row = ({ label, children }: RowProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowBody}>{children}</View>
    </View>
  );
};

/**
 * The website's TemplateApplyReview: exactly what applying will do, part by
 * part — added, removed, kept and skipped (with why) — plus blocking problems
 * and warnings. Nothing here has been written yet.
 */
export const TemplateApplyReview = ({ preview, newPlan = false }: TemplateApplyReviewProps) => {
  const { t } = useTranslation('templates');
  const format = useFormatters();
  const names = useTemplateNames();
  const styles = useThemedStyles(makeStyles);
  const replace = preview.mode === 'replace';

  return (
    <View style={styles.review}>
      <NoticeList notices={preview.blocking} tone="block" preview={preview} />
      <NoticeList notices={preview.warnings} tone="warn" preview={preview} />
      <View style={styles.rows}>
        {preview.items ? (
          <Row label={t('review.items')}>
            <Text style={styles.text}>
              {!newPlan && !replace
                ? t('review.itemsAddedAt', {
                    count: preview.items.add.length,
                    position: preview.items.insert_at + 1,
                    total: preview.items.existing_count + 1,
                  })
                : t('review.itemsAdded', { count: preview.items.add.length })}
            </Text>
            {replace && preview.items.remove_count > 0 ? (
              <Text style={styles.text}>{t('review.itemsRemoved', { count: preview.items.remove_count })}</Text>
            ) : null}
            {preview.items.add.length > 0 ? (
              <Text style={styles.small}>{preview.items.add.map((item) => item.title).join(' · ')}</Text>
            ) : null}
            {preview.items.skipped.map((skip) => (
              <Text key={skip.title} style={styles.skipped}>
                {t('review.skippedItem', { title: skip.title, reason: t(`skipReasons.${skip.reason}`) })}
              </Text>
            ))}
          </Row>
        ) : null}
        {preview.times ? (
          <Row label={t('review.times')}>
            {preview.times.add.length === 0 ? (
              <Text style={styles.text}>{t('review.noTimes')}</Text>
            ) : (
              preview.times.add.map((time) => (
                <Text key={time.starts_at} style={styles.text}>
                  {t('review.timeLine', {
                    name: time.name ?? t(`timeKinds.${time.kind}`),
                    when: format.dateTime(time.starts_at, { timeZone: preview.timezone }),
                    timezone: preview.timezone,
                  })}
                  <Text style={styles.small}> · {t('review.yourTime', { time: format.dateTime(time.starts_at) })}</Text>
                </Text>
              ))
            )}
            {replace && preview.times.remove_count > 0 ? (
              <Text style={styles.small}>{t('review.timesRemoved', { count: preview.times.remove_count })}</Text>
            ) : null}
          </Row>
        ) : null}
        {preview.notes ? (
          <Row label={t('review.notes')}>
            <Text style={styles.text}>
              {preview.notes.action === 'none' ? t('review.notesNone')
                : preview.notes.action === 'set' ? t('review.notesSet') : t('review.notesAppend')}
            </Text>
          </Row>
        ) : null}
        {preview.needs ? (
          <Row label={t('review.needs')}>
            <Text style={styles.text}>{t('review.needsSet', { count: preview.needs.add.length })}</Text>
            {preview.needs.kept.length > 0 ? (
              <Text style={styles.text}>{t('review.needsKept', { count: preview.needs.kept.length })}</Text>
            ) : null}
            {replace && preview.needs.remove_count > 0 ? (
              <Text style={styles.text}>{t('review.needsCleared', { count: preview.needs.remove_count })}</Text>
            ) : null}
            {preview.needs.add.map((need) => (
              <Text key={need.position_id} style={styles.small}>
                {t('review.needLine', { position: names.position(need.position_id), needed: need.needed })}
              </Text>
            ))}
            {preview.needs.skipped.map((skip) => (
              <Text key={skip.position_id} style={styles.skipped}>
                {t('review.skippedPosition', { reason: t(`skipReasons.${skip.reason}`) })}
              </Text>
            ))}
          </Row>
        ) : null}
        {preview.roster ? (
          <Row label={t('review.roster')}>
            <Text style={styles.text}>{t('review.rosterAdded', { count: preview.roster.add.length })}</Text>
            {preview.roster.existing_count > 0 ? (
              <Text style={styles.text}>{t('review.rosterExisting', { count: preview.roster.existing_count })}</Text>
            ) : null}
            {preview.roster.add.map((entry) => (
              <Text key={`${entry.person_id}-${entry.team_id}-${entry.position_id}`} style={styles.small}>
                {t('names.rosterEntry', {
                  person: names.person(entry.person_id),
                  target: entry.position_id ? names.position(entry.position_id) : names.team(entry.team_id),
                })}
              </Text>
            ))}
            {preview.roster.skipped.map((skip) => (
              <Text key={`${skip.person_id}-${skip.team_id}-${skip.position_id}`} style={styles.skipped}>
                {t('review.skippedPerson', { name: names.person(skip.person_id), reason: t(`skipReasons.${skip.reason}`) })}
              </Text>
            ))}
          </Row>
        ) : null}
      </View>
      <Text style={styles.small}>
        {preview.template.revision !== preview.template.latest_revision
          ? t('review.templateRevisionOlder', {
              name: preview.template.name,
              revision: preview.template.revision,
              latest: preview.template.latest_revision,
            })
          : t('review.templateRevision', { name: preview.template.name, revision: preview.template.revision })}{' '}
        {t('review.neverCopied')}
      </Text>
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    review: { gap: theme.space.md },
    notices: { gap: theme.space.xs, padding: theme.space.md, borderRadius: theme.radius.md },
    block: { backgroundColor: theme.accent.red.bg },
    warn: { backgroundColor: theme.accent.yellow.bg },
    blockText: { ...theme.type.bodySmall, color: theme.accent.red.fg },
    warnText: { ...theme.type.bodySmall, color: theme.accent.yellow.fg },
    rows: {
      paddingHorizontal: theme.space.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border,
      borderRadius: theme.radius.md,
    },
    row: {
      gap: theme.space.xs,
      paddingVertical: theme.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border,
    },
    rowLabel: { ...theme.type.label, color: theme.color.ink },
    rowBody: { gap: 2 },
    text: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    small: { ...theme.type.bodySmall, fontSize: 12, lineHeight: 16, color: theme.color.inkFaint },
    skipped: { ...theme.type.bodySmall, fontSize: 12, lineHeight: 16, color: theme.accent.yellow.fg },
  });
