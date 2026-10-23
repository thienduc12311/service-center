import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { FileOwnerKind, FileSummary } from '@service-center/shared';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import { fileKeyLabels } from '../../lib/file-view';
import { useAuth } from '../../providers/AuthProvider';
import { Button, Card, ErrorNotice, Label, Loading } from '../ui';
import { FileRow } from './FileRow';
import type { Theme } from '../../lib/theme';
import { useThemedStyles } from '../../lib/useTheme';

export interface SongFilesProps {
  songId: string;
  songTitle: string;
  arrangementId: string | null;
  arrangementName: string | null;
}

/**
 * MOB-026: the song's files and the shown arrangement's (website `FilesPanel`
 * on the song page). Arrangement files scoped to F15 labeled keys say which
 * key they belong to; archived files stay out of a reader's list.
 */
export const SongFiles = ({ songId, songTitle, arrangementId, arrangementName }: SongFilesProps) => {
  const { t } = useTranslation(['media', 'common']);
  const { queryScope } = useAuth();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);

  const songFiles = useQuery({
    queryKey: queryKeys.parentFiles(queryScope, 'song', songId),
    queryFn: () => api.files('song', songId),
    enabled: Boolean(queryScope),
  });
  const arrangementFiles = useQuery({
    queryKey: queryKeys.parentFiles(queryScope, 'arrangement', arrangementId),
    queryFn: () => api.files('arrangement', arrangementId!),
    enabled: Boolean(queryScope && arrangementId),
  });
  const materials = useQuery({
    queryKey: queryKeys.arrangementMaterials(queryScope, arrangementId),
    queryFn: () => api.getArrangementMaterials(arrangementId!),
    enabled: Boolean(queryScope && arrangementId),
  });

  const add = (ownerKind: FileOwnerKind, ownerId: string, context: string) =>
    router.push({ pathname: '/files/add', params: { ownerKind, ownerId, context } });
  const open = (file: FileSummary) => router.push({ pathname: '/files/[id]', params: { id: file.id } });

  const section = (
    label: string,
    files: readonly FileSummary[] | undefined,
    canAdd: boolean,
    onAdd: () => void,
    withKeys: boolean,
  ) => {
    // Writers see archived files (to restore them); readers never receive them.
    const shown = (files ?? []).filter((file) => !file.archived_at || file.can_edit);
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{label}</Text>
        {shown.length ? (
          shown.map((file, index) => (
            <FileRow
              key={file.id}
              file={file}
              version={file.current_version}
              keyLabels={withKeys ? fileKeyLabels(materials.data, file.id) : []}
              divided={index > 0}
              onPress={() => open(file)}
            />
          ))
        ) : (
          <Text style={styles.muted}>{canAdd ? t('filesPanel.empty') : t('filesPanel.emptyReader')}</Text>
        )}
        {canAdd ? <Button title={t('mobileFiles.addFile')} icon="plus" variant="quiet" onPress={onAdd} /> : null}
      </View>
    );
  };

  return (
    <Card>
      <Label>{t('filesPanel.title')}</Label>
      {songFiles.isLoading ? <Loading label={t('filesPanel.loading')} /> : null}
      <ErrorNotice error={songFiles.error ?? arrangementFiles.error} />
      {songFiles.data
        ? section(t('mobileFiles.songFiles'), songFiles.data.files, songFiles.data.can_add, () => add('song', songId, songTitle), false)
        : null}
      {arrangementId && arrangementFiles.data
        ? section(
            t('mobileFiles.arrangementFiles', { name: arrangementName ?? '' }),
            arrangementFiles.data.files,
            arrangementFiles.data.can_add,
            () => add('arrangement', arrangementId, arrangementName ?? songTitle),
            true,
          )
        : null}
    </Card>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    section: { gap: theme.space.xs },
    sectionTitle: { ...theme.type.body, color: theme.color.ink, fontWeight: '600' },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
