import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  STAGE_MAX_OBJECTS,
  refreshStageObjects,
  stageLayoutIssues,
  type PlanDetail,
  type PlanStageLayoutView,
  type StageBackground,
  type StageObject,
  type StageRosterPerson,
} from '@service-center/shared';
import { keys, usePlanStageLayouts, useStageTemplates } from '../../hooks/queries';
import { api } from '../../lib/api';
import { useAuth } from '../../providers/AuthProvider';
import { Badge, Button, EmptyState, ErrorNotice, Loading, Modal } from '../ui';
import { StageCanvas } from './StageCanvas';
import { useErrorText, useFormatters } from '../../i18n';

export interface StageTabProps {
  plan: PlanDetail;
}

/** Gear presets; the label is written into the layout in the editor's language and is then the leader's own text. */
const GEAR = ['drums', 'keys', 'guitarAmp', 'bassAmp', 'mic', 'monitor', 'podium', 'screen'] as const;
type GearPreset = (typeof GEAR)[number];
const isGearPreset = (value: string): value is GearPreset => (GEAR as readonly string[]).includes(value);

const BACKGROUNDS: readonly StageBackground[] = ['blank', 'stage', 'thrust', 'round'];

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `obj-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Text for a failed layout change; a stale revision gets its own explanation. */
const useLayoutErrorText = (): ((error: unknown) => string | null) => {
  const { t } = useTranslation('media');
  const errorText = useErrorText();
  return (error) => {
    if (!error) return null;
    if (error instanceof ApiError && error.code === 'layout_revision_stale') return t('stage.errors.revisionStale');
    return errorText(error);
  };
};

/**
 * F14 Pass B: stage diagrams for this plan. A saved layout is a snapshot —
 * staffing changes are listed as issues and never move anyone; a leader
 * refreshes deliberately and saves.
 */
export const StageTab = ({ plan }: StageTabProps) => {
  const { t } = useTranslation('media');
  const layouts = usePlanStageLayouts(plan.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const list = layouts.data?.layouts ?? [];
  const selected = list.find((view) => view.layout.id === selectedId) ?? list[0] ?? null;

  if (layouts.isLoading) return <Loading label={t('stage.loading')} />;
  if (layouts.error) return <ErrorNotice error={layouts.error} />;
  const canEdit = layouts.data?.can_edit ?? false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {list.map((view) => (
          <button
            key={view.layout.id}
            type="button"
            onClick={() => setSelectedId(view.layout.id)}
            aria-current={selected?.layout.id === view.layout.id ? 'true' : undefined}
            className={`rounded-full px-3 py-1 text-sm ${selected?.layout.id === view.layout.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}
          >
            {view.layout.name}
            {view.issues.some((issue) => issue.kind !== 'unplaced') && <span aria-label={t('stage.needsAttention')}> •</span>}
          </button>
        ))}
        {canEdit && list.length < 10 && (
          <Button variant="secondary" onClick={() => setCreating(true)}>
            {t('stage.newLayout')}
          </Button>
        )}
      </div>

      {!selected ? (
        <EmptyState
          title={t('stage.emptyTitle')}
          description={canEdit ? t('stage.emptyEditor') : t('stage.emptyReader')}
        />
      ) : (
        <LayoutEditor key={`${selected.layout.id}:${selected.layout.revision}`} plan={plan} view={selected} canEdit={canEdit} />
      )}
      {creating && (
        <CreateLayoutModal
          plan={plan}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setSelectedId(id);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
};

interface CreateLayoutModalProps {
  plan: PlanDetail;
  onClose: () => void;
  onCreated: (id: string) => void;
}

const CreateLayoutModal = ({ plan, onClose, onCreated }: CreateLayoutModalProps) => {
  const { t } = useTranslation(['media', 'common']);
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const templates = useStageTemplates();
  const [name, setName] = useState(() => t('stage.defaultName'));
  const [templateId, setTemplateId] = useState('');
  const [background, setBackground] = useState<StageBackground>('stage');
  const create = useMutation({
    mutationFn: () =>
      api.createPlanStageLayout(plan.id, {
        name: name.trim(),
        template_id: templateId || null,
        ...(templateId ? {} : { background }),
      }),
    onSuccess: async (view) => {
      await queryClient.invalidateQueries({ queryKey: keys.stageLayouts(organizationId, plan.id) });
      onCreated(view.layout.id);
    },
  });
  const live = (templates.data?.templates ?? []).filter((template) => !template.archived_at);
  return (
    <Modal open title={t('stage.createTitle')} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label className="block">
          <span className="label">{t('stage.name')}</span>
          <input className="input" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('stage.startFrom')}</span>
          <select className="input" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            <option value="">{t('stage.blankLayout')}</option>
            {live.map((template) => (
              <option key={template.id} value={template.id}>
                {t('stage.templateOption', { name: template.name })}
              </option>
            ))}
          </select>
          {templateId && <span className="mt-1 block text-xs text-slate-500">{t('stage.templateHint')}</span>}
        </label>
        {!templateId && (
          <label className="block">
            <span className="label">{t('stage.background')}</span>
            <select className="input" value={background} onChange={(event) => setBackground(event.target.value as StageBackground)}>
              {BACKGROUNDS.map((value) => (
                <option key={value} value={value}>{t(`stage.backgrounds.${value}`)}</option>
              ))}
            </select>
          </label>
        )}
        <ErrorNotice error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}>{t('common:actions.create')}</Button>
        </div>
      </form>
    </Modal>
  );
};

