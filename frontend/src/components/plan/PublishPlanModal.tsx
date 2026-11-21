import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { keys } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { useFormatters } from '../../i18n';
import { Button, ErrorNotice, Modal } from '../ui';

export interface PublishPlanModalProps {
  open: boolean;
  planId: string;
  /** True while the publish request is in flight. */
  publishing: boolean;
  /** A publish that failed, shown in the dialog so it can be retried. */
  error: unknown;
  onClose: () => void;
  onPublish: (notify: boolean) => void;
}

/**
 * ADR-0006: publishing is when people are asked. Before publishing, say who
 * will be emailed and who has no address, with "Notify people" ticked.
 */
export const PublishPlanModal = ({ open, planId, publishing, error, onClose, onPublish }: PublishPlanModalProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const { organizationId } = useAuth();
  const { list } = useFormatters();
  const [notify, setNotify] = useState(true);
  const preview = useQuery({
    queryKey: keys.planPublishPreview(organizationId, planId),
    queryFn: () => api.planPublishPreview(planId),
    enabled: open,
    staleTime: 0,
  });
  const willNotify = preview.data?.will_notify ?? 0;
  const noEmail = preview.data?.no_email ?? [];

  return (
    <Modal
      open={open}
      title={t('publishConfirm.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button icon="check" loading={publishing} onClick={() => onPublish(notify)}>
            {t('publishConfirm.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {preview.isPending ? (
          <p className="text-slate-500 dark:text-slate-400">{t('publishConfirm.loading')}</p>
        ) : (
          <>
            <p>
              {willNotify > 0 || noEmail.length > 0
                ? t('publishConfirm.willEmail', { count: willNotify })
                : t('publishConfirm.nobody')}
            </p>
            {noEmail.length > 0 && (
              <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-800 ring-1 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200">
                {t('publishConfirm.noEmail', { count: noEmail.length, names: list(noEmail) })}
              </p>
            )}
          </>
        )}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-slate-300 dark:border-slate-700"
            checked={notify}
            onChange={(event) => setNotify(event.target.checked)}
          />
          <span>
            {t('publishConfirm.notify')}
            <span className="block text-xs text-slate-500 dark:text-slate-400">{t('publishConfirm.notifyHint')}</span>
          </span>
        </label>
        <ErrorNotice error={preview.error ?? error} />
      </div>
    </Modal>
  );
};
