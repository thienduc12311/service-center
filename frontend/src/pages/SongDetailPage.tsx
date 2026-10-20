import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { ArrangementRow } from '@service-center/shared';
import { api } from '../lib/api';
import { useSong, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Loading } from '../components/ui';
import { SongWorkspaceHeader } from '../components/song/SongWorkspaceHeader';
import { SongArrangementSidebar } from '../components/song/SongArrangementSidebar';
import { ArrangementCurationPanel } from '../components/song/ArrangementCurationPanel';
import { SongMergePanel } from '../components/song/SongMergePanel';
import { ArrangementPanel } from '../components/song/ArrangementPanel';
import { AllArrangementsPanel } from '../components/song/AllArrangementsPanel';
import { SongSchedulePanel } from '../components/song/SongSchedulePanel';
import { SongTagsPanel } from '../components/song/SongTagsPanel';
import { SongNotesPanel } from '../components/song/SongNotesPanel';
import { FilesPanel } from '../components/files/FilesPanel';
import { SongInformationModal } from '../components/song/SongInformationModal';
import { ArrangementModal } from '../components/song/ArrangementModal';
import { ALL_ARRANGEMENTS, resolveArrangement, type SongPane } from '../components/song/types';

/** Which dialog, if any, is on top of the workspace. */
type SongDialog = 'song-information' | 'arrangement';

