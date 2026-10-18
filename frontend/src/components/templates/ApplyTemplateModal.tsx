import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ApiError,
  PLAN_TEMPLATE_COMPONENTS,
  TEMPLATE_COMPONENT_LABELS,
  type AttendanceConflict,
  type PlanDetail,
  type PlanTemplateComponent,
  type PlanTemplateSummary,
  type TemplateApplyMode,
  type TemplateApplyPreviewResult,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, usePeople, usePlanTemplates } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Modal, Spinner } from '../ui';
import { ConflictList } from '../plan/attendance';
import { TemplateApplyReview } from './TemplateApplyReview';

export interface ApplyTemplateModalProps {
  plan: PlanDetail;
  onClose: () => void;
}

/** 409 codes after which the reviewed preview no longer describes the plan. */
const STALE_CODES = new Set(['plan_revision_stale', 'template_preview_changed']);

/**
 * Apply a saved template (or a section) to this plan: choose what to copy and
 * whether to append or replace, review exactly what changes, then apply in
 * one transaction. A changed plan or template sends you back to review.
 */
export const ApplyTemplateModal = ({ plan, onClose }: ApplyTemplateModalProps) => {
  const invalidate = useInvalidateOrg();
  const { can } = useAuth();
  const people = usePeople();
  const templates = usePlanTemplates(plan.service_type_id ? { service_type_id: plan.service_type_id } : {});
  const [templateId, setTemplateId] = useState('');
  const [mode, setMode] = useState<TemplateApplyMode>('append');
  const [chosen, setChosen] = useState<PlanTemplateComponent[]>(['items', 'needs', 'notes', 'roster']);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [preview, setPreview] = useState<TemplateApplyPreviewResult | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [conflictReason, setConflictReason] = useState('');

  const template: PlanTemplateSummary | undefined = templates.data?.find((candidate) => candidate.id === templateId);
  const isSection = template?.kind === 'section';
  const components: PlanTemplateComponent[] = isSection ? ['items'] : chosen;
  const available = useMemo(
    () => PLAN_TEMPLATE_COMPONENTS.filter((component) => {
      if (!template) return false;
      if (component === 'notes') return template.counts.has_notes;
      return template.counts[component] > 0;
    }),
    [template],
  );

  const resetReview = () => {
    setPreview(null);
    setAttemptKey(crypto.randomUUID());
  };

  const request = () => ({
    revision_id: template?.current_revision_id ?? '',
    mode: isSection ? ('append' as const) : mode,
    components: components.filter((component) => available.includes(component)),
    insert_at: isSection || mode === 'append' ? insertAt : null,
  });

  const review = useMutation({
    mutationFn: () => api.previewApplyTemplate(plan.id, request()),
    onSuccess: (result) => {
      setPreview(result);
      setAttemptKey(crypto.randomUUID());
    },
  });

  const apply = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error('Review the template first');
      return api.applyTemplate(plan.id, {
        ...request(),
        preview_hash: preview.preview_hash,
        expected_revision: preview.destination_revision ?? plan.content_revision,
        idempotency_key: attemptKey,
        conflict_override_reason: conflictReason.trim() || null,
      });
    },
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.code && STALE_CODES.has(error.code)) {
        await invalidate();
        setPreview(null);
      }
    },
  });

  const conflicts: AttendanceConflict[] =
    apply.error instanceof ApiError && apply.error.code === 'scheduling_conflict'
      ? ((apply.error.details as AttendanceConflict[] | undefined) ?? [])
      : [];
  const stale = apply.error instanceof ApiError && apply.error.code !== undefined && STALE_CODES.has(apply.error.code);
  const mayOverride = can('scheduling.override_conflicts', { serviceTypeId: plan.service_type_id });
  const nameOf = (personId: string): string =>
    people.data?.find((person) => person.person_id === personId)?.full_name ?? 'Someone';
  const usable = (templates.data ?? []).filter((candidate) => candidate.current_revision_id);

  return (
    <Modal open title="Apply a template" onClose={onClose}>
      <div className="space-y-4">
        {templates.isLoading ? (
          <div className="flex justify-center py-6 text-slate-400"><Spinner /></div>
        ) : usable.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-900">
            No templates yet. Use “Save as template” on a plan you like, or open Templates from the Plans page.
          </p>
        ) : (
          <div>
            <label className="label" htmlFor="apply-template">Template</label>
            <select
              id="apply-template"
              className="input"
              value={templateId}
              onChange={(event) => {
                setTemplateId(event.target.value);
                setInsertAt(null);
                resetReview();
              }}
            >
              <option value="">Choose…</option>
              {usable.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.kind === 'section' ? 'Section: ' : ''}{candidate.name}
                  {candidate.service_type ? '' : ' (all service types)'} · rev {candidate.current_revision}
                </option>
              ))}
            </select>
          </div>
        )}

        {template && !isSection && (
          <fieldset className="space-y-2">
            <legend className="label">Copy</legend>
            {PLAN_TEMPLATE_COMPONENTS.map((component) => (
              <label key={component} className={`flex items-center gap-2 text-sm ${available.includes(component) ? '' : 'opacity-50'}`}>
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300"
                  disabled={!available.includes(component)}
                  checked={available.includes(component) && chosen.includes(component)}
                  onChange={(event) => {
                    setChosen((current) => event.target.checked ? [...current, component] : current.filter((c) => c !== component));
                    resetReview();
                  }}
                />
                {TEMPLATE_COMPONENT_LABELS[component]}
                {!available.includes(component) && <span className="text-xs text-slate-400">(not in this template)</span>}
              </label>
            ))}
          </fieldset>
        )}

        {template && !isSection && (
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="label">What is already on the plan</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="apply-mode" checked={mode === 'append'} onChange={() => { setMode('append'); resetReview(); }} />
              Keep it and add the template’s content
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="apply-mode" checked={mode === 'replace'} onChange={() => { setMode('replace'); setInsertAt(null); resetReview(); }} />
              Replace the chosen parts
            </label>
          </fieldset>
        )}

        {template && (isSection || (mode === 'append' && chosen.includes('items'))) && plan.items.length > 0 && (
          <div>
            <label className="label" htmlFor="apply-insert-at">Put the items</label>
            <select
              id="apply-insert-at"
              className="input"
              value={insertAt ?? ''}
              onChange={(event) => {
                setInsertAt(event.target.value === '' ? null : Number(event.target.value));
                resetReview();
              }}
            >
              <option value="">At the end</option>
              <option value={0}>At the start</option>
              {plan.items.slice(0, -1).map((item, index) => (
                <option key={item.id} value={index + 1}>After “{item.title}”</option>
              ))}
            </select>
          </div>
        )}

        {preview && <TemplateApplyReview preview={preview} />}

        {stale && (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            The plan or template changed since you reviewed it. Review again before applying.
          </p>
        )}
        {conflicts.length > 0 ? (
          <>
            <ConflictList conflicts={conflicts} nameOf={nameOf} />
            {mayOverride ? (
              <input
                aria-label="Reason for adding the roster over the conflicts"
                className="input"
                placeholder="Reason for applying anyway (kept with each request)"
                maxLength={500}
                value={conflictReason}
                onChange={(event) => setConflictReason(event.target.value)}
              />
            ) : (
              <p className="text-xs text-slate-500">Apply without the roster pattern, or ask someone who may schedule over conflicts.</p>
            )}
          </>
        ) : (
          !stale && <ErrorNotice error={review.error ?? apply.error} />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {preview ? (
            <Button loading={apply.isPending} disabled={preview.blocking.length > 0} onClick={() => apply.mutate()}>
              Apply
            </Button>
          ) : (
            <Button
              loading={review.isPending}
              disabled={!template || request().components.length === 0}
              onClick={() => review.mutate()}
            >
              Review changes
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
