import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  ApiError,
  formatDateTime,
  type PlanTemplateContent,
  type PlanTemplateDetail,
  type PlanTemplateKind,
  type PlanTemplateTime,
} from '@service-center/shared';
import { api } from '../lib/api';
import { useInvalidateOrg, usePlanTemplate, usePlanTemplates } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { useTemplateNames } from '../components/templates/useTemplateNames';

const KIND_LABEL: Record<PlanTemplateKind, string> = { plan: 'Plan template', section: 'Section' };
const MUTED_TONE = 'bg-slate-50 text-slate-600 ring-slate-500/20';

/** Moves one entry of a list; out-of-range moves are ignored. */
const move = <T,>(list: readonly T[], index: number, by: number): T[] => {
  const target = index + by;
  if (target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
};

interface TemplateEditorProps {
  template: PlanTemplateDetail;
  viewingOld: boolean;
}

/**
 * Edits a template's current content. Saving creates the next revision; plans
 * already made from earlier revisions keep their own copies.
 */
const TemplateEditor = ({ template, viewingOld }: TemplateEditorProps) => {
  const invalidate = useInvalidateOrg();
  const names = useTemplateNames();
  const [draft, setDraft] = useState<PlanTemplateContent>(template.content);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  useEffect(() => {
    setDraft(template.content);
    setName(template.name);
    setDescription(template.description ?? '');
  }, [template]);

  const contentChanged = JSON.stringify(draft) !== JSON.stringify(template.content);
  const detailsChanged = name !== template.name || description !== (template.description ?? '');
  const readOnly = viewingOld || template.archived_at !== null;

  const save = useMutation({
    mutationFn: () =>
      api.updatePlanTemplate(template.id, {
        expected_revision: template.current_revision,
        ...(detailsChanged ? { name, description } : {}),
        ...(contentChanged ? { content: draft } : {}),
      }),
    onSuccess: async () => {
      await invalidate();
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'template_changed') await invalidate();
    },
  });
  const archive = useMutation({
    mutationFn: () => api.archivePlanTemplate(template.id, template.archived_at === null),
    onSuccess: async () => {
      await invalidate();
    },
  });

  const setTime = (index: number, patch: Partial<PlanTemplateTime>) =>
    setDraft((current) => ({ ...current, times: current.times.map((time, i) => (i === index ? { ...time, ...patch } : time)) }));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="template-name">Name</label>
          <input id="template-name" className="input" disabled={readOnly} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="template-description">Description</label>
          <input id="template-description" className="input" disabled={readOnly} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
      </div>

      {template.kind === 'plan' && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Times <span className="font-normal text-slate-400">(local clock, relative to the service date)</span></h3>
          {draft.times.length === 0 ? <p className="text-sm text-slate-400">No times.</p> : (
            <ul className="space-y-2">
              {draft.times.map((time, index) => (
                <li key={`${time.kind}-${index}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-28 truncate">{time.name ?? time.kind}</span>
                  <label className="flex items-center gap-1">
                    Day
                    <input
                      aria-label={`Day offset for ${time.name ?? time.kind}`}
                      type="number" min={-14} max={14} className="input w-20" disabled={readOnly}
                      value={time.day_offset}
                      onChange={(event) => setTime(index, { day_offset: Number(event.target.value) })}
                    />
                  </label>
                  <input
                    aria-label={`Start for ${time.name ?? time.kind}`}
                    type="time" className="input w-32" disabled={readOnly}
                    value={time.local_start}
                    onChange={(event) => setTime(index, { local_start: event.target.value })}
                  />
                  <label className="flex items-center gap-1">
                    <input
                      aria-label={`Minutes for ${time.name ?? time.kind}`}
                      type="number" min={1} max={1440} className="input w-24" disabled={readOnly}
                      value={time.duration_minutes}
                      onChange={(event) => setTime(index, { duration_minutes: Number(event.target.value) })}
                    />
                    min
                  </label>
                  {!readOnly && (
                    <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setDraft((current) => ({ ...current, times: current.times.filter((_, i) => i !== index) }))}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Order of service</h3>
        {draft.items.length === 0 ? <p className="text-sm text-slate-400">No items.</p> : (
          <ol className="space-y-1">
            {draft.items.map((item, index) => (
              <li key={`${item.title}-${index}`} className="flex items-center gap-2 text-sm">
                <span className="w-6 text-right text-slate-400">{index + 1}.</span>
                <span className={`flex-1 truncate ${item.item_type === 'header' ? 'font-semibold' : ''}`}>{item.title}</span>
                {item.length_seconds > 0 && <span className="text-xs text-slate-400">{Math.round(item.length_seconds / 60)} min</span>}
                {!readOnly && (
                  <>
                    <Button variant="ghost" aria-label={`Move ${item.title} up`} className="!px-2 !py-1 text-xs" onClick={() => setDraft((c) => ({ ...c, items: move(c.items, index, -1) }))}>↑</Button>
                    <Button variant="ghost" aria-label={`Move ${item.title} down`} className="!px-2 !py-1 text-xs" onClick={() => setDraft((c) => ({ ...c, items: move(c.items, index, 1) }))}>↓</Button>
                    <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setDraft((c) => ({ ...c, items: c.items.filter((_, i) => i !== index) }))}>Remove</Button>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {template.kind === 'plan' && (
        <>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Plan notes</h3>
            <textarea
              aria-label="Plan notes"
              className="input min-h-20"
              disabled={readOnly}
              maxLength={8000}
              value={draft.notes ?? ''}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value || null }))}
            />
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Needed positions</h3>
            {draft.needs.length === 0 ? <p className="text-sm text-slate-400">None.</p> : (
              <ul className="space-y-1">
                {draft.needs.map((need, index) => (
                  <li key={need.position_id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{names.position(need.position_id)}</span>
                    <input
                      aria-label={`Needed for ${names.position(need.position_id)}`}
                      type="number" min={1} max={99} className="input w-20" disabled={readOnly}
                      value={need.needed}
                      onChange={(event) => setDraft((c) => ({ ...c, needs: c.needs.map((n, i) => (i === index ? { ...n, needed: Number(event.target.value) } : n)) }))}
                    />
                    {!readOnly && (
                      <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setDraft((c) => ({ ...c, needs: c.needs.filter((_, i) => i !== index) }))}>Remove</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Roster pattern <span className="font-normal text-slate-400">(becomes prepared, unconfirmed requests)</span></h3>
            {draft.roster.length === 0 ? <p className="text-sm text-slate-400">None.</p> : (
              <ul className="space-y-1">
                {draft.roster.map((entry, index) => (
                  <li key={`${entry.person_id}-${entry.team_id}-${entry.position_id}`} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">
                      {names.person(entry.person_id)} — {entry.position_id ? names.position(entry.position_id) : names.team(entry.team_id)}
                    </span>
                    {!readOnly && (
                      <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setDraft((c) => ({ ...c, roster: c.roster.filter((_, i) => i !== index) }))}>Remove</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <ErrorNotice error={save.error ?? archive.error} />
      {save.error instanceof ApiError && save.error.code === 'template_changed' && (
        <p className="text-sm text-amber-700">Someone saved this template meanwhile. It has been reloaded; make your change again.</p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {!viewingOld && (
          <Button variant="secondary" loading={archive.isPending} onClick={() => archive.mutate()}>
            {template.archived_at ? 'Restore' : 'Archive'}
          </Button>
        )}
        {!readOnly && (
          <Button
            loading={save.isPending}
            disabled={!contentChanged && !detailsChanged}
            onClick={() => save.mutate()}
          >
            {contentChanged ? `Save as revision ${template.current_revision + 1}` : 'Save details'}
          </Button>
        )}
      </div>
    </div>
  );
};

/** F10: the saved template and section library. */
export const PlanTemplatesPage = () => {
  const { canAnywhere } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const selectedId = params.get('template');
  const templates = usePlanTemplates({ include_archived: includeArchived }, canAnywhere('plans.edit'));
  const detail = usePlanTemplate(selectedId, revision);

  if (!canAnywhere('plans.edit')) {
    return <EmptyState title="Templates are for plan editors" description="Ask an administrator for plan editing access." />;
  }

  const select = (id: string) => {
    setRevision(null);
    setParams({ template: id });
  };

  return (
    <div>
      <PageHeader
        title="Templates"
        subtitle="Saved plan templates and reusable sections. Editing one never changes plans already made."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" className="size-4 rounded border-slate-300" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />
              Archived
            </label>
            <Button onClick={() => navigate('/plans/generate')}>Create plans from a template</Button>
          </div>
        }
      />
      <ErrorNotice error={templates.error} />
      {templates.isLoading ? <Loading /> : !templates.data?.length ? (
        <EmptyState
          title="No templates yet"
          description="Open a plan you want to reuse and choose “Save as template”. You can save the whole plan or only a section of its order."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <ul className="space-y-1">
            {templates.data.map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  onClick={() => select(template.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${selectedId === template.id ? 'bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-900'}`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    {template.name}
                    {template.archived_at && <Badge tone={MUTED_TONE}>Archived</Badge>}
                  </span>
                  <span className="text-xs text-slate-500">
                    {KIND_LABEL[template.kind]} · {template.service_type?.name ?? 'All service types'} · rev {template.current_revision}
                    {' · '}{template.counts.items} items
                    {template.kind === 'plan' && ` · ${template.counts.times} times · ${template.counts.roster} people`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="card min-w-0 p-5">
            {!selectedId ? (
              <p className="text-sm text-slate-500">Choose a template to see and edit it.</p>
            ) : detail.isLoading ? <Loading /> : detail.data ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold">{detail.data.name}</h2>
                  <Badge tone={MUTED_TONE}>{KIND_LABEL[detail.data.kind]}</Badge>
                  <select
                    aria-label="Revision"
                    className="input w-auto"
                    value={revision ?? detail.data.current_revision}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setRevision(value === detail.data!.current_revision ? null : value);
                    }}
                  >
                    {detail.data.revisions.map((info) => (
                      <option key={info.id} value={info.revision}>
                        Revision {info.revision} · {formatDateTime(info.created_at)}{info.source_plan_id ? ' · from a plan' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {revision !== null && (
                  <p className="text-sm text-amber-700">You are viewing an older revision. It cannot be edited; plans made from it keep their content.</p>
                )}
                <TemplateEditor template={detail.data} viewingOld={revision !== null} />
              </div>
            ) : <ErrorNotice error={detail.error} />}
          </div>
        </div>
      )}
    </div>
  );
};
