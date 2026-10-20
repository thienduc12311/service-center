import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  AttendanceConflict,
  StaffingMatrixAction,
  StaffingMatrixFilters,
  StaffingMatrixPreview,
} from '@service-center/shared';
import { api } from '../lib/api';
import { keys, useServiceTypes, useStaffingMatrix, useStaffingMatrixViews, useTeams } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Badge, Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';
import { useFormatters, useStructuredText } from '../i18n';
import { staffingMatrixItemWarnings } from '@service-center/shared';

const day = 86_400_000;
const defaultFilters = (): StaffingMatrixFilters => ({
  from: new Date().toISOString(),
  to: new Date(Date.now() + 56 * day).toISOString(),
  service_type_ids: [], team_ids: [], plan_ids: [], search: null,
});
const dateInput = (value: string): string => value.slice(0, 10);
const dateStart = (value: string): string => new Date(`${value}T00:00:00`).toISOString();
const dateEnd = (value: string): string => new Date(`${value}T23:59:59.999`).toISOString();
const cellKey = (personId: string, planId: string): string => `${personId}:${planId}`;

export const StaffingMatrixPage = () => {
  const { t } = useTranslation(['staffing', 'common']);
  const { dateTime } = useFormatters();
  const structured = useStructuredText();
  const { organizationId } = useAuth();
  const client = useQueryClient();
  const [filters, setFilters] = useState<StaffingMatrixFilters>(defaultFilters);
  const [cursor, setCursor] = useState<string>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<StaffingMatrixPreview | null>(null);
  const [commitKey, setCommitKey] = useState('');
  const [viewName, setViewName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [visibility, setVisibility] = useState<'prepared' | 'released'>('prepared');
  const [notify, setNotify] = useState(false);
  const gridRef = useRef<HTMLTableElement>(null);
  const input = useMemo(() => ({ filters, ...(cursor ? { cursor } : {}), page_size: 25 }), [filters, cursor]);
  const matrix = useStaffingMatrix(input);
  const views = useStaffingMatrixViews();
  const teams = useTeams();
  const serviceTypes = useServiceTypes();
  const assignmentsByCell = useMemo(() => {
    const map = new Map<string, NonNullable<typeof matrix.data>['assignments']>();
    for (const assignment of matrix.data?.assignments ?? []) {
      const key = cellKey(assignment.person_id, assignment.plan_id);
      map.set(key, [...(map.get(key) ?? []), assignment]);
    }
    return map;
  }, [matrix.data]);
  const conflictsByCell = useMemo(() => new Map((matrix.data?.conflicts ?? []).map((cell) => [cell.key, cell.conflicts])), [matrix.data]);
  const totalsByPlan = useMemo(() => new Map((matrix.data?.plans ?? []).map((plan) => {
    const requests = (matrix.data?.assignments ?? []).filter((assignment) => assignment.plan_id === plan.id);
    return [plan.id, {
      needed: plan.needs.reduce((sum, need) => sum + need.needed, 0),
      staffed: requests.length,
      prepared: requests.filter((assignment) => assignment.visibility === 'prepared').length,
    }];
  })), [matrix.data]);
  const selectedTeam = teams.data?.find((team) => team.id === teamId);

  const previewMutation = useMutation({
    mutationFn: (actions: StaffingMatrixAction[]) => api.previewStaffingMatrix({ actions }),
    onSuccess: (result) => { setPreview(result); setCommitKey(crypto.randomUUID()); },
  });
  const commitMutation = useMutation({
    mutationFn: () => api.commitStaffingMatrix({
      operation_id: preview!.operation_id, actions: preview!.actions,
      base_revisions: preview!.base_revisions, idempotency_key: commitKey,
    }),
    onSuccess: async (result) => {
      setPreview(null); setSelected(new Set());
      await client.invalidateQueries({ queryKey: keys.staffingMatrix(organizationId, input) });
      for (const planId of result.affected_plan_ids) await client.invalidateQueries({ queryKey: keys.plan(organizationId, planId) });
    },
  });
  const saveView = useMutation({
    mutationFn: () => api.saveStaffingMatrixView({ name: viewName, filters }),
    onSuccess: async () => { setViewName(''); await client.invalidateQueries({ queryKey: keys.staffingMatrixViews(organizationId) }); },
  });

  const selectedEntries = [...selected].map((key) => {
    const [personId, planId] = key.split(':');
    return { key, personId: personId!, planId: planId!, assignments: assignmentsByCell.get(key) ?? [] };
  });
  const previewAssign = () => {
    if (!teamId) return;
    const actions: StaffingMatrixAction[] = selectedEntries.filter((entry) => entry.assignments.length === 0).map((entry) => ({
      kind: 'assign', plan_id: entry.planId, person_id: entry.personId, team_id: teamId,
      position_id: positionId || null, visibility, attendance_mode: 'all', time_ids: [], notify: visibility === 'released' && notify,
    }));
    if (actions.length) previewMutation.mutate(actions);
  };
  const previewRemove = () => {
    const actions: StaffingMatrixAction[] = selectedEntries.flatMap((entry) => entry.assignments.map((assignment) => ({
      kind: 'remove' as const, plan_id: assignment.plan_id, assignment_id: assignment.id,
      expected_request_revision: assignment.request_revision,
    })));
    if (actions.length) previewMutation.mutate(actions);
  };
  const previewRelease = () => {
    const actions: StaffingMatrixAction[] = selectedEntries.flatMap((entry) => entry.assignments
      .filter((assignment) => assignment.visibility === 'prepared').map((assignment) => ({
        kind: 'release' as const, plan_id: assignment.plan_id, assignment_id: assignment.id,
        expected_request_revision: assignment.request_revision, notify,
      })));
    if (actions.length) previewMutation.mutate(actions);
  };
  const previewCopy = () => {
    const source = selectedEntries.flatMap((entry) => entry.assignments).at(0);
    if (!source) return;
    const actions: StaffingMatrixAction[] = selectedEntries
      .filter((entry) => entry.assignments.length === 0 && entry.personId === source.person_id)
      .map((entry) => ({ kind: 'copy', source_assignment_id: source.id,
        expected_source_revision: source.request_revision, destination_plan_id: entry.planId,
        destination_attendance_mode: 'all', destination_time_ids: [], visibility, notify: visibility === 'released' && notify }));
    if (actions.length) previewMutation.mutate(actions);
  };

  /** Blockout details are a fixed server word; other plans' details are user content unless redacted. */
  const conflictText = (conflict: AttendanceConflict): string => {
    if (conflict.kind === 'blockout') return t('matrix.conflictBlockout');
    return conflict.redacted ? t('matrix.anotherCommitment') : conflict.detail;
  };

  const toggleCell = (key: string) => setSelected((current) => {
    const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next;
  });
  const navigateGrid = (event: KeyboardEvent<HTMLButtonElement>, row: number, column: number, key: string) => {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggleCell(key); return; }
    const directions: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const delta = directions[event.key]; if (!delta) return;
    event.preventDefault();
    const target = gridRef.current?.querySelector<HTMLButtonElement>(`[data-row="${row + delta[0]}"][data-column="${column + delta[1]}"]`);
    target?.focus();
  };

  return (
    <div>
      <PageHeader title={t('matrix.title')} subtitle={t('matrix.subtitle')}
        actions={<div className="flex gap-2"><Link to="/plans/proposals"><Button variant="secondary">{t('matrix.proposeStaffing')}</Button></Link><Link to="/plans"><Button variant="secondary">{t('matrix.backToPlans')}</Button></Link></div>} />
      <section className="card mb-5 space-y-3 p-4" aria-label={t('matrix.filters')}>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="field">{t('matrix.from')}<input className="input" type="date" value={dateInput(filters.from)} onChange={(e) => { setCursor(undefined); setFilters({ ...filters, from: dateStart(e.target.value) }); }} /></label>
          <label className="field">{t('matrix.to')}<input className="input" type="date" value={dateInput(filters.to)} onChange={(e) => { setCursor(undefined); setFilters({ ...filters, to: dateEnd(e.target.value) }); }} /></label>
          <label className="field">{t('matrix.serviceType')}<select className="input" value={filters.service_type_ids[0] ?? ''} onChange={(e) => { setCursor(undefined); setFilters({ ...filters, service_type_ids: e.target.value ? [e.target.value] : [] }); }}><option value="">{t('matrix.allPermitted')}</option>{(serviceTypes.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field">{t('matrix.team')}<select className="input" value={filters.team_ids[0] ?? ''} onChange={(e) => { setCursor(undefined); setTeamId(e.target.value); setPositionId(''); setFilters({ ...filters, team_ids: e.target.value ? [e.target.value] : [] }); }}><option value="">{t('matrix.allPermitted')}</option>{(teams.data ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="field min-w-48 flex-1">{t('matrix.findPerson')}<input className="input" value={filters.search ?? ''} onChange={(e) => { setCursor(undefined); setFilters({ ...filters, search: e.target.value || null }); }} /></label>
          <label className="field min-w-48">{t('matrix.savedView')}<select className="input" value="" onChange={(e) => { const view = views.data?.find((item) => item.id === e.target.value); if (view) { setCursor(undefined); setFilters(view.filters); setTeamId(view.filters.team_ids[0] ?? ''); } }}><option value="">{t('matrix.chooseEllipsis')}</option>{(views.data ?? []).map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
          <input aria-label={t('matrix.newViewName')} className="input w-48" placeholder={t('matrix.viewName')} value={viewName} onChange={(e) => setViewName(e.target.value)} />
          <Button variant="secondary" disabled={!viewName.trim()} loading={saveView.isPending} onClick={() => saveView.mutate()}>{t('matrix.saveView')}</Button>
        </div>
      </section>

      <ErrorNotice error={matrix.error ?? previewMutation.error ?? saveView.error} />
      {matrix.isLoading ? <Loading /> : !matrix.data?.plans.length ? <EmptyState title={t('matrix.emptyTitle')} description={t('matrix.emptyDescription')} /> : (
        <>
          <section className="card mb-4 flex flex-wrap items-end gap-3 p-4" aria-label={t('matrix.selectedActions')}>
            <div className="mr-auto"><p className="font-medium">{t('matrix.cellsSelected', { count: selected.size })}</p><p className="text-xs text-slate-500">{t('matrix.keyboardHint')}</p></div>
            <label className="field">{t('matrix.team')}<select className="input min-w-36" value={teamId} onChange={(e) => { setTeamId(e.target.value); setPositionId(''); }}><option value="">{t('matrix.choose')}</option>{(teams.data ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            <label className="field">{t('matrix.position')}<select className="input min-w-36" value={positionId} onChange={(e) => setPositionId(e.target.value)}><option value="">{t('matrix.noPosition')}</option>{(selectedTeam?.positions ?? []).map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}</select></label>
            <label className="field">{t('matrix.state')}<select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as 'prepared' | 'released')}><option value="prepared">{t('matrix.visibility.prepared')}</option><option value="released">{t('matrix.visibility.released')}</option></select></label>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />{t('matrix.notifyOnRelease')}</label>
            <Button disabled={!selected.size || !teamId} onClick={previewAssign}>{t('matrix.actions.assign')}</Button>
            <Button variant="secondary" disabled={!selectedEntries.some((entry) => entry.assignments.length)} onClick={previewRemove}>{t('matrix.actions.remove')}</Button>
            <Button variant="secondary" disabled={!selectedEntries.some((entry) => entry.assignments.some((a) => a.visibility === 'prepared'))} onClick={previewRelease}>{t('matrix.actions.release')}</Button>
            <Button variant="secondary" disabled={!selectedEntries.some((entry) => entry.assignments.length) || !selectedEntries.some((entry) => !entry.assignments.length)} onClick={previewCopy}>{t('matrix.actions.copy')}</Button>
          </section>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table ref={gridRef} className="min-w-full border-collapse text-sm">
              <thead><tr className="bg-slate-50"><th className="sticky left-0 z-10 min-w-52 border-b border-r bg-slate-50 p-3 text-left">{t('matrix.person')}</th>{matrix.data.plans.map((plan) => { const totals = totalsByPlan.get(plan.id)!; return <th key={plan.id} className="min-w-48 border-b border-r p-3 text-left"><Link className="font-medium hover:underline" to={`/plans/${plan.id}`}>{plan.title}</Link><div className="text-xs font-normal text-slate-500">{dateTime(plan.service_date)}</div><div className="mt-1 text-xs font-normal text-slate-600">{t('matrix.planTotals', { staffed: totals.staffed, needed: totals.needed, prepared: totals.prepared })}</div></th>; })}</tr></thead>
              <tbody>{matrix.data.people.map((person, row) => <tr key={person.id}><th className="sticky left-0 z-10 border-b border-r bg-white p-3 text-left font-normal"><div className="font-medium">{person.full_name}</div><div className="text-xs text-slate-500">{person.last_served_at ? t('matrix.recentWithLast', { count: person.recent_serving_count, last: dateTime(person.last_served_at) }) : t('matrix.recent', { count: person.recent_serving_count })}</div></th>{matrix.data!.plans.map((plan, column) => { const key = cellKey(person.id, plan.id); const assignments = assignmentsByCell.get(key) ?? []; const conflicts = conflictsByCell.get(key) ?? []; const chosen = selected.has(key); return <td key={plan.id} className="border-b border-r p-1 align-top"><button type="button" data-row={row} data-column={column} aria-pressed={chosen} aria-label={t(chosen ? 'matrix.deselectCell' : 'matrix.selectCell', { name: person.full_name, plan: plan.title })} className={`min-h-20 w-full rounded-lg p-2 text-left outline-none focus:ring-2 focus:ring-brand-500 ${chosen ? 'bg-brand-50 ring-1 ring-brand-300' : 'hover:bg-slate-50'}`} onClick={() => toggleCell(key)} onKeyDown={(event) => navigateGrid(event, row, column, key)}>{assignments.map((assignment) => <div key={assignment.id} className="mb-1"><span className="font-medium">{assignment.position_name ?? assignment.team_name}</span> <Badge tone={assignment.status === 'declined' ? 'danger' : assignment.status === 'confirmed' ? 'success' : 'neutral'}>{assignment.visibility === 'prepared' ? t('matrix.prepared') : t(`common:assignmentStatus.${assignment.status}`)}</Badge></div>)}{!assignments.length && <span className="text-slate-400">{t('matrix.emptyCell')}</span>}{conflicts.length > 0 && <div className="mt-1 text-xs text-amber-700">⚠ {t('matrix.conflictCount', { count: conflicts.length })}</div>}</button></td>; })}</tr>)}</tbody>
            </table>
          </div>
          {matrix.data.next_cursor && <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={() => setCursor(matrix.data!.next_cursor ?? undefined)}>{t('matrix.nextPeople')}</Button></div>}
        </>
      )}

      <Modal open={Boolean(preview)} title={t('matrix.reviewTitle')} onClose={() => { if (!commitMutation.isPending) setPreview(null); }}>
        {preview && <div className="space-y-4"><p className="text-sm">{t('matrix.reviewIntro', { count: preview.items.length })}</p><ul className="max-h-80 space-y-2 overflow-y-auto">{preview.items.map((item) => <li key={item.index} className="rounded-lg border p-3 text-sm"><div className="font-medium">{t('matrix.itemTitle', { name: item.person_name, plan: item.plan_title })}</div><div className="text-slate-500">{t(item.delivery_intent === 'assignment_request' ? 'matrix.itemWillNotify' : 'matrix.itemNoDelivery', { action: t(`matrix.actions.${item.action.kind}`) })}</div>{item.conflicts.map((conflict, index) => <div key={index} className="mt-1 text-amber-700">⚠ {conflictText(conflict)}</div>)}{staffingMatrixItemWarnings(item, structured).map((warning) => <div key={warning} className="mt-1 text-amber-700">{warning}</div>)}</li>)}</ul>{preview.has_blocking_conflicts && <p role="alert" className="text-sm text-red-700">{t('matrix.resolveBlocking')}</p>}<ErrorNotice error={commitMutation.error} /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setPreview(null)}>{t('common:actions.back')}</Button><Button disabled={preview.has_blocking_conflicts} loading={commitMutation.isPending} onClick={() => commitMutation.mutate()}>{t('matrix.commitAll')}</Button></div></div>}
      </Modal>
    </div>
  );
};
