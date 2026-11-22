import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { MediaSummary, PlanDetail, PlanItemDetail } from '@service-center/shared';
import { keys } from '../../hooks/queries';
import { api } from '../../lib/api';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice } from '../ui';
import { MediaPickerList } from '../media/MediaPickerList';
import { MediaThumbnail } from '../media/MediaThumbnail';

/** The bundle the field shows: the saved one, then whatever was chosen here. */
interface ShownMedia {
  id: string;
  title: string;
  thumbnail_file_id: string | null;
}

export interface EditItemMediaFieldProps {
  plan: PlanDetail;
  item: PlanItemDetail;
  /** The plan revision the editor is saving against. */
  baseRevision: number;
  /** A media change is saved at once; the editor then saves against this revision. */
  onSaved: (contentRevision: number) => void;
}

/**
 * The media a media item stands for, in the item editor: shown with its
 * thumbnail and changed from the media library. The change is saved straight
 * away (a media item can never be without media); the rest of the form is
 * still saved with "Save".
 */
export const EditItemMediaField = ({ plan, item, baseRevision, onSaved }: EditItemMediaFieldProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  const [shown, setShown] = useState<ShownMedia | null>(
    item.media ? { id: item.media.id, title: item.media.title, thumbnail_file_id: item.media.thumbnail_file_id ?? null } : null,
  );
  const change = useMutation({
    mutationFn: (media: MediaSummary) =>
      api.setPlanItemMedia(plan.id, item.id, { media_id: media.id, expected_revision: baseRevision }),
    onSuccess: async (result, media) => {
      setShown({ id: media.id, title: media.title, thumbnail_file_id: media.thumbnail_file_id });
      setChoosing(false);
      onSaved(result.content_revision);
      await queryClient.invalidateQueries({ queryKey: keys.all(organizationId) });
    },
  });

  return (
    <div className="space-y-3 rounded-xl border border-app-border p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <MediaThumbnail fileId={shown?.thumbnail_file_id} alt={t('addItem.mediaThumbnail', { title: shown?.title ?? item.title })} />
          <span className="min-w-0 text-sm">
            <span className="block text-xs text-slate-500">{t('editItem.mediaLabel')}</span>
            <span className="block truncate font-medium">{shown?.title ?? t('editItem.mediaUnavailable')}</span>
          </span>
        </span>
        <Button type="button" variant="secondary" onClick={() => setChoosing((open) => !open)} aria-expanded={choosing}>
          {choosing ? t('common:actions.cancel') : t('editItem.changeMedia')}
        </Button>
      </div>
      {choosing && (
        <MediaPickerList
          selectedId={shown?.id ?? null}
          pendingId={change.isPending ? (change.variables?.id ?? null) : null}
          chooseLabel={t('editItem.useMedia')}
          chosenLabel={t('editItem.currentMedia')}
          onChoose={(media) => change.mutate(media)}
        />
      )}
      <ErrorNotice error={change.error} />
    </div>
  );
};
