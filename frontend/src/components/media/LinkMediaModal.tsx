import { Trans, useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, type PlanDetail, type PlanItemDetail } from '@service-center/shared';
import { keys } from '../../hooks/queries';
import { api } from '../../lib/api';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Modal } from '../ui';
import { MediaPickerList } from './MediaPickerList';

export interface LinkMediaModalProps {
  plan: PlanDetail;
  item: PlanItemDetail;
  onClose: () => void;
}

/**
 * F14: link a reusable media bundle to a regular order item (or clear it), or
 * change the bundle a media item stands for (never cleared: a media item
 * always names its media). Archived bundles are not offered; an item that
 * already uses one keeps it until someone deliberately changes it.
 */
export const LinkMediaModal = ({ plan, item, onClose }: LinkMediaModalProps) => {
  const { t } = useTranslation('media');
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const isMediaItem = item.item_type === 'media';
  const save = useMutation({
    mutationFn: (mediaId: string | null) =>
      api.setPlanItemMedia(plan.id, item.id, { media_id: mediaId, expected_revision: plan.content_revision }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.all(organizationId) });
      onClose();
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === 'plan_revision_stale';
  const currentId = item.media?.id ?? item.media_id ?? null;

  return (
    <Modal open title={t(isMediaItem ? 'linkMedia.changeTitle' : 'linkMedia.title', { title: item.title })} onClose={onClose}>
      <div className="space-y-4">
        {item.media && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
            <span>
              <Trans
                t={t}
                i18nKey={item.media.archived ? 'linkMedia.linkedArchived' : 'linkMedia.linked'}
                values={{ title: item.media.title }}
                components={[<strong key="title" />]}
              />
            </span>
            {!isMediaItem && (
              <Button variant="secondary" loading={save.isPending && save.variables === null} onClick={() => save.mutate(null)}>
                {t('linkMedia.removeLink')}
              </Button>
            )}
          </div>
        )}
        <MediaPickerList
          selectedId={currentId}
          pendingId={save.isPending ? save.variables : null}
          chooseLabel={t(isMediaItem ? 'linkMedia.choose' : 'linkMedia.link')}
          chosenLabel={t(isMediaItem ? 'linkMedia.chosen' : 'linkMedia.linkedButton')}
          onChoose={(media) => save.mutate(media.id)}
        />
        {stale ? (
          <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20">
            {t('linkMedia.stale')}
          </p>
        ) : (
          <ErrorNotice error={save.error} />
        )}
      </div>
    </Modal>
  );
};
