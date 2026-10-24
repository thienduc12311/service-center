import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { arrangementArchiveBlock, type ArrangementRow, type SongWithArrangements } from '@service-center/shared';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import { invalidateLibrary } from '../../lib/song-library';
import { useAuth } from '../../providers/AuthProvider';
import type { Theme } from '../../lib/theme';
import { useTheme, useThemedStyles } from '../../lib/useTheme';
import { Button, Card, ErrorNotice, Label, Tag } from '../ui';
import { useVocabularyLabel } from './AuthoringParts';

export interface SongStatusNoticesProps {
  song: SongWithArrangements;
  arrangement: ArrangementRow | null;
}

/** Merged and archived states, worded as the website words them. */
export const SongStatusNotices = ({ song, arrangement }: SongStatusNoticesProps) => {
  const { t } = useTranslation('songs');
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const mergedInto = song.merged_into_song_id;
  if (!mergedInto && !song.archived_at && !arrangement?.archived_at) return null;
  return (
    <Card>
      <View style={styles.group}>
        {mergedInto ? (
          <>
            <Text style={styles.body}>{t('mobileAuthoring.mergedNotice')}</Text>
            <Button
              title={t('mobileAuthoring.openKept')}
              variant="secondary"
              onPress={() => router.push({ pathname: '/song/[id]', params: { id: mergedInto } })}
            />
          </>
        ) : null}
        {song.archived_at ? <Text style={styles.body}>{t('songDetail.archivedSong')}</Text> : null}
        {arrangement?.archived_at ? <Text style={styles.body}>{t('songDetail.archivedArrangement')}</Text> : null}
      </View>
    </Card>
  );
};

export interface SongDetailsProps {
  song: SongWithArrangements;
}

/** The song's own information, tags and notes (website Song Information, Tags and Notes panels). */
export const SongDetails = ({ song }: SongDetailsProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const vocabularyLabel = useVocabularyLabel();
  const facts: { label: string; value: string }[] = [
    { label: t('songInfo.fields.ccli'), value: song.ccli_number ?? '' },
    { label: t('songInfo.fields.copyright'), value: song.copyright ?? '' },
    { label: t('songInfo.fields.administration'), value: song.administration ?? '' },
    { label: t('addSong.fields.style'), value: song.style ? vocabularyLabel(song.style) : '' },
    { label: t('addSong.fields.speed'), value: song.speed ? vocabularyLabel(song.speed) : '' },
  ].filter((fact) => fact.value);
  const tags = [...song.song_types.map(vocabularyLabel), ...song.themes];

  return (
    <Card>
      <View style={styles.group}>
        <Label>{t('mobileAuthoring.detailsHeading')}</Label>
        {facts.map((fact) => (
          <Text key={fact.label} style={styles.body}>
            <Text style={styles.muted}>{fact.label} </Text>
            {fact.value}
          </Text>
        ))}
        <Label>{t('addSong.fields.tags')}</Label>
        {tags.length ? (
          <View style={styles.tags}>
            {tags.map((tag, index) => (
              <Tag key={`${index}-${tag}`} label={tag} accent={theme.accent.neutral} />
            ))}
          </View>
        ) : (
          <Text style={styles.muted}>{t('tags.empty')}</Text>
        )}
        <Label>{t('songInfo.fields.notes')}</Label>
        <Text style={song.notes ? styles.body : styles.muted}>{song.notes ?? t('notes.empty')}</Text>
      </View>
    </Card>
  );
};

export interface SongManageProps {
  song: SongWithArrangements;
  /** The arrangement the page shows; its actions act on it. */
  arrangement: ArrangementRow | null;
}

/**
 * MOB-028: library-manager actions for the shown song and arrangement — the
 * website's song workspace actions. Archive/restore are revisioned
 * (`archiveSong` / `archiveArrangement`); a refused (stale) answer re-reads
 * the song so the next attempt uses the current revision. Deleting songs,
 * bulk metadata edits, imports and merges stay website workflows.
 */
