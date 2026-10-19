import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  computePlanSchedule,
  isAdmin,
  nextOccurrence,
  selectServiceTime,
  serviceTimesOf,
  renderServiceSongBookHtml,
  serviceSongBookDocumentFromPlan,
  type AssignmentDetail,
  type PlanItemDetail,
  type PlanSummary,
} from '@service-center/shared';
import { api } from '../lib/api';
import { printDocument } from '../lib/print-document';
import { keys, usePlan, usePlanNotes, usePlans, useTeams, useTemplateApplications, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Loading } from '../components/ui';
import { MessageComposerModal } from '../components/collaboration/MessageComposerModal';
import { PlanWorkspaceHeader } from '../components/plan/PlanWorkspaceHeader';
import { PlanSidebar } from '../components/plan/PlanSidebar';
import { OrderTab } from '../components/plan/OrderTab';
import { TeamsTab } from '../components/plan/TeamsTab';
import { PlanDeliveryPanel } from '../components/plan/PlanDeliveryPanel';
import { RehearseTab } from '../components/plan/RehearseTab';
import { PlanFilesTab } from '../components/files/PlanFilesTab';
import { AddItemModal } from '../components/plan/AddItemModal';
import { EditItemModal } from '../components/plan/EditItemModal';
import { PrintOrderModal } from '../components/plan/PrintOrderModal';
import { SchedulePeopleModal } from '../components/plan/SchedulePeopleModal';
import { EditTimesModal } from '../components/plan/EditTimesModal';
import { AssignmentTimesModal } from '../components/plan/AssignmentTimesModal';
import { ItemDiscussionModal } from '../components/collaboration/ItemDiscussionModal';
import { ImportTemplateModal } from '../components/plan/ImportTemplateModal';
import { ApplyTemplateModal } from '../components/templates/ApplyTemplateModal';
import { SaveTemplateModal } from '../components/templates/SaveTemplateModal';
import { DeliveryOutcomeNotice } from '../components/plan/DeliveryOutcomeNotice';
import { OpportunityPanel, type SignupSetupOption } from '../components/plan/OpportunityPanel';
import { PLAN_TABS, PLAN_TAB_LABELS, buildPlanTeams, type PlanTab } from '../components/plan/types';

/** Which dialog, if any, is on top of the workspace. */
type PlanDialog = 'add-item' | 'schedule-people' | 'edit-times' | 'import-template' | 'apply-template' | 'save-template' | 'print-order';