export const SongDetailPage = () => {
  const { t } = useTranslation('songs');
  const { songId } = useParams<{ songId: string }>();
  const { canAnywhere } = useAuth();
  // The song library is organization-wide; leading a team never implies it.
  const navigate = useNavigate();
  const invalidate = useInvalidateOrg();
  const song = useSong(songId);
  const canManage = canAnywhere('songs.manage') && !song.data?.merged_into_song_id;

  const [pane, setPane] = useState<SongPane>(ALL_ARRANGEMENTS);
  const [dialog, setDialog] = useState<SongDialog | null>(null);
  /** The arrangement the dialog is editing; null means it is adding one. */
  const [editingArrangement, setEditingArrangement] = useState<ArrangementRow | null>(null);

  const removeSong = useMutation({
    mutationFn: () => api.deleteSong(songId!),
    onSuccess: async () => {
      await invalidate();
      navigate('/songs');
    },
  });

  const removeArrangement = useMutation({
    mutationFn: (id: string) => api.deleteArrangement(id),
    onSuccess: async () => {
      await invalidate();
      setPane(ALL_ARRANGEMENTS);
    },
  });

  const archive = useMutation({
    mutationFn: () => api.archiveSong(songId!, { expected_revision: song.data!.revision, archived: !song.data!.archived_at }),
    onSuccess: () => invalidate(),
    onError: () => { void invalidate(); },
  });
  const archiveArrangement = useMutation({
    mutationFn: (row: ArrangementRow) => api.archiveArrangement(row.id, { expected_revision: row.revision, archived: !row.archived_at }),
    onSuccess: () => invalidate(),
    onError: () => { void invalidate(); },
  });

  if (song.isLoading) return <Loading />;
  if (song.error) return <ErrorNotice error={song.error} />;
  if (!song.data) return <EmptyState title={t('songDetail.notFound')} />;

  const detail = song.data;
  const arrangement = resolveArrangement(detail.arrangements, pane);
  // "All Arrangements" counts every service; one arrangement counts only its own.
  const scheduleArrangementId = pane.kind === 'arrangement' ? (arrangement?.id ?? null) : null;

  const openArrangementDialog = (target: ArrangementRow | null) => {
    setEditingArrangement(target);
    setDialog('arrangement');
  };

  return (
    <div>
      <SongWorkspaceHeader
        song={detail}
        paneLabel={
          pane.kind === 'all' ? t('songDetail.allArrangements') : (arrangement?.name ?? t('songDetail.allArrangements'))
        }
        canManage={canManage}
        onEditInformation={() => setDialog('song-information')}
        onAddArrangement={() => openArrangementDialog(null)}
        onDelete={() => {
          if (window.confirm(t('songDetail.deleteSongConfirm', { title: detail.title }))) {
            removeSong.mutate();
          }
        }}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {detail.merged_into_song_id && <a className="text-brand-600 underline" href={`/songs/${detail.merged_into_song_id}`}>{t('songDetail.mergedInto')}</a>}
        {detail.archived_at && <p>{t('songDetail.archivedSong')}</p>}
        {canManage && <Button disabled={archive.isPending} onClick={() => archive.mutate()}>{detail.archived_at ? t('songDetail.restoreSong') : t('songDetail.archiveSong')}</Button>}
        {canManage && pane.kind === 'arrangement' && arrangement && <Button disabled={archiveArrangement.isPending} onClick={() => archiveArrangement.mutate(arrangement)}>{arrangement.archived_at ? t('songDetail.restoreArrangement') : t('songDetail.archiveArrangement')}</Button>}
        {pane.kind === 'arrangement' && arrangement?.archived_at && <p>{t('songDetail.archivedArrangement')}</p>}
        <ErrorNotice error={archive.error ?? archiveArrangement.error} />
        <ErrorNotice error={removeSong.error ?? removeArrangement.error} />
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[14rem_1fr]">
        <SongArrangementSidebar
          arrangements={detail.arrangements}
          pane={pane}
          canManage={canManage}
          onSelect={setPane}
          onAdd={() => openArrangementDialog(null)}
        />

        <div className="min-w-0 space-y-8">
          {pane.kind === 'arrangement' && arrangement ? (
            <ArrangementPanel
              song={detail}
              arrangement={arrangement}
              canManage={canManage}
              onEdit={() => openArrangementDialog(arrangement)}
              onDelete={() => {
                if (
                  window.confirm(t('songDetail.deleteArrangementConfirm', { name: arrangement.name }))
                ) {
                  removeArrangement.mutate(arrangement.id);
                }
              }}
            />
          ) : (
            <AllArrangementsPanel
              song={detail}
              canManage={canManage}
              onSelect={(arrangementId) => setPane({ kind: 'arrangement', arrangementId })}
              onAdd={() => openArrangementDialog(null)}
            />
          )}

          {pane.kind === 'arrangement' && arrangement && (
            <FilesPanel
              owner={{ kind: 'arrangement', id: arrangement.id }}
              title={t('songDetail.arrangementFiles', { name: arrangement.name })}
              description={t('songDetail.arrangementFilesDescription')}
            />
          )}
          {pane.kind === 'arrangement' && arrangement && <ArrangementCurationPanel arrangement={arrangement} canManage={canManage && !detail.archived_at && !arrangement.archived_at} onDuplicated={(id) => setPane({ kind: 'arrangement', arrangementId: id })} />}
          {canManage && !detail.archived_at && <SongMergePanel song={detail} />}
          <FilesPanel
            owner={{ kind: 'song', id: detail.id }}
            title={t('songDetail.songFiles')}
            description={t('songDetail.songFilesDescription')}
          />

          <div className="grid gap-6 lg:grid-cols-3">
            <SongSchedulePanel songId={detail.id} arrangementId={scheduleArrangementId} />
            <SongTagsPanel song={detail} canManage={canManage} />
            <SongNotesPanel song={detail} canManage={canManage} />
          </div>
        </div>
      </div>

      <SongInformationModal
        open={dialog === 'song-information'}
        song={detail}
        onClose={() => setDialog(null)}
      />

      <ArrangementModal
        open={dialog === 'arrangement'}
        song={detail}
        arrangement={editingArrangement}
        onClose={() => setDialog(null)}
        onSaved={(saved) => setPane({ kind: 'arrangement', arrangementId: saved.id })}
      />
    </div>
  );
};
