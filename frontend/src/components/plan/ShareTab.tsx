import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  formatDateTime,
  PUBLIC_EXCLUDED_ALWAYS,
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

export interface ShareTabProps {
  plan: PlanDetail;
}

const FIELDS = Object.keys(PUBLIC_PLAN_FIELD_LABELS) as PublicPlanField[];
const DEFAULT_FIELDS: PublicPlanField[] = ['title', 'date', 'times', 'songs'];

const STATE_LABELS: Record<PlanPublicationView['state'], string> = {
  unpublished: 'Not shared',
  scheduled: 'Scheduled',
  live: 'Public now',
  revoked: 'Revoked',
  ineligible: 'Not eligible',
};

const absoluteUrl = (path: string): string => `${window.location.origin}${path}`;

/**
 * F16 Pass C: deliberately publish a sanitized projection of this plan. Only
 * allowlisted fields can be chosen; people, contacts, notes, files and chat
 * are never part of it. The preview is exactly what a visitor would receive.
 */
export const ShareTab = ({ plan }: ShareTabProps) => {
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
          Public sharing <Badge tone="bg-slate-100 text-slate-700 ring-slate-500/20">{STATE_LABELS[data.state]}</Badge>
        </h2>
        <p className="text-sm text-slate-500">
          Anyone with the link sees only the fields you choose. Never shared: {PUBLIC_EXCLUDED_ALWAYS.join(', ')}.
        </p>
      </div>

      {data.ineligible_reason && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{data.ineligible_reason}</p>}

      <fieldset className="card space-y-2 p-4">
        <legend className="px-1 text-sm font-medium">Fields</legend>
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
              {PUBLIC_PLAN_FIELD_LABELS[field]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="card space-y-2 p-4">
        <legend className="px-1 text-sm font-medium">When</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="publish-mode" checked={mode === 'now'} onChange={() => setMode('now')} /> Now
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="publish-mode" checked={mode === 'service_day'} onChange={() => setMode('service_day')} /> On the
          service day (from midnight, organization time)
        </label>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button loading={publish.isPending} disabled={fields.length === 0} onClick={() => publish.mutate(false)}>
          {live ? 'Save changes' : 'Publish'}
        </Button>
        {live && (
          <>
            <Button variant="secondary" onClick={() => publish.mutate(true)}>New link (old one stops working)</Button>
            <Button variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate()}>Stop sharing</Button>
          </>
        )}
      </div>
      {stale ? (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Someone else changed sharing for this plan. <button type="button" className="underline" onClick={() => { publish.reset(); revoke.reset(); void view.refetch(); }}>Reload</button>
        </p>
      ) : (
        <ErrorNotice error={error} />
      )}

      {data.public_path && (
        <div className="card space-y-1 p-4 text-sm">
          <p className="font-medium">Link</p>
          <a className="break-all text-brand-700 underline" href={data.public_path} target="_blank" rel="noreferrer">
            {absoluteUrl(data.public_path)}
          </a>
          {data.state === 'scheduled' && data.visible_from && (
            <p className="text-slate-500">Visible from {formatDateTime(data.visible_from)}; until then the link shows “not found”.</p>
          )}
        </div>
      )}

      {data.preview && (
        <div>
          <p className="mb-2 text-sm font-medium">Exactly what visitors see</p>
          <div className="card p-4"><PublicPlanView projection={data.preview} /></div>
        </div>
      )}

      {plan.service_type_id && <StableLinks serviceTypeId={plan.service_type_id} />}
    </section>
  );
};

const LINK_LABELS: Record<PublicSetListLinkKind, string> = {
  upcoming: 'Next upcoming set list',
  recent: 'Most recent set list',
};

/** Per service type: links that always resolve to the nearest live publication. */
const StableLinks = ({ serviceTypeId }: { serviceTypeId: string }) => {
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
      <p className="font-medium">Stable links for this service type</p>
      <p className="text-slate-500">Each resolves to the nearest plan that is published and shared right now; otherwise “not found”.</p>
      {(['upcoming', 'recent'] as const).map((kind) => {
        const link = links.data?.links.find((candidate) => candidate.kind === kind);
        return (
          <div key={kind} className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p>{LINK_LABELS[kind]}</p>
              {link && <p className="break-all text-xs text-slate-500">{absoluteUrl(`/s/${link.slug}`)}</p>}
            </div>
            <div className="flex gap-2">
              {link ? (
                <>
                  <Button variant="secondary" onClick={() => change.mutate({ kind, action: 'rotate' })}>New link</Button>
                  <Button variant="ghost" onClick={() => change.mutate({ kind, action: 'revoke' })}>Turn off</Button>
                </>
              ) : (
                <Button variant="secondary" onClick={() => change.mutate({ kind, action: 'create' })}>Create link</Button>
              )}
            </div>
          </div>
        );
      })}
      <ErrorNotice error={change.error ?? links.error} />
    </div>
  );
};