export const PlanDetailPage = () => {
  const { planId } = useParams<{ planId: string }>();
  const { can, canAnywhere, user, organizationId, role } = useAuth();
  const navigate = useNavigate();
  const invalidate = useInvalidateOrg();

  const plan = usePlan(planId);
  const teams = useTeams();
  // F04: which requests were committed over a conflict (RLS shows only teams I schedule).
  const overrides = useQuery({
    queryKey: keys.conflictOverrides(organizationId, planId ?? ''),
    queryFn: () => api.planConflictOverrides(planId!),
    enabled: Boolean(planId) && canAnywhere('scheduling.manage'),
  });
  // F10: which template revisions this plan's content came from.
  const templateApplications = useTemplateApplications(planId, canAnywhere('plans.edit'));
  const overrideReasons = useMemo(
    () => new Map((overrides.data ?? []).flatMap((row) => (row.assignment_id ? [[row.assignment_id, row.reason] as const] : []))),
    [overrides.data],
  );

  const [tab, setTab] = useState<PlanTab>('order');
  const [dialog, setDialog] = useState<PlanDialog | null>(null);
  const [showAllTeams, setShowAllTeams] = useState(false);
  const [editingNeeds, setEditingNeeds] = useState(false);
  const [editingTimesFor, setEditingTimesFor] = useState<AssignmentDetail | null>(null);
  const [discussingId, setDiscussingId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  /** F11: which service time the order is timed against; null = the first. */
  const [timeId, setTimeId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const queryClient = useQueryClient();
  const openChat = useMutation({
    mutationFn: () => api.openConversation({ kind: 'plan', target_id: planId! }),
    onSuccess: async (conversation) => {
      await queryClient.invalidateQueries({ queryKey: keys.conversations(organizationId) });
      navigate(`/chat/${conversation.id}`);
    },
  });
  const notes = usePlanNotes(planId ?? '');
  const itemNoteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes.data?.notes ?? []) {
      if (note.plan_item_id) counts.set(note.plan_item_id, (counts.get(note.plan_item_id) ?? 0) + 1);
    }
    return counts;
  }, [notes.data]);

  const serviceTypeId = plan.data?.service_type_id ?? undefined;
  // Siblings drive the ‹ › arrows: the other plans of the same service type.
  const siblings = usePlans({
    ...(serviceTypeId ? { service_type_id: serviceTypeId } : {}),
    order: 'asc',
    per_page: 100,
  });

  const neighbours = useMemo(() => {
    const all: PlanSummary[] = siblings.data?.data ?? [];
    const index = all.findIndex((candidate) => candidate.id === planId);
    if (index === -1) return { previous: null, next: null };
    return {
      previous: all[index - 1]?.id ?? null,
      next: all[index + 1]?.id ?? null,
    };
  }, [siblings.data, planId]);

  const publish = useMutation({
    mutationFn: (status: 'draft' | 'published') => api.updatePlan(planId!, { status }),
    onSuccess: invalidate,
  });

  // The key travels with the request, so a retried request is answered with
  // the first one's outcomes instead of notifying everyone twice.
  const notify = useMutation({
    mutationFn: (idempotencyKey: string) => api.notifyPlan(planId!, { idempotency_key: idempotencyKey }),
    onSuccess: invalidate,
  });

  // F11: order changes carry the revision they were made against; a stale
  // one is refused, and the refreshed order is shown instead.
  const reorder = useMutation({
    mutationFn: ({ itemIds, revision }: { itemIds: string[]; revision: number }) =>
      api.reorderPlanItems(planId!, itemIds, revision),
    onSettled: invalidate,
  });

  const removeItem = useMutation({
    mutationFn: ({ itemId, revision }: { itemId: string; revision: number }) =>
      api.deletePlanItem(planId!, itemId, revision),
    onSettled: invalidate,
  });

  // Exactly the reviewed ids; a repeated click is a no-op on the server.
  const release = useMutation({
    mutationFn: (assignments: AssignmentDetail[]) =>
      api.releaseAssignments(planId!, {
        assignment_ids: assignments.map((assignment) => assignment.id),
        expected_revisions: assignments.map((assignment) => ({
          assignment_id: assignment.id,
          request_revision: assignment.request_revision,
        })),
        notify: true,
        idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: invalidate,
  });

  const removeAssignment = useMutation({
    mutationFn: (assignmentId: string) => api.deleteAssignment(assignmentId),
    onSuccess: invalidate,
  });

  const respond = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'confirmed' | 'declined' }) =>
      api.respondToAssignment(id, { status }),
    onSuccess: invalidate,
  });

  const setNeed = useMutation({
    mutationFn: ({ positionId, needed }: { positionId: string; needed: number }) =>
      api.setPlanPositionNeeds(planId!, { needs: [{ position_id: positionId, needed }] }),
    onSuccess: invalidate,
  });

  const removePlan = useMutation({
    mutationFn: () => api.deletePlan(planId!),
    onSuccess: async () => {
      await invalidate();
      navigate('/plans', { replace: true });
    },
  });

  /** "+" adds the next plan in the service type's rhythm, with the times shifted to match. */
  const addNextPlan = useMutation({
    mutationFn: async () => {
      const current = plan.data!;
      const start = nextOccurrence(
        current.service_date,
        current.service_type?.recurrence ?? 'weekly',
      );
      const offsetMs = start.getTime() - new Date(current.service_date).getTime();
      const shift = (iso: string): string => new Date(new Date(iso).getTime() + offsetMs).toISOString();

      return api.createPlan({
        title: current.title,
        service_type_id: current.service_type_id,
        service_date: start.toISOString(),
        location: current.location,
        status: 'draft',
        times: current.times.map((time) => ({
          kind: time.kind,
          name: time.name,
          starts_at: shift(time.starts_at),
          ends_at: shift(time.ends_at),
        })),
      });
    },
    onSuccess: async (created) => {
      await invalidate();
      navigate(`/plans/${created.id}`);
    },
  });

  const everyTeam = useMemo(
    () =>
      plan.data
        ? buildPlanTeams({ plan: plan.data, teams: teams.data ?? [], includeEveryTeam: true })
        : [],
    [plan.data, teams.data],
  );

  const serviceTeams = useMemo(
    () =>
      plan.data
        ? buildPlanTeams({ plan: plan.data, teams: teams.data ?? [], includeEveryTeam: false })
        : [],
    [plan.data, teams.data],
  );

  /** "My Teams": the ones I'm a member of, or am scheduled on for this plan. */
  const myTeams = useMemo(() => {
    const me = user?.profile.id;
    if (!me) return [];
    return everyTeam.filter(
      (view) =>
        view.team.members.some((member) => member.user_id === me) ||
        [...view.positions.flatMap((position) => position.scheduled), ...view.unpositioned].some(
          (assignment) => assignment.user_id === me,
        ),
    );
  }, [everyTeam, user]);

  const organization = user?.memberships.find((membership) => membership.organization.id === organizationId)?.organization;
  const timeZone = organization?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const serviceTimes = useMemo(() => serviceTimesOf(plan.data?.times ?? []), [plan.data?.times]);
  const selectedTime = plan.data ? (selectServiceTime(plan.data.times, timeId) ?? selectServiceTime(plan.data.times)) : null;
  const schedule = useMemo(
    () => computePlanSchedule({ items: plan.data?.items ?? [], time: selectedTime ?? null }),
    [plan.data?.items, selectedTime],
  );
  const positionNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const team of teams.data ?? []) for (const position of team.positions) names.set(position.id, position.name);
    for (const position of plan.data?.plan_positions ?? []) names.set(position.id, position.name);
    return names;
  }, [teams.data, plan.data?.plan_positions]);

  if (plan.isLoading) return <Loading />;
  if (plan.error) return <ErrorNotice error={plan.error} />;
  if (!plan.data || !planId) return <EmptyState title="Plan not found" />;

  const detail = plan.data;
  const discussing = detail.items.find((item) => item.id === discussingId) ?? null;
  const target = { serviceTypeId: detail.service_type_id };
  const canEditPlan = can('plans.edit', target);
  const canScheduleTeam = (teamId: string): boolean => can('scheduling.manage', { ...target, teamId });
  const canSchedule = can('scheduling.manage', target) || (teams.data ?? []).some((team) => canScheduleTeam(team.id));
  const organizationName =
    user?.memberships.find((membership) => membership.organization.id === organizationId)
      ?.organization.name ?? 'Service Center';
  const allAssignments = everyTeam.flatMap((view) => [...view.positions.flatMap((position) => position.scheduled), ...view.unpositioned]);
  const currentPersonId = allAssignments.find((assignment) => assignment.user_id === user?.profile.id)?.person_id ?? null;
  const signupOptions: SignupSetupOption[] = everyTeam.flatMap((view) => view.positions.map((position) => ({
    teamId: view.team.id,
    teamName: view.team.name,
    positionId: position.position.id,
    positionName: position.position.name,
    needed: position.needed,
    canManage: canScheduleTeam(view.team.id),
  })));

  const orderBusy = reorder.isPending || removeItem.isPending || plan.isFetching;
  const move = (index: number, direction: -1 | 1) => {
    const ids = detail.items.map((item) => item.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length || orderBusy) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate({ itemIds: ids, revision: detail.content_revision });
  };

  const confirmRemove = (item: PlanItemDetail) => {
    const notesOnItem = itemNoteCounts.get(item.id) ?? 0;
    const warning = notesOnItem > 0 ? ` Its ${notesOnItem} note${notesOnItem === 1 ? '' : 's'} and discussion will be removed too.` : '';
    if (window.confirm(`Remove “${item.title}” from this plan?${warning}`)) {
      removeItem.mutate({ itemId: item.id, revision: detail.content_revision });
    }
  };
  const orderError = reorder.error ?? removeItem.error;
  const orderStale = orderError instanceof ApiError && orderError.code === 'plan_revision_stale';
  const editingItem = detail.items.find((item) => item.id === editingItemId) ?? null;

  const openNeededPositions = () => {
    setTab('teams');
    setEditingNeeds(true);
  };

  const exportSongBook = () => {
    const songBook = serviceSongBookDocumentFromPlan({
      plan: detail,
      organizationName,
    });
    printDocument(renderServiceSongBookHtml(songBook), 'Service song book print preview');
  };

  return (
    <div>
      <PlanWorkspaceHeader
        plan={detail}
        organizationName={organizationName}
        canManage={canEditPlan}
        canNotify={canSchedule}
        previousPlanId={neighbours.previous}
        nextPlanId={neighbours.next}
        creatingNextPlan={addNextPlan.isPending}
        onCreateNextPlan={() => addNextPlan.mutate()}
        onExportSongBook={exportSongBook}
        onTogglePublished={() =>
          publish.mutate(detail.status === 'published' ? 'draft' : 'published')
        }
        onNotify={() => notify.mutate(crypto.randomUUID())}
        onDelete={() => {
          if (window.confirm(`Delete “${detail.title}”? This cannot be undone.`)) {
            removePlan.mutate();
          }
        }}
      />

      <div className="mt-4 space-y-3">
        <ErrorNotice
          error={
            publish.error ??
            notify.error ??
            (orderStale ? null : orderError) ??
            respond.error ??
            release.error ??
            setNeed.error ??
            addNextPlan.error ??
            removePlan.error
          }
        />
        {notify.isSuccess && <DeliveryOutcomeNotice result={notify.data} canRetry={isAdmin(role)} />}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate(`/plans/${planId}/live`)}>Live</Button>
          <Button variant="secondary" loading={openChat.isPending} onClick={() => openChat.mutate()}>Plan chat</Button>
          {canSchedule && <Button variant="secondary" onClick={() => setComposing(true)}>Message people</Button>}
          {canEditPlan && <Button variant="secondary" onClick={() => setDialog('apply-template')}>Apply template</Button>}
          {canEditPlan && <Button variant="secondary" onClick={() => setDialog('save-template')}>Save as template</Button>}
        </div>
        {(templateApplications.data?.length ?? 0) > 0 && (
          <p className="text-xs text-slate-500">
            From template{' '}
            {templateApplications.data!.map((applied) =>
              `“${applied.template_name}” rev ${applied.template_revision}${applied.template_kind === 'section' ? ' (section)' : ''}`,
            ).join(', ')}
            . Later template edits do not change this plan.
          </p>
        )}
        <ErrorNotice error={openChat.error ? new Error('Plan chat is open to plan leaders and the people scheduled on this plan.') : null} />
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[16rem_1fr]">
        <PlanSidebar
          plan={detail}
          canEditPlan={canEditPlan}
          canSchedule={canSchedule}
          myTeams={myTeams}
          everyTeam={everyTeam}
          showAllTeams={showAllTeams}
          onToggleAllTeams={() => setShowAllTeams((current) => !current)}
          onEditTimes={() => setDialog('edit-times')}
          onImportTemplate={() => setDialog('import-template')}
          onAddPeople={() => setDialog('schedule-people')}
          onEditNeededPositions={openNeededPositions}
        />

        <div className="min-w-0">
          <div className="mb-4 flex gap-6 border-b border-slate-200 dark:border-slate-800">
            {PLAN_TABS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                aria-current={tab === value ? 'page' : undefined}
                className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition ${
                  tab === value
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {PLAN_TAB_LABELS[value]}
              </button>
            ))}
          </div>

          {tab === 'order' && (
            <>
              {orderStale && (
                <p role="alert" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20">
                  Someone else changed this plan, so your last change was not saved. The order below is the latest — check it and try again.
                </p>
              )}
              <OrderTab
                plan={detail}
                canManage={canEditPlan}
                schedule={schedule}
                timeZone={timeZone}
                serviceTimes={serviceTimes}
                selectedTimeId={selectedTime?.id ?? null}
                onSelectTime={setTimeId}
                positionNames={positionNames}
                busy={orderBusy}
                onAddItem={() => setDialog('add-item')}
                onEditItem={(item) => setEditingItemId(item.id)}
                onMoveItem={move}
                onRemoveItem={confirmRemove}
                onPrint={() => setDialog('print-order')}
                onDiscussItem={(item) => setDiscussingId(item.id)}
                itemNoteCounts={itemNoteCounts}
              />
            </>
          )}

          {tab === 'teams' && (
            <>
            <OpportunityPanel planId={planId} options={signupOptions} assignments={allAssignments} currentPersonId={currentPersonId} />
            <TeamsTab
              teams={showAllTeams ? everyTeam : serviceTeams}
              canScheduleTeam={canScheduleTeam}
              canEditPlan={canEditPlan}
              onRelease={(assignments) => release.mutate(assignments)}
              releasing={release.isPending}
              currentUserId={user?.profile.id ?? null}
              editingNeeds={editingNeeds && (canEditPlan || canSchedule)}
              onEditingNeedsChange={setEditingNeeds}
              onNeedChange={(positionId, needed) => setNeed.mutate({ positionId, needed })}
              onAddPeople={() => setDialog('schedule-people')}
              onRemoveAssignment={(assignmentId) => removeAssignment.mutate(assignmentId)}
              onRespond={(id, status) => respond.mutate({ id, status })}
              onEditTimes={setEditingTimesFor}
              overrideReasons={overrideReasons}
              showAllTeams={showAllTeams}
              onToggleAllTeams={() => setShowAllTeams((current) => !current)}
            />
            {canSchedule && <PlanDeliveryPanel planId={planId} />}
            </>
          )}

          {tab === 'rehearse' && <RehearseTab plan={detail} />}

          {tab === 'files' && <PlanFilesTab plan={detail} />}
        </div>
      </div>

      {editingItem && (
        <EditItemModal
          key={editingItem.id}
          plan={detail}
          item={editingItem}
          teams={teams.data ?? []}
          onClose={() => setEditingItemId(null)}
        />
      )}
      {dialog === 'print-order' && (
        <PrintOrderModal
          plan={detail}
          organizationName={organizationName}
          timeZone={timeZone}
          serviceTimes={serviceTimes}
          initialTimeId={selectedTime?.id ?? null}
          positionNames={positionNames}
          onClose={() => setDialog(null)}
        />
      )}
      <AddItemModal
        open={dialog === 'add-item'}
        planId={planId}
        onClose={() => setDialog(null)}
      />
      <SchedulePeopleModal
        open={dialog === 'schedule-people'}
        planId={planId}
        serviceTypeId={detail.service_type_id}
        onClose={() => setDialog(null)}
      />
      <AssignmentTimesModal
        plan={detail}
        assignment={detail.assignments.find((assignment) => assignment.id === editingTimesFor?.id) ?? null}
        onClose={() => setEditingTimesFor(null)}
      />
      <EditTimesModal
        open={dialog === 'edit-times'}
        plan={detail}
        onClose={() => setDialog(null)}
      />
      {composing && (
        <MessageComposerModal
          plan={detail}
          teams={(teams.data ?? []).filter((team) => canScheduleTeam(team.id))}
          onClose={() => setComposing(false)}
        />
      )}
      {discussing && (
        <ItemDiscussionModal planId={planId} item={discussing} onClose={() => setDiscussingId(null)} />
      )}
      <ImportTemplateModal
        open={dialog === 'import-template'}
        plan={detail}
        onClose={() => setDialog(null)}
      />
      {dialog === 'apply-template' && <ApplyTemplateModal plan={detail} onClose={() => setDialog(null)} />}
      {dialog === 'save-template' && (
        <SaveTemplateModal
          plan={detail}
          onClose={() => setDialog(null)}
          onSaved={(templateId) => navigate(`/plans/templates?template=${templateId}`)}
        />
      )}
    </div>
  );
};
