import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDuration, type MediaSummary, type PlanDetail, type PlanItemDetail } from '@service-center/shared';
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
  onSaved: (contentRevision: number, media: MediaSummary) => void;
  /** The title and length in the form now, to offer the new media's own. */
  draftTitle: string;
  draftLength: string;
  /** Puts the new media's title and length (when it has one) into the form, unsaved. */
  onUseMediaDetails: (details: MediaItemDetails) => void;
}

/** The title and length (as the form types it) a media item takes from its media. */
export interface MediaItemDetails {
  title: string;
  /** Null when the media has no length: the item keeps its own. */
  length: string | null;
}

/** What to offer from newly chosen media; null when the form already says the same. */
export const mediaDetailsOffer = (media: MediaSummary, draftTitle: string, draftLength: string): MediaItemDetails | null => {
  const length = media.duration_seconds ? formatDuration(media.duration_seconds) : null;
  const sameTitle = media.title === draftTitle.trim();
  const sameLength = length === null || length === draftLength.trim();
  return sameTitle && sameLength ? null : { title: media.title, length };
};

/**
 * The media a media item stands for, in the item editor: shown with its
 * thumbnail and changed from the media library. The change is saved straight
 * away (a media item can never be without media); the rest of the form is
 * still saved with "Save".
 */
export const EditItemMediaField = ({ plan, item, baseRevision, onSaved, draftTitle, draftLength, onUseMediaDetails }: EditItemMediaFieldProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  const [shown, setShown] = useState<ShownMedia | null>(
    item.media ? { id: item.media.id, title: item.media.title, thumbnail_file_id: item.media.thumbnail_file_id ?? null } : null,
  );
  // The media chosen and saved here, so the editor says what changed.
  const [saved, setSaved] = useState<MediaSummary | null>(null);
  const change = useMutation({
    mutationFn: (media: MediaSummary) =>
      api.setPlanItemMedia(plan.id, item.id, { media_id: media.id, expected_revision: baseRevision }),
    onSuccess: async (result, media) => {
      setShown({ id: media.id, title: media.title, thumbnail_file_id: media.thumbnail_file_id });
      setChoosing(false);
      setSaved(media);
      onSaved(result.content_revision, media);
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
      {saved && !choosing && <SavedMediaNotice media={saved} offer={mediaDetailsOffer(saved, draftTitle, draftLength)} onUse={onUseMediaDetails} />}
      <ErrorNotice error={change.error} />
    </div>
  );
};

interface SavedMediaNoticeProps {
  media: MediaSummary;
  offer: MediaItemDetails | null;
  onUse: (details: MediaItemDetails) => void;
}

/** "Media changed and saved", and a way to take the new media's title and length. */
const SavedMediaNotice = ({ media, offer, onUse }: SavedMediaNoticeProps) => {
  const { t } = useTranslation('plans');
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/25">
      <p className="min-w-0">
        <span className="block">{t('editItem.mediaSaved', { title: media.title })}</span>
        {offer && <span className="block text-xs text-emerald-800 dark:text-emerald-300">{t('editItem.mediaDetailsDiffer')}</span>}
      </p>
      {offer && (
        <Button type="button" size="sm" variant="secondary" onClick={() => onUse(offer)}>
          {offer.length ? t('editItem.useMediaTitleAndLength', { length: offer.length }) : t('editItem.useMediaTitle')}
        </Button>
      )}
    </div>
  );
};
