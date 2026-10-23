import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { FileSummary, FileVersionSummary } from '@service-center/shared';
import { ListRow, Tag } from '../ui';
import { fileMetaParts, type PlanFileBadge } from '../../lib/file-view';
import type { Theme } from '../../lib/theme';
import { useTheme, useThemedStyles } from '../../lib/useTheme';

export interface FileRowProps {
  file: FileSummary;
  /** The version this view uses (a plan's pinned one); null = no finished version. */
  version: FileVersionSummary | null;
  badges?: readonly PlanFileBadge[];
  /** F15 labeled keys an arrangement file is scoped to. */
  keyLabels?: readonly string[];
  divided?: boolean;
  onPress: () => void;
}

/** MOB-026: one file in a list, worded as the website's `FileRow`; tapping opens its detail. */
export const FileRow = ({ file, version, badges = [], keyLabels = [], divided = false, onPress }: FileRowProps) => {
  const { t } = useTranslation(['media', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const meta = fileMetaParts(file, version);

  const metaText = [
    t(`files.categories.${file.category}`),
    t(`files.audiences.${file.audience}`),
    meta.versionNumber ? t('files.versionNumber', { number: meta.versionNumber }) : meta.versionPending ? t('files.versionUploading') : null,
    meta.size,
    meta.host,
    meta.usable ? null : t('files.noFinishedUpload'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListRow divided={divided} onPress={onPress} showChevron>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>{file.title}</Text>
        <View style={styles.tags}>
          <Tag label={t(`files.kinds.${file.kind}`)} accent={theme.accent.neutral} />
          {file.archived_at ? <Tag label={t('files.archived')} accent={theme.accent.yellow} /> : null}
          {file.kind === 'upload' && file.playback_rights === 'stream_only' ? (
            <Tag label={t('files.playOnly')} accent={theme.accent.blue} />
          ) : null}
          {badges.map((badge) => (
            <Tag
              key={badge.kind}
              label={badge.kind === 'pinnedTo' ? t('planFiles.pinnedTo', { number: badge.number }) : t(`planFiles.${badge.kind}`)}
              accent={badge.kind === 'newerAvailable' ? theme.accent.yellow : theme.accent.blue}
            />
          ))}
          {keyLabels.map((label) => (
            <Tag key={label} label={t('mobileFiles.forKey', { key: label })} accent={theme.accent.green} />
          ))}
          {file.pending_versions.length ? (
            <Tag label={t('mobileFiles.unfinishedCount', { count: file.pending_versions.length })} accent={theme.accent.yellow} />
          ) : null}
        </View>
        <Text style={styles.meta}>{metaText}</Text>
      </View>
    </ListRow>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    body: { gap: theme.space.xs },
    title: { ...theme.type.body, color: theme.color.ink, fontWeight: '600' },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs },
    meta: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
