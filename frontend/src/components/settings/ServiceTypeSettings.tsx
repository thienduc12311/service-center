import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ServiceTypeRow } from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useInvalidateOrg, useServiceTypes } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { useFormatters } from '../../i18n';
import { Button, ErrorNotice, Modal, Spinner } from '../ui';
import { CopyServiceTypeModal } from './CopyServiceTypeModal';

/** A service type the archive dialog is about to archive. */
interface PendingArchive {
  serviceType: ServiceTypeRow;
}

/**
 * Service types: copy one, archive one, or restore an archived one. Copying
 * creates a service type, which needs organization-wide "Edit plans";
 * archiving and restoring need "Edit plans" on that service type. Buttons the
 * server would refuse are not shown.
 */
export const ServiceTypeSettings = () => {
  const { t } = useTranslation(['settings', 'common']);
  const fmt = useFormatters();
  const { can, organizationId } = useAuth();
  const invalidate = useInvalidateOrg();
  const active = useServiceTypes();
  const withArchived = useQuery({
    queryKey: [...keys.serviceTypes(organizationId), 'with-archived'],
    queryFn: () => api.listServiceTypes({ include_archived: true }),
    enabled: Boolean(organizationId),
  });
  const archived = (withArchived.data ?? []).filter((type) => type.archived_at);
  const [copying, setCopying] = useState<ServiceTypeRow | null>(null);
  const [pending, setPending] = useState<PendingArchive | null>(null);

  const canCopy = can('plans.edit');
  const canArchive = (type: ServiceTypeRow): boolean => can('plans.edit', { serviceTypeId: type.id });

  const setArchived = useMutation({
    mutationFn: ({ id, archived: value }: { id: string; archived: boolean }) => api.archiveServiceType(id, { archived: value }),
    onSuccess: async () => {
      setPending(null);
      await invalidate();
    },
  });

  return (
    <section className="card space-y-4 p-5" aria-labelledby="service-type-settings-heading">
      <div>
        <h2 id="service-type-settings-heading" className="font-semibold text-slate-900 dark:text-white">
          {t('serviceTypes.title')}
        </h2>
        <p className="text-sm text-slate-500">{t('serviceTypes.description')}</p>
      </div>

      {active.isLoading ? (
        <Spinner />
      ) : (active.data ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">{t('serviceTypes.empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {(active.data ?? []).map((type) => (
            <li key={type.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate font-medium">{type.name}</span>
              <span className="flex gap-1">
                {canCopy && (
                  <Button variant="ghost" size="sm" onClick={() => setCopying(type)} aria-label={t('serviceTypes.copyOne', { name: type.name })}>
                    {t('common:actions.copy')}
                  </Button>
                )}
                {canArchive(type) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPending({ serviceType: type })}
                    aria-label={t('serviceTypes.archiveOne', { name: type.name })}
                  >
                    {t('common:actions.archive')}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <div>
          <h3 className="label">{t('serviceTypes.archived')}</h3>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {archived.map((type) => (
              <li key={type.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-slate-600 dark:text-slate-300">{type.name}</span>
                  <span className="block text-xs text-slate-400">
                    {t('serviceTypes.archivedOn', { date: fmt.date(type.archived_at ?? '') })}
                  </span>
                </span>
                {canArchive(type) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={setArchived.isPending && setArchived.variables?.id === type.id}
                    onClick={() => setArchived.mutate({ id: type.id, archived: false })}
                    aria-label={t('serviceTypes.restoreOne', { name: type.name })}
                  >
                    {t('common:actions.restore')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!pending && <ErrorNotice error={active.error ?? withArchived.error ?? setArchived.error} />}

      {copying && <CopyServiceTypeModal source={copying} onClose={() => setCopying(null)} />}

      <Modal
        open={Boolean(pending)}
        title={pending ? t('serviceTypes.archiveTitle', { name: pending.serviceType.name }) : t('common:actions.archive')}
        onClose={() => {
          setPending(null);
          setArchived.reset();
        }}
      >
        {pending && (
          <div className="space-y-3 text-sm">
            <p>{t('serviceTypes.archiveEffect')}</p>
            <ul className="list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">
              <li>{t('serviceTypes.archiveHidden')}</li>
              <li>{t('serviceTypes.archiveKept')}</li>
              <li>{t('serviceTypes.archiveRestore')}</li>
            </ul>
            <ErrorNotice error={setArchived.error} />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setPending(null);
                  setArchived.reset();
                }}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                loading={setArchived.isPending}
                onClick={() => setArchived.mutate({ id: pending.serviceType.id, archived: true })}
              >
                {t('serviceTypes.archiveConfirm')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
};
