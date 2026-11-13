import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  type PlanTemplateContent,
  type PlanTemplateDetail,
  type PlanTemplateTime,
} from '@service-center/shared';
import { api } from '../lib/api';
import { useInvalidateOrg, usePlanTemplate, usePlanTemplates } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { useFormatters } from '../i18n';
import { Badge, Button, EmptyState, ErrorNotice, IconButton, Loading, Notice, PageHeader, SkeletonList } from '../components/ui';
import { Icon } from '../components/icons';
import { useTemplateNames } from '../components/templates/useTemplateNames';

const MUTED_TONE = 'bg-slate-50 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300';

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
  const { t } = useTranslation(['templates', 'common']);
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
          <label className="label" htmlFor="template-name">{t('editor.name')}</label>
          <input id="template-name" className="input" disabled={readOnly} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="template-description">{t('editor.description')}</label>
          <input id="template-description" className="input" disabled={readOnly} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
      </div>

      {template.kind === 'plan' && (
        <section>
          <h3 className="section-label mb-2.5">{t('editor.timesHeading')} <span className="font-normal normal-case tracking-normal text-slate-400 dark:text-slate-500">{t('editor.timesHint')}</span></h3>
          {draft.times.length === 0 ? <p className="surface-inset px-3 py-2.5 text-sm text-slate-500 dark:text-slate-400">{t('editor.noTimes')}</p> : (
            <ul className="row-list surface-inset">
              {draft.times.map((time, index) => {
                const timeName = time.name ?? t(`timeKinds.${time.kind}`);
                return (
                <li key={`${time.kind}-${index}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
                  <span className="w-full truncate font-medium text-slate-800 sm:w-28 dark:text-slate-100">{timeName}</span>
                  <label className="flex items-center gap-1">
                    {t('editor.day')}
                    <input
                      aria-label={t('editor.dayOffsetFor', { name: timeName })}
                      type="number" min={-14} max={14} className="input w-20" disabled={readOnly}
                      value={time.day_offset}
                      onChange={(event) => setTime(index, { day_offset: Number(event.target.value) })}
                    />
                  </label>
                  <input
                    aria-label={t('editor.startFor', { name: timeName })}
                    type="time" className="input w-32" disabled={readOnly}
                    value={time.local_start}
                    onChange={(event) => setTime(index, { local_start: event.target.value })}
                  />
                  <label className="flex items-center gap-1">
                    <input
                      aria-label={t('editor.minutesFor', { name: timeName })}
                      type="number" min={1} max={1440} className="input w-24" disabled={readOnly}
                      value={time.duration_minutes}
                      onChange={(event) => setTime(index, { duration_minutes: Number(event.target.value) })}
                    />
                    {t('editor.minutesUnit')}
                  </label>
                  {!readOnly && (
                    <IconButton icon="trash" size="sm" label={t('common:actions.remove')} className="ml-auto hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10" onClick={() => setDraft((current) => ({ ...current, times: current.times.filter((_, i) => i !== index) }))} />
                  )}
                </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section>
        <h3 className="section-label mb-2.5">{t('editor.orderHeading')}</h3>
        {draft.items.length === 0 ? <p className="surface-inset px-3 py-2.5 text-sm text-slate-500 dark:text-slate-400">{t('editor.noItems')}</p> : (
          <ol className="row-list overflow-hidden rounded-xl border border-app-border">
            {draft.items.map((item, index) => (
              <li key={`${item.title}-${index}`} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${item.item_type === 'header' ? 'bg-slate-50 dark:bg-slate-900/50' : ''}`}>
                <span className="w-6 text-right text-xs tabular-nums text-slate-400 dark:text-slate-500">{index + 1}.</span>
                <span className={`min-w-0 flex-1 truncate ${item.item_type === 'header' ? 'text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300' : 'text-slate-800 dark:text-slate-100'}`}>{item.title}</span>
                {item.length_seconds > 0 && <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">{t('common:duration.minutesShort', { count: Math.round(item.length_seconds / 60) })}</span>}
                {!readOnly && (
                  <>
                    <Button variant="ghost" size="sm" aria-label={t('editor.moveUp', { title: item.title })} className="!px-2" onClick={() => setDraft((c) => ({ ...c, items: move(c.items, index, -1) }))}><Icon name="chevronDown" className="size-4 rotate-180" /></Button>
                    <Button variant="ghost" size="sm" aria-label={t('editor.moveDown', { title: item.title })} className="!px-2" onClick={() => setDraft((c) => ({ ...c, items: move(c.items, index, 1) }))}><Icon name="chevronDown" className="size-4" /></Button>
                    <IconButton icon="trash" size="sm" label={t('common:actions.remove')} className="hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10" onClick={() => setDraft((c) => ({ ...c, items: c.items.filter((_, i) => i !== index) }))} />
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
            <h3 className="section-label mb-2.5">{t('editor.notesHeading')}</h3>
            <textarea
              aria-label={t('editor.notesHeading')}
              className="input min-h-20"
              disabled={readOnly}
              maxLength={8000}
              value={draft.notes ?? ''}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value || null }))}
            />
          </section>
          <section>
            <h3 className="section-label mb-2.5">{t('editor.needsHeading')}</h3>
            {draft.needs.length === 0 ? <p className="surface-inset px-3 py-2.5 text-sm text-slate-500 dark:text-slate-400">{t('editor.none')}</p> : (
              <ul className="row-list surface-inset">
                {draft.needs.map((need, index) => (
                  <li key={need.position_id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-100">{names.position(need.position_id)}</span>
                    <input
                      aria-label={t('editor.neededFor', { position: names.position(need.position_id) })}
                      type="number" min={1} max={99} className="input w-20" disabled={readOnly}
                      value={need.needed}
                      onChange={(event) => setDraft((c) => ({ ...c, needs: c.needs.map((n, i) => (i === index ? { ...n, needed: Number(event.target.value) } : n)) }))}
                    />
                    {!readOnly && (
                      <IconButton icon="trash" size="sm" label={t('common:actions.remove')} className="hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10" onClick={() => setDraft((c) => ({ ...c, needs: c.needs.filter((_, i) => i !== index) }))} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="section-label mb-2.5">{t('editor.rosterHeading')} <span className="font-normal normal-case tracking-normal text-slate-400 dark:text-slate-500">{t('editor.rosterHint')}</span></h3>
            {draft.roster.length === 0 ? <p className="surface-inset px-3 py-2.5 text-sm text-slate-500 dark:text-slate-400">{t('editor.none')}</p> : (
              <ul className="row-list surface-inset">
                {draft.roster.map((entry, index) => (
                  <li key={`${entry.person_id}-${entry.team_id}-${entry.position_id}`} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 text-slate-800 dark:text-slate-100">
                      {t('names.rosterEntry', {
                        person: names.person(entry.person_id),
                        target: entry.position_id ? names.position(entry.position_id) : names.team(entry.team_id),
                      })}
                    </span>
                    {!readOnly && (
                      <IconButton icon="trash" size="sm" label={t('common:actions.remove')} className="hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10" onClick={() => setDraft((c) => ({ ...c, roster: c.roster.filter((_, i) => i !== index) }))} />
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
        <Notice tone="warning">{t('editor.changedMeanwhile')}</Notice>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-app-border pt-4">
        {!viewingOld && (
          <Button variant="secondary" loading={archive.isPending} onClick={() => archive.mutate()}>
            {template.archived_at ? t('common:actions.restore') : t('common:actions.archive')}
          </Button>
        )}
        {!readOnly && (
          <Button
            icon="check"
            loading={save.isPending}
            disabled={!contentChanged && !detailsChanged}
            onClick={() => save.mutate()}
          >
            {contentChanged ? t('editor.saveRevision', { revision: template.current_revision + 1 }) : t('editor.saveDetails')}
          </Button>
        )}
      </div>
    </div>
  );
};

/** F10: the saved template and section library. */
export const PlanTemplatesPage = () => {
  const { t } = useTranslation(['templates', 'common']);
  const fmt = useFormatters();
  const { canAnywhere } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const selectedId = params.get('template');
  const templates = usePlanTemplates({ include_archived: includeArchived }, canAnywhere('plans.edit'));
  const detail = usePlanTemplate(selectedId, revision);

  if (!canAnywhere('plans.edit')) {
    return <EmptyState icon="document" title={t('library.noAccessTitle')} description={t('library.noAccessDescription')} />;
  }

  const select = (id: string) => {
    setRevision(null);
    setParams({ template: id });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('library.title')}
        subtitle={t('library.subtitle')}
        back={{ to: '/plans', label: t('common:nav.plans') }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800">
              <input type="checkbox" className="size-4 rounded border-slate-300 accent-brand-600 dark:border-slate-600" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />
              {t('library.showArchived')}
            </label>
            <Button icon="sparkle" onClick={() => navigate('/plans/generate')}>{t('library.createPlans')}</Button>
          </div>
        }
      />
      <ErrorNotice error={templates.error} />
      {templates.isLoading ? <SkeletonList rows={3} /> : !templates.data?.length ? (
        <EmptyState
          icon="document"
          title={t('library.emptyTitle')}
          description={t('library.emptyDescription')}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <ul className="card row-list h-fit overflow-hidden">
            {templates.data.map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  onClick={() => select(template.id)}
                  aria-current={selectedId === template.id ? 'true' : undefined}
                  className={`relative block w-full px-4 py-3 text-left text-sm transition ${selectedId === template.id ? 'bg-brand-50 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-brand-600 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                >
                  <span className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
                    <Icon name={template.kind === 'plan' ? 'plans' : 'document'} className="size-4 shrink-0 text-slate-400" />
                    {template.name}
                    {template.archived_at && <Badge tone={MUTED_TONE}>{t('library.archivedBadge')}</Badge>}
                  </span>
                  <span className="mt-0.5 block pl-6 text-xs text-slate-500 dark:text-slate-400">
                    {[
                      t('library.summary', {
                        kind: t(`kind.${template.kind}`),
                        serviceType: template.service_type?.name ?? t('library.allServiceTypes'),
                        revision: template.current_revision,
                      }),
                      t('count.items', { count: template.counts.items }),
                      ...(template.kind === 'plan'
                        ? [t('count.times', { count: template.counts.times }), t('count.people', { count: template.counts.roster })]
                        : []),
                    ].join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="card min-w-0 p-5">
            {!selectedId ? (
              <EmptyState compact icon="document" title={t('library.chooseTemplate')} />
            ) : detail.isLoading ? <Loading /> : detail.data ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-3 border-b border-app-border pb-4">
                  <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{detail.data.name}</h2>
                  <Badge tone={MUTED_TONE}>{t(`kind.${detail.data.kind}`)}</Badge>
                  <select
                    aria-label={t('library.revisionLabel')}
                    className="input w-full sm:ml-auto sm:w-auto"
                    value={revision ?? detail.data.current_revision}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setRevision(value === detail.data!.current_revision ? null : value);
                    }}
                  >
                    {detail.data.revisions.map((info) => (
                      <option key={info.id} value={info.revision}>
                        {t(info.source_plan_id ? 'library.revisionOptionFromPlan' : 'library.revisionOption', {
                          revision: info.revision,
                          date: fmt.dateTime(info.created_at),
                        })}
                      </option>
                    ))}
                  </select>
                </div>
                {revision !== null && (
                  <Notice tone="warning">{t('library.viewingOld')}</Notice>
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
