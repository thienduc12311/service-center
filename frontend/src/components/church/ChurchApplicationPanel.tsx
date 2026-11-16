import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  churchApplicationDraftFrom,
  churchApplicationRequestFrom,
  churchApplicationView,
  emptyChurchApplicationDraft,
  type ChurchApplication,
  type ChurchApplicationDraft,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { accountKeys, useChurchCreationPolicy, useMyChurchApplications } from '../../hooks/queries';
import { useFormatters } from '../../i18n/useFormatters';
import { Button, ErrorNotice, Loading, Notice } from '../ui';
import { ChurchApplicationForm } from './ChurchApplicationForm';
import { CreateChurchForm } from './CreateChurchForm';

export interface ChurchApplicationPanelProps {
  /** Whether the person already belongs to a church (an approval needs no "open" step then). */
  hasChurch: boolean;
  /** The church exists now (self-serve creation or an approval): make it active. */
  onChurchReady: (organizationId: string) => Promise<void>;
}

const browserTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Everything about registering a church, in one place: the request form,
 * a request waiting for review (edit or withdraw it), a rejection with its
 * reason, or an approval. While self-serve creation is switched on it is the
 * original "create a church" form instead.
 */
export const ChurchApplicationPanel = ({ hasChurch, onChurchReady }: ChurchApplicationPanelProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const { date } = useFormatters();
  const queryClient = useQueryClient();
  const policy = useChurchCreationPolicy();
  const applications = useMyChurchApplications();
  const [editing, setEditing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: accountKeys.churchApplications });
  };

  const submit = useMutation({
    mutationFn: (draft: ChurchApplicationDraft) => api.submitChurchApplication(churchApplicationRequestFrom(draft)),
    onSuccess: async () => {
      setRetrying(false);
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: ChurchApplicationDraft }) =>
      api.updateChurchApplication(id, churchApplicationRequestFrom(draft)),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const withdraw = useMutation({
    mutationFn: (application: ChurchApplication) => api.withdrawChurchApplication(application.id),
    onSuccess: refresh,
  });

  if (policy.isLoading || applications.isLoading) return <Loading />;
  if (policy.error || applications.error) return <ErrorNotice error={policy.error ?? applications.error} />;
  if (policy.data?.self_serve_allowed) return <CreateChurchForm onCreated={onChurchReady} />;

  const view = churchApplicationView(applications.data ?? [], { hasChurch });

  if (view.kind === 'pending') {
    const { application } = view;
    if (editing) {
      return (
        <ChurchApplicationForm
          initial={churchApplicationDraftFrom(application)}
          submitLabel={t('churchApplication.saveChanges')}
          busy={update.isPending}
          error={update.error}
          onSubmit={(draft) => update.mutate({ id: application.id, draft })}
          onCancel={() => setEditing(false)}
        />
      );
    }
    return (
      <div className="space-y-4">
        <Notice tone="info">
          <p className="font-medium">{t('churchApplication.pending.title')}</p>
          <p className="mt-1">
            {t('churchApplication.pending.body', { church: application.church_name, date: date(application.created_at) })}
          </p>
        </Notice>
        <ErrorNotice error={withdraw.error} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="pencil" onClick={() => setEditing(true)}>
            {t('churchApplication.pending.edit')}
          </Button>
          <Button
            variant="ghost"
            loading={withdraw.isPending}
            onClick={() => {
              if (window.confirm(t('churchApplication.pending.withdrawConfirm', { church: application.church_name }))) {
                withdraw.mutate(application);
              }
            }}
          >
            {t('churchApplication.pending.withdraw')}
          </Button>
        </div>
      </div>
    );
  }

  if (view.kind === 'approved') {
    const { application } = view;
    const organizationId = application.organization_id;
    return (
      <div className="space-y-4">
        <Notice tone="success">
          <p className="font-medium">{t('churchApplication.approved.title')}</p>
          <p className="mt-1">{t('churchApplication.approved.body', { church: application.church_name })}</p>
        </Notice>
        {organizationId && (
          <Button onClick={() => void onChurchReady(organizationId)}>
            {t('churchApplication.approved.open', { church: application.church_name })}
          </Button>
        )}
      </div>
    );
  }

  if (view.kind === 'rejected' && !retrying) {
    const { application } = view;
    return (
      <div className="space-y-4">
        <Notice tone="warning">
          <p className="font-medium">{t('churchApplication.rejected.title')}</p>
          <p className="mt-1">{t('churchApplication.rejected.body', { church: application.church_name })}</p>
          {application.rejection_reason && (
            <p className="mt-1">{t('churchApplication.rejected.reason', { reason: application.rejection_reason })}</p>
          )}
        </Notice>
        <Button onClick={() => setRetrying(true)}>{t('churchApplication.rejected.applyAgain')}</Button>
      </div>
    );
  }

  const initial =
    view.kind === 'rejected'
      ? churchApplicationDraftFrom(view.application)
      : emptyChurchApplicationDraft(browserTimezone());
  return (
    <ChurchApplicationForm
      key={view.kind}
      initial={initial}
      submitLabel={t('churchApplication.submit')}
      busy={submit.isPending}
      error={submit.error}
      onSubmit={(draft) => submit.mutate(draft)}
      onCancel={view.kind === 'rejected' ? () => setRetrying(false) : undefined}
    />
  );
};