interface LayoutEditorProps {
  plan: PlanDetail;
  view: PlanStageLayoutView;
  canEdit: boolean;
}

const LayoutEditor = ({ plan, view, canEdit }: LayoutEditorProps) => {
  const { t } = useTranslation(['media', 'common']);
  const formatters = useFormatters();
  const layoutError = useLayoutErrorText();
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const [objects, setObjects] = useState<StageObject[]>(view.layout.objects);
  const [background, setBackground] = useState<StageBackground>(view.layout.background);
  const [name, setName] = useState(view.layout.name);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const dirty =
    refreshed ||
    name !== view.layout.name ||
    background !== view.layout.background ||
    JSON.stringify(objects) !== JSON.stringify(view.layout.objects);
  const issues = useMemo(() => stageLayoutIssues(objects, view.roster), [objects, view.roster]);
  const current = objects.find((object) => object.id === selected) ?? null;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: keys.stageLayouts(organizationId, plan.id) });

  // Warn before leaving with unsaved placement.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () =>
      api.updatePlanStageLayout(plan.id, view.layout.id, {
        expected_revision: view.layout.revision,
        name: name.trim(),
        background,
        objects,
        refreshed,
      }),
    onSuccess: async () => {
      setRefreshed(false);
      await invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deletePlanStageLayout(plan.id, view.layout.id, view.layout.revision),
    onSuccess: () => void invalidate(),
  });
  const saveTemplate = useMutation({
    mutationFn: () =>
      api.createStageTemplate({
        name: t('stage.templateName', { name: name.trim() }).slice(0, 120),
        background,
        // People belong to a plan; templates keep gear and labels only.
        objects: objects.filter((object) => object.kind !== 'person').map(({ person_id: _person, ...rest }) => rest),
      }),
    onSuccess: async (template) => {
      setNotice(t('stage.templateSaved', { name: template.name }));
      await queryClient.invalidateQueries({ queryKey: keys.stageTemplates(organizationId) });
    },
  });

  const update = (id: string, patch: Partial<StageObject>) =>
    setObjects((list) => list.map((object) => (object.id === id ? { ...object, ...patch } : object)));
  const add = (object: Omit<StageObject, 'id'>) => {
    if (objects.length >= STAGE_MAX_OBJECTS) {
      setNotice(t('stage.maxObjects', { count: STAGE_MAX_OBJECTS }));
      return;
    }
    const id = newId();
    setObjects((list) => [...list, { ...object, id }]);
    setSelected(id);
  };
  const placePerson = (person: StageRosterPerson) =>
    add({ kind: 'person', x: 0.5, y: 0.75, w: 0.09, h: 0.07, rotation: 0, label: person.name, color: null, person_id: person.person_id });

  const exportPdf = () => {
    if (!svg.current) return;
    const markup = new XMLSerializer().serializeToString(svg.current);
    const win = window.open('', '_blank');
    if (!win) {
      setNotice(t('stage.allowPopups'));
      return;
    }
    const doc = win.document;
    doc.title = t('stage.printTitle', { plan: plan.title, layout: name });
    doc.documentElement.lang = document.documentElement.lang;
    const style = doc.createElement('style');
    style.textContent = '@page{size:landscape;margin:12mm}body{font-family:system-ui,sans-serif;margin:0}h1{font-size:16px;margin:0 0 8px}svg{width:100%;height:auto}';
    doc.head.appendChild(style);
    const heading = doc.createElement('h1');
    heading.textContent = t('stage.printHeading', { plan: plan.title, layout: name });
    doc.body.appendChild(heading);
    // Re-parse the serialized SVG (labels are XML-escaped by the serializer).
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
    doc.body.appendChild(doc.importNode(parsed, true));
    win.focus();
    win.print();
  };

  const unplaced = view.roster.filter((person) => !person.archived && !objects.some((object) => object.person_id === person.person_id));

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_18rem]">
      <section className="card space-y-3 p-4" aria-label={t('stage.layoutLabel')}>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <input aria-label={t('stage.layoutName')} className="input max-w-xs" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          ) : (
            <h3 className="font-semibold">{view.layout.name}</h3>
          )}
          {canEdit && (
            <select aria-label={t('stage.background')} className="input w-auto" value={background} onChange={(event) => setBackground(event.target.value as StageBackground)}>
              {BACKGROUNDS.map((value) => (
                <option key={value} value={value}>{t(`stage.backgrounds.${value}`)}</option>
              ))}
            </select>
          )}
          <span className="ml-auto text-xs text-slate-500">
            {view.layout.refreshed_at
              ? t('stage.matchedAt', { time: formatters.dateTime(view.layout.refreshed_at) })
              : t('stage.notRefreshed')}
          </span>
        </div>
        <StageCanvas
          ref={svg}
          background={background}
          objects={objects}
          selectedId={selected}
          editable={canEdit}
          flagged={new Set(issues.flatMap((issue) => (issue.object_id && issue.kind !== 'unplaced' ? [issue.object_id] : [])))}
          onSelect={setSelected}
          onMove={(id, x, y) => update(id, { x, y })}
        />
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">
              <span className="sr-only">{t('stage.addGear')}</span>
              <select
                className="input w-auto"
                value=""
                onChange={(event) => {
                  const preset = event.target.value;
                  if (isGearPreset(preset)) {
                    add({ kind: 'gear', x: 0.5, y: 0.35, w: 0.12, h: 0.09, rotation: 0, label: t(`stage.gear.${preset}`), color: '#64748b' });
                  }
                }}
              >
                <option value="">{t('stage.addGearOption')}</option>
                {GEAR.map((gear) => (
                  <option key={gear} value={gear}>{t(`stage.gear.${gear}`)}</option>
                ))}
              </select>
            </label>
            <Button variant="secondary" onClick={() => add({ kind: 'label', x: 0.5, y: 0.1, w: 0.2, h: 0.06, rotation: 0, label: t('stage.kinds.label'), color: null })}>
              {t('stage.addLabel')}
            </Button>
            <Button variant="secondary" onClick={() => setRefreshing(true)}>{t('stage.refreshFromStaffing')}</Button>
            <Button variant="secondary" onClick={exportPdf}>{t('stage.printPdf')}</Button>
            <Button variant="secondary" loading={saveTemplate.isPending} onClick={() => saveTemplate.mutate()}>{t('stage.saveAsTemplate')}</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (window.confirm(t('stage.deleteConfirm', { name: view.layout.name }))) remove.mutate();
              }}
            >
              {t('common:actions.delete')}
            </Button>
            <span className="ml-auto flex gap-2">
              {dirty && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setObjects(view.layout.objects);
                    setBackground(view.layout.background);
                    setName(view.layout.name);
                    setRefreshed(false);
                    save.reset();
                  }}
                >
                  {t('stage.discardChanges')}
                </Button>
              )}
              <Button loading={save.isPending} disabled={!dirty || !name.trim()} onClick={() => save.mutate()}>
                {t('stage.saveLayout')}
              </Button>
            </span>
          </div>
        )}
        {!canEdit && <Button variant="secondary" onClick={exportPdf}>{t('stage.printPdf')}</Button>}
        {notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}
        {[save.error, remove.error, saveTemplate.error].map((error, index) =>
          error ? (
            <p key={index} role="alert" className="text-sm text-rose-700">
              {layoutError(error)}{' '}
              {error instanceof ApiError && error.code === 'layout_revision_stale' && (
                <button type="button" className="underline" onClick={() => void invalidate()}>{t('stage.reloadTheirs')}</button>
              )}
            </p>
          ) : null,
        )}
        {canEdit && current && <Inspector object={current} onChange={(patch) => update(current.id, patch)} onRemove={() => {
          setObjects((list) => list.filter((object) => object.id !== current.id));
          setSelected(null);
        }} />}
      </section>

      <aside className="space-y-4">
        <section className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">{t('stage.compared')}</h3>
          {issues.filter((issue) => issue.kind !== 'unplaced').length === 0 ? (
            <p className="text-sm text-slate-500">{t('stage.allStillScheduled')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {issues
                .filter((issue) => issue.kind !== 'unplaced')
                .map((issue) => (
                  <li key={`${issue.kind}:${issue.person_id}`}>
                    <Badge tone="bg-amber-50 text-amber-800 ring-amber-600/20">{t(`stage.issues.${issue.kind}`)}</Badge>{' '}
                    {issue.name}
                  </li>
                ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">{t('stage.noAutoMove')}</p>
        </section>
        <section className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">{t('stage.unplacedTitle')}</h3>
          {unplaced.length === 0 ? (
            <p className="text-sm text-slate-500">{t('stage.allPlaced')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {unplaced.map((person) => (
                <li key={person.person_id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate">{person.name}</span>
                    <span className="text-xs text-slate-500">
                      {person.roles.join(', ')}
                      {person.prepared ? ` · ${t('stage.notYetAsked')}` : ''}
                    </span>
                  </span>
                  {canEdit && (
                    <Button variant="secondary" onClick={() => placePerson(person)} aria-label={t('stage.placeLabel', { name: person.name })}>
                      {t('stage.place')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      {refreshing && (
        <RefreshModal
          objects={objects}
          roster={view.roster}
          onClose={() => setRefreshing(false)}
          onApply={(next) => {
            setObjects(next);
            setRefreshed(true);
            setRefreshing(false);
            setNotice(t('stage.refreshedNotice'));
          }}
        />
      )}
    </div>
  );
};

interface RefreshModalProps {
  objects: StageObject[];
  roster: StageRosterPerson[];
  onClose: () => void;
  onApply: (objects: StageObject[]) => void;
}

const RefreshModal = ({ objects, roster, onClose, onApply }: RefreshModalProps) => {
  const { t } = useTranslation(['media', 'common']);
  const [removeUnscheduled, setRemove] = useState(true);
  const [addUnplaced, setAdd] = useState(true);
  const issues = stageLayoutIssues(objects, roster);
  const count = (kind: string) => issues.filter((issue) => issue.kind === kind).length;
  return (
    <Modal open title={t('stage.refresh.title')} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p>{t('stage.refresh.intro')}</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={removeUnscheduled} onChange={(event) => setRemove(event.target.checked)} />
          {t('stage.refresh.remove', { count: count('not_scheduled') + count('departed') })}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={addUnplaced} onChange={(event) => setAdd(event.target.checked)} />
          {t('stage.refresh.add', { count: count('unplaced') })}
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button onClick={() => onApply(refreshStageObjects(objects, roster, { removeUnscheduled, addUnplaced }, newId))}>{t('stage.refresh.apply')}</Button>
        </div>
      </div>
    </Modal>
  );
};

interface InspectorProps {
  object: StageObject;
  onChange: (patch: Partial<StageObject>) => void;
  onRemove: () => void;
}

const Inspector = ({ object, onChange, onRemove }: InspectorProps) => {
  const { t } = useTranslation(['media', 'common']);
  const number = (value: string, min: number, max: number, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  return (
    <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-5 dark:border-slate-700">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t(`stage.inspector.selected.${object.kind}`)}</legend>
      <label className="sm:col-span-2">
        <span className="label">{t('stage.inspector.label')}</span>
        <input className="input" maxLength={80} value={object.label} onChange={(event) => onChange({ label: event.target.value })} />
      </label>
      <label>
        <span className="label">{t('stage.inspector.width')}</span>
        <input className="input" type="number" min={2} max={100} value={Math.round(object.w * 100)} onChange={(event) => onChange({ w: number(event.target.value, 2, 100, object.w * 100) / 100 })} />
      </label>
      <label>
        <span className="label">{t('stage.inspector.height')}</span>
        <input className="input" type="number" min={2} max={100} value={Math.round(object.h * 100)} onChange={(event) => onChange({ h: number(event.target.value, 2, 100, object.h * 100) / 100 })} />
      </label>
      <label>
        <span className="label">{t('stage.inspector.rotation')}</span>
        <input className="input" type="number" min={-360} max={360} value={Math.round(object.rotation)} onChange={(event) => onChange({ rotation: number(event.target.value, -360, 360, object.rotation) })} />
      </label>
      <label>
        <span className="label">{t('stage.inspector.color')}</span>
        <input className="input h-9 p-1" type="color" value={object.color ?? '#94a3b8'} onChange={(event) => onChange({ color: event.target.value })} />
      </label>
      <label className="sm:col-span-2">
        <span className="label">{t('stage.inspector.nudge')}</span>
        <span className="text-xs text-slate-500">
          {t('stage.inspector.position', { x: Math.round(object.x * 100), y: Math.round(object.y * 100) })}
        </span>
      </label>
      <div className="flex items-end">
        <Button variant="danger" onClick={onRemove}>{t('common:actions.remove')}</Button>
      </div>
    </fieldset>
  );
};

