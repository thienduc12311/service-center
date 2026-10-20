import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  LocalizedError,
  PLAN_TEMPLATE_COMPONENTS,
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
  const { t } = useTranslation(['templates', 'common']);
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
      if (!preview) throw new LocalizedError({ key: 'templates:errors.reviewTemplateFirst' });
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
    people.data?.find((person) => person.person_id === personId)?.full_name ?? t('common:fallback.someone');
  const usable = (templates.data ?? []).filter((candidate) => candidate.current_revision_id);

  return (
    <Modal open title={t('apply.title')} onClose={onClose}>
      <div className="space-y-4">
        {templates.isLoading ? (
          <div className="flex justify-center py-6 text-slate-400"><Spinner /></div>
        ) : usable.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-900">
            {t('apply.empty')}
          </p>
        ) : (
          <div>
            <label className="label" htmlFor="apply-template">{t('apply.template')}</label>
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
              <option value="">{t('apply.choose')}</option>
              {usable.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {t('apply.optionWithRevision', {
                    name: candidate.kind === 'section'
                      ? t(candidate.service_type ? 'apply.sectionName' : 'apply.sectionAllTypesName', { name: candidate.name })
                      : candidate.service_type ? candidate.name : t('apply.allTypesName', { name: candidate.name }),
                    revision: candidate.current_revision,
                  })}
                </option>
              ))}
            </select>
          </div>
        )}

        {template && !isSection && (
          <fieldset className="space-y-2">
            <legend className="label">{t('apply.copy')}</legend>
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
                {t(`components.${component}`)}
                {!available.includes(component) && <span className="text-xs text-slate-400">{t('apply.notInTemplate')}</span>}
              </label>
            ))}
          </fieldset>
        )}

        {template && !isSection && (
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="label">{t('apply.existingLegend')}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="apply-mode" checked={mode === 'append'} onChange={() => { setMode('append'); resetReview(); }} />
              {t('apply.keepAndAdd')}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="apply-mode" checked={mode === 'replace'} onChange={() => { setMode('replace'); setInsertAt(null); resetReview(); }} />
              {t('apply.replaceParts')}
            </label>
          </fieldset>
        )}

        {template && (isSection || (mode === 'append' && chosen.includes('items'))) && plan.items.length > 0 && (
          <div>
            <label className="label" htmlFor="apply-insert-at">{t('apply.putItems')}</label>
            <select
              id="apply-insert-at"
              className="input"
              value={insertAt ?? ''}
              onChange={(event) => {
                setInsertAt(event.target.value === '' ? null : Number(event.target.value));
                resetReview();
              }}
            >
              <option value="">{t('apply.atEnd')}</option>
              <option value={0}>{t('apply.atStart')}</option>
              {plan.items.slice(0, -1).map((item, index) => (
                <option key={item.id} value={index + 1}>{t('apply.afterItem', { title: item.title })}</option>
              ))}
            </select>
          </div>
        )}

        {preview && <TemplateApplyReview preview={preview} />}

        {stale && (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {t('apply.stale')}
          </p>
        )}
        {conflicts.length > 0 ? (
          <>
            <ConflictList conflicts={conflicts} nameOf={nameOf} />
            {mayOverride ? (
              <input
                aria-label={t('apply.conflictReasonLabel')}
                className="input"
                placeholder={t('apply.conflictReasonPlaceholder')}
                maxLength={500}
                value={conflictReason}
                onChange={(event) => setConflictReason(event.target.value)}
              />
            ) : (
              <p className="text-xs text-slate-500">{t('apply.noOverride')}</p>
            )}
          </>
        ) : (
          !stale && <ErrorNotice error={review.error ?? apply.error} />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
          {preview ? (
            <Button loading={apply.isPending} disabled={preview.blocking.length > 0} onClick={() => apply.mutate()}>
              {t('common:actions.apply')}
            </Button>
          ) : (
            <Button
              loading={review.isPending}
              disabled={!template || request().components.length === 0}
              onClick={() => review.mutate()}
            >
              {t('apply.reviewChanges')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
