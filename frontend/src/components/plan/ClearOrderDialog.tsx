import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { PlanDetail } from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Modal } from '../ui';

export interface ClearOrderDialogProps {
  open: boolean;
  plan: Pick<PlanDetail, 'id' | 'title' | 'items' | 'content_revision'>;
  onClose: () => void;
}

/**
 * Confirms clearing the whole order, saying how many items go. One request,
 * sent with the revision on screen, so a clear over someone else's newer
 * order is refused instead of removing items the planner never saw.
 */
export const ClearOrderDialog = ({ open, plan, onClose }: ClearOrderDialogProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const invalidate = useInvalidateOrg();
  const count = plan.items.length;

  const clear = useMutation({
    mutationFn: () => api.clearPlanItems(plan.id, plan.content_revision),
    onSuccess: async () => {
      onClose();
      await invalidate();
    },
    // A stale or refused clear still refreshes the order behind the dialog.
    onError: () => invalidate(),
  });

  const close = () => {
    clear.reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t('clearOrder.title')}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="button" variant="danger" loading={clear.isPending} onClick={() => clear.mutate()}>
            {t('clearOrder.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">{t('clearOrder.body', { count, title: plan.title })}</p>
      {clear.error && (
        <div className="mt-4">
          <ErrorNotice error={clear.error} />
        </div>
      )}
    </Modal>
  );
};
