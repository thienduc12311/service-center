import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, formatDuration, uuid, type MediaDetail } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import { useFormatters } from '../../src/i18n/useFormatters';
import { Button, Card, EmptyState, ErrorNotice, Label, ListRow, Loading, Screen, Tag, screenPadding } from '../../src/components/ui';
import { FileRow } from '../../src/components/files/FileRow';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

const single = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * MOB-030: one media bundle (website `MediaDetailPage`) — its details, its
 * F13 files (each with its own versions and audience; the server lists only
 * what this person may read) and the plans that use it. People who may add
 * files to it get *Add a file*, through the MOB-026 upload lifecycle; the
 * bundle's own details are edited on the website.
 */
export default function MediaDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const { t } = useTranslation(['media', 'common']);
  const { queryScope } = useAuth();
  const mediaId = uuid.safeParse(single(params.id));

  const detail = useQuery({
    queryKey: queryKeys.media(queryScope, mediaId.success ? mediaId.data : null),
    queryFn: () => api.media(mediaId.success ? mediaId.data : ''),
    enabled: Boolean(queryScope && mediaId.success),
  });

  if (!mediaId.success) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('library.title') }} />
        <EmptyState title={t('detail.notFound')} />
      </Screen>
    );
  }
  if (detail.isLoading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  // Another organization's bundle, a deleted one and one this person may not read all answer 404.
  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('library.title') }} />
        <EmptyState title={t('detail.notFound')} description={t('mobileMedia.goneDescription')} />
      </Screen>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('library.title') }} />
        <View style={{ padding: 24 }}>
          <ErrorNotice error={detail.error} />
        </View>
      </Screen>
    );
  }
  return <MediaView media={detail.data} refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()} />;
}

interface MediaViewProps {
  media: MediaDetail;
  refreshing: boolean;
  onRefresh: () => void;
}

const MediaView = ({ media, refreshing, onRefresh }: MediaViewProps) => {
  const { t } = useTranslation(['media', 'common']);
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const formatters = useFormatters();
  const subtitle = [media.creator, media.duration_seconds !== null ? formatDuration(media.duration_seconds) : null].filter(Boolean).join(' · ');
  // Writers see archived files (to restore them on the file screen); readers never receive them.
  const files = media.files.filter((file) => !file.archived_at || file.can_edit);
  const labels = [...media.themes, ...media.tags];

  return (
    <Screen>
      <Stack.Screen options={{ title: media.title }} />
      <ScrollView
        contentContainerStyle={[screenPadding(theme), styles.stack]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>{media.title}</Text>
          {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
        </View>
        {media.is_archived ? (
          <Text accessibilityRole="alert" style={styles.warning}>
            {media.archive_on && !media.archived_at
              ? t('detail.archivedSince', { date: formatters.calendarDate(media.archive_on, 'medium') })
              : t('detail.archived')}
          </Text>
        ) : null}
        {labels.length || media.notes ? (
          <Card>
            {labels.length ? (
              <View style={styles.tags}>
                {labels.map((label) => (
                  <Tag key={label} label={label} accent={theme.accent.blue} />
                ))}
              </View>
            ) : null}
            {media.notes ? <Text style={styles.body}>{media.notes}</Text> : null}
          </Card>
        ) : null}

        <Card>
          <Label>{t('filesPanel.title')}</Label>
          <Text style={styles.muted}>{t('detail.filesDescription')}</Text>
          <View style={styles.files}>
            {files.length ? (
              files.map((file, index) => (
                <FileRow
                  key={file.id}
                  file={file}
                  version={file.current_version}
                  divided={index > 0}
                  onPress={() => router.push({ pathname: '/files/[id]', params: { id: file.id } })}
                />
              ))
            ) : (
              <Text style={styles.muted}>{media.can_add_files ? t('filesPanel.empty') : t('filesPanel.emptyReader')}</Text>
            )}
          </View>
          {media.can_add_files ? (
            <Button
              title={t('mobileFiles.addFile')}
              icon="plus"
              variant="quiet"
              onPress={() => router.push({ pathname: '/files/add', params: { ownerKind: 'media', ownerId: media.id, context: media.title } })}
            />
          ) : null}
        </Card>

        <Card>
          <Label>{t('detail.usedIn')}</Label>
          {media.usage.length === 0 ? (
            <Text style={styles.muted}>{t('mobileMedia.notUsed')}</Text>
          ) : (
            media.usage.map((use, index) => (
              <ListRow key={use.item_id} divided={index > 0} showChevron onPress={() => router.push({ pathname: '/plan/[id]', params: { id: use.plan_id } })}>
                <View>
                  <Text style={styles.body}>{use.plan_title}</Text>
                  <Text style={styles.muted}>{`${formatters.calendarDate(use.service_date, 'medium')} · ${use.item_title}`}</Text>
                </View>
              </ListRow>
            ))
          )}
        </Card>
        {media.can_edit ? <Text style={styles.muted}>{t('mobileMedia.editOnWeb')}</Text> : null}
      </ScrollView>
    </Screen>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    stack: { gap: theme.space.lg },
    hero: { gap: theme.space.xs },
    title: { ...theme.type.display, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginBottom: theme.space.sm },
    files: { gap: theme.space.xs, marginTop: theme.space.sm },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
  });
