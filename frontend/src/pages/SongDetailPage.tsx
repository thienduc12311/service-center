import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { ArrangementRow } from '@service-center/shared';
import { api } from '../lib/api';
import { useSong, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { EmptyState, ErrorNotice, Loading } from '../components/ui';
import { SongWorkspaceHeader } from '../components/song/SongWorkspaceHeader';
import { SongArrangementSidebar } from '../components/song/SongArrangementSidebar';
import { ArrangementPanel } from '../components/song/ArrangementPanel';
import { AllArrangementsPanel } from '../components/song/AllArrangementsPanel';
import { SongSchedulePanel } from '../components/song/SongSchedulePanel';
import { SongTagsPanel } from '../components/song/SongTagsPanel';
import { SongNotesPanel } from '../components/song/SongNotesPanel';
import { SongInformationModal } from '../components/song/SongInformationModal';
import { ArrangementModal } from '../components/song/ArrangementModal';
import { ALL_ARRANGEMENTS, resolveArrangement, type SongPane } from '../components/song/types';

/** Which dialog, if any, is on top of the workspace. */
type SongDialog = 'song-information' | 'arrangement';

export const SongDetailPage = () => {
  const { songId } = useParams<{ songId: string }>();
  const { canManage } = useAuth();
  const navigate = useNavigate();
  const invalidate = useInvalidateOrg();
  const song = useSong(songId);

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

  if (song.isLoading) return <Loading />;
  if (song.error) return <ErrorNotice error={song.error} />;
  if (!song.data) return <EmptyState title="Song not found" />;

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
          pane.kind === 'all' ? 'All Arrangements' : (arrangement?.name ?? 'All Arrangements')
        }
        canManage={canManage}
        onEditInformation={() => setDialog('song-information')}
        onAddArrangement={() => openArrangementDialog(null)}
        onDelete={() => {
          if (window.confirm(`Delete “${detail.title}”? This cannot be undone.`)) {
            removeSong.mutate();
          }
        }}
      />

      <div className="mt-4">
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
                  window.confirm(
                    `Delete the “${arrangement.name}” arrangement? This cannot be undone.`,
                  )
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
