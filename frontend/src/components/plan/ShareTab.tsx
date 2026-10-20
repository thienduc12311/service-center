import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  PUBLIC_PLAN_FIELD_LABELS,
  type PlanDetail,
  type PlanPublicationView,
  type PublicPlanField,
  type PublicSetListLinkKind,
  type PublishMode,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { keys } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Badge, Button, ErrorNotice, Loading } from '../ui';
import { PublicPlanView } from '../PublicPlanView';
import { useFormatters } from '../../i18n';

export interface ShareTabProps {
  plan: PlanDetail;
}

const FIELDS = Object.keys(PUBLIC_PLAN_FIELD_LABELS) as PublicPlanField[];
const DEFAULT_FIELDS: PublicPlanField[] = ['title', 'date', 'times', 'songs'];

const absoluteUrl = (path: string): string => `${window.location.origin}${path}`;

/**
 * F16 Pass C: deliberately publish a sanitized projection of this plan. Only
 * allowlisted fields can be chosen; people, contacts, notes, files and chat
 * are never part of it. The preview is exactly what a visitor would receive.
 */
export const ShareTab = ({ plan }: ShareTabProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const view = useQuery({ queryKey: keys.publication(organizationId, plan.id), queryFn: () => api.planPublication(plan.id) });
  const [fields, setFields] = useState<PublicPlanField[]>(DEFAULT_FIELDS);
  const [mode, setMode] = useState<PublishMode>('now');
  useEffect(() => {
    const publication = view.data?.publication;
    if (publication) {
      setFields(publication.fields);
      setMode(publication.publish_mode);
    }
  }, [view.data?.publication?.revision]);

  const done = (next: PlanPublicationView) => queryClient.setQueryData(keys.publication(organizationId, plan.id), next);
  const publish = useMutation({
    mutationFn: (newLink: boolean) =>
      api.publishPlan(plan.id, {
        fields,
        publish_mode: mode,
        expected_revision: view.data?.publication?.revision ?? 0,
        new_link: newLink,
      }),
    onSuccess: done,
  });
  const revoke = useMutation({
    mutationFn: () => api.revokePlanPublication(plan.id, view.data!.publication!.revision),
    onSuccess: done,
  });
  const error = publish.error ?? revoke.error;
  const stale = error instanceof ApiError && error.code === 'publication_revision_stale';

  if (view.isLoading) return <Loading />;
  if (view.error) return <ErrorNotice error={view.error} />;
  const data = view.data!;
  const live = data.publication && !data.publication.revoked_at;

  return (
    <section aria-labelledby="share-heading" className="space-y-5">
      <div>
        <h2 id="share-heading" className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
          {t('share.heading')} <Badge tone="bg-slate-100 text-slate-700 ring-slate-500/20">{t(`share.state.${data.state}`)}</Badge>
        </h2>
        <p className="text-sm text-slate-500">
          {t('share.intro')}
        </p>
      </div>

      {data.ineligible_reason && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{data.ineligible_reason}</p>}

      <fieldset className="card space-y-2 p-4">
        <legend className="px-1 text-sm font-medium">{t('share.fields')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <label key={field} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={fields.includes(field)}
                onChange={(event) =>
                  setFields((current) => (event.target.checked ? [...current, field] : current.filter((f) => f !== field)))
                }
              />
              {t(`share.field.${field}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="card space-y-2 p-4">
        <legend className="px-1 text-sm font-medium">{t('share.when')}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="publish-mode" checked={mode === 'now'} onChange={() => setMode('now')} /> {t('share.modeNow')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="publish-mode" checked={mode === 'service_day'} onChange={() => setMode('service_day')} /> {t('share.modeServiceDay')}
        </label>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button loading={publish.isPending} disabled={fields.length === 0} onClick={() => publish.mutate(false)}>
          {live ? t('common:actions.saveChanges') : t('share.publish')}
        </Button>
        {live && (
          <>
            <Button variant="secondary" onClick={() => publish.mutate(true)}>{t('share.newLinkReplacing')}</Button>
            <Button variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate()}>{t('share.stopSharing')}</Button>
          </>
        )}
      </div>
      {stale ? (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('share.stale')} <button type="button" className="underline" onClick={() => { publish.reset(); revoke.reset(); void view.refetch(); }}>{t('share.reload')}</button>
        </p>
      ) : (
        <ErrorNotice error={error} />
      )}

      {data.public_path && (
        <div className="card space-y-1 p-4 text-sm">
          <p className="font-medium">{t('share.link')}</p>
          <a className="break-all text-brand-700 underline" href={data.public_path} target="_blank" rel="noreferrer">
            {absoluteUrl(data.public_path)}
          </a>
          {data.state === 'scheduled' && data.visible_from && (
            <p className="text-slate-500">{t('share.visibleFrom', { date: format.dateTime(data.visible_from) })}</p>
          )}
        </div>
      )}

      {data.preview && (
        <div>
          <p className="mb-2 text-sm font-medium">{t('share.preview')}</p>
          <div className="card p-4"><PublicPlanView projection={data.preview} /></div>
        </div>
      )}

      {plan.service_type_id && <StableLinks serviceTypeId={plan.service_type_id} />}
    </section>
  );
};

/** Per service type: links that always resolve to the nearest live publication. */
interface StableLinksProps {
  serviceTypeId: string;
}

const StableLinks = ({ serviceTypeId }: StableLinksProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const links = useQuery({ queryKey: keys.publicLinks(organizationId, serviceTypeId), queryFn: () => api.servicePublicLinks(serviceTypeId) });
  const change = useMutation({
    mutationFn: (input: { kind: PublicSetListLinkKind; action: 'create' | 'rotate' | 'revoke' }) =>
      api.setServicePublicLink(serviceTypeId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.publicLinks(organizationId, serviceTypeId) }),
  });
  if (links.isLoading) return null;
  return (
    <div className="card space-y-3 p-4 text-sm">
      <p className="font-medium">{t('share.stableHeading')}</p>
      <p className="text-slate-500">{t('share.stableHint')}</p>
      {(['upcoming', 'recent'] as const).map((kind) => {
        const link = links.data?.links.find((candidate) => candidate.kind === kind);
        return (
          <div key={kind} className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p>{t(`share.linkKind.${kind}`)}</p>
              {link && <p className="break-all text-xs text-slate-500">{absoluteUrl(`/s/${link.slug}`)}</p>}
            </div>
            <div className="flex gap-2">
              {link ? (
                <>
                  <Button variant="secondary" onClick={() => change.mutate({ kind, action: 'rotate' })}>{t('share.newLink')}</Button>
                  <Button variant="ghost" onClick={() => change.mutate({ kind, action: 'revoke' })}>{t('share.turnOff')}</Button>
                </>
              ) : (
                <Button variant="secondary" onClick={() => change.mutate({ kind, action: 'create' })}>{t('share.createLink')}</Button>
              )}
            </div>
          </div>
        );
      })}
      <ErrorNotice error={change.error ?? links.error} />
    </div>
  );
};