export const SongManage = ({ song, arrangement }: SongManageProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);

  const reread = () => {
    if (isCurrentGeneration(generation)) void queryClient.invalidateQueries({ queryKey: queryKeys.song(queryScope, song.id) });
  };
  const archiveSong = useMutation({
    mutationFn: () => api.archiveSong(song.id, { expected_revision: song.revision, archived: !song.archived_at }),
    onSuccess: () => (isCurrentGeneration(generation) ? invalidateLibrary(queryClient, queryScope) : undefined),
    onError: reread,
  });
  const archiveArrangement = useMutation({
    mutationFn: (row: ArrangementRow) => api.archiveArrangement(row.id, { expected_revision: row.revision, archived: !row.archived_at }),
    onSuccess: () => (isCurrentGeneration(generation) ? invalidateLibrary(queryClient, queryScope) : undefined),
    onError: reread,
  });

  const confirmSongArchive = () => {
    if (song.archived_at) {
      archiveSong.mutate();
      return;
    }
    Alert.alert(t('mobileAuthoring.archiveSongConfirm', { title: song.title }), undefined, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('songDetail.archiveSong'), style: 'destructive', onPress: () => archiveSong.mutate() },
    ]);
  };
  const confirmArrangementArchive = (row: ArrangementRow) => {
    if (row.archived_at) {
      archiveArrangement.mutate(row);
      return;
    }
    const message = [
      t('mobileAuthoring.archiveArrangementConfirm', { name: row.name }),
      row.is_default ? t('mobileAuthoring.archiveDefaultNote') : null,
    ].filter(Boolean).join('\n\n');
    Alert.alert(message, undefined, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('songDetail.archiveArrangement'), style: 'destructive', onPress: () => archiveArrangement.mutate(row) },
    ]);
  };

  const block = arrangement ? arrangementArchiveBlock(song, arrangement) : null;
  // Keys and duplication need an active song and arrangement (website rule).
  const curatable = Boolean(arrangement && !song.archived_at && !arrangement.archived_at);
  const busy = archiveSong.isPending || archiveArrangement.isPending;

  return (
    <Card>
      <View style={styles.group}>
        <Label>{t('mobileAuthoring.manageLabel')}</Label>
        <View style={styles.actions}>
          <Button title={t('mobileAuthoring.editSong')} variant="secondary" icon="pencil" onPress={() => router.push({ pathname: '/song/edit/[id]', params: { id: song.id } })} />
          <Button title={t('allArrangements.add')} variant="secondary" icon="plus" onPress={() => router.push({ pathname: '/song/arrangement', params: { songId: song.id } })} />
        </View>
        {arrangement ? (
          <>
            <Text style={styles.muted}>{arrangement.name}</Text>
            <View style={styles.actions}>
              <Button
                title={t('mobileAuthoring.editArrangement')}
                variant="secondary"
                onPress={() => router.push({ pathname: '/song/arrangement', params: { songId: song.id, arrangementId: arrangement.id } })}
              />
              <Button
                title={t('curation.title')}
                variant="secondary"
                onPress={() => router.push({ pathname: '/song/keys', params: { songId: song.id, arrangementId: arrangement.id } })}
              />
              {curatable ? (
                <Button
                  title={t('curation.duplicateSummary')}
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/song/duplicate', params: { songId: song.id, arrangementId: arrangement.id } })}
                />
              ) : null}
              <Button
                title={arrangement.archived_at ? t('songDetail.restoreArrangement') : t('songDetail.archiveArrangement')}
                variant="quiet"
                disabled={busy || block !== null}
                loading={archiveArrangement.isPending}
                onPress={() => confirmArrangementArchive(arrangement)}
              />
            </View>
            {block === 'last_active' ? <Text style={styles.muted}>{t('mobileAuthoring.lastActiveBlocked')}</Text> : null}
          </>
        ) : null}
        <Button
          title={song.archived_at ? t('songDetail.restoreSong') : t('songDetail.archiveSong')}
          variant={song.archived_at ? 'secondary' : 'quiet'}
          disabled={busy}
          loading={archiveSong.isPending}
          onPress={confirmSongArchive}
        />
        <ErrorNotice error={archiveSong.error ?? archiveArrangement.error} />
        <Text style={styles.muted}>{t('mobileAuthoring.webOnly')}</Text>
      </View>
    </Card>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    group: { gap: theme.space.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
