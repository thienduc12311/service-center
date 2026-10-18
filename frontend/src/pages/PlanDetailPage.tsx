import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  isAdmin,
  nextOccurrence,
  renderServiceSongBookHtml,
  serviceSongBookDocumentFromPlan,
  type AssignmentDetail,
  type PlanSummary,
} from '@service-center/shared';
import { api } from '../lib/api';
import { printDocument } from '../lib/print-document';
import { keys, usePlan, usePlans, useTeams, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { EmptyState, ErrorNotice, Loading } from '../components/ui';
import { PlanWorkspaceHeader } from '../components/plan/PlanWorkspaceHeader';
import { PlanSidebar } from '../components/plan/PlanSidebar';
import { OrderTab } from '../components/plan/OrderTab';
import { TeamsTab } from '../components/plan/TeamsTab';
import { RehearseTab } from '../components/plan/RehearseTab';
import { AddItemModal } from '../components/plan/AddItemModal';
import { SchedulePeopleModal } from '../components/plan/SchedulePeopleModal';
import { EditTimesModal } from '../components/plan/EditTimesModal';
import { AssignmentTimesModal } from '../components/plan/AssignmentTimesModal';
import { EditNotesModal } from '../components/plan/EditNotesModal';
import { ImportTemplateModal } from '../components/plan/ImportTemplateModal';
import { DeliveryOutcomeNotice } from '../components/plan/DeliveryOutcomeNotice';
import { OpportunityPanel, type SignupSetupOption } from '../components/plan/OpportunityPanel';
import { PLAN_TABS, PLAN_TAB_LABELS, buildPlanTeams, type PlanTab } from '../components/plan/types';

/** Which dialog, if any, is on top of the workspace. */
type PlanDialog = 'add-item' | 'schedule-people' | 'edit-times' | 'edit-notes' | 'import-template';

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
  const overrideReasons = useMemo(
    () => new Map((overrides.data ?? []).flatMap((row) => (row.assignment_id ? [[row.assignment_id, row.reason] as const] : []))),
    [overrides.data],
  );

  const [tab, setTab] = useState<PlanTab>('order');
  const [dialog, setDialog] = useState<PlanDialog | null>(null);
  const [showAllTeams, setShowAllTeams] = useState(false);
  const [editingNeeds, setEditingNeeds] = useState(false);
  const [editingTimesFor, setEditingTimesFor] = useState<AssignmentDetail | null>(null);

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

  const reorder = useMutation({
    mutationFn: (itemIds: string[]) => api.reorderPlanItems(planId!, itemIds),
    onSuccess: invalidate,
  });

  const removeItem = useMutation({
    mutationFn: (itemId: string) => api.deletePlanItem(planId!, itemId),
    onSuccess: invalidate,
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

  if (plan.isLoading) return <Loading />;
  if (plan.error) return <ErrorNotice error={plan.error} />;
  if (!plan.data || !planId) return <EmptyState title="Plan not found" />;

  const detail = plan.data;
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

  const move = (index: number, direction: -1 | 1) => {
    const ids = detail.items.map((item) => item.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids);
  };

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
            reorder.error ??
            respond.error ??
            release.error ??
            setNeed.error ??
            addNextPlan.error ??
            removePlan.error
          }
        />
        {notify.isSuccess && <DeliveryOutcomeNotice result={notify.data} canRetry={isAdmin(role)} />}
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
          onEditNotes={() => setDialog('edit-notes')}
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
            <OrderTab
              plan={detail}
              canManage={canEditPlan}
              onAddItem={() => setDialog('add-item')}
              onMoveItem={move}
              onRemoveItem={(itemId) => removeItem.mutate(itemId)}
            />
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
            </>
          )}

          {tab === 'rehearse' && <RehearseTab plan={detail} />}
        </div>
      </div>

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
      <EditNotesModal
        open={dialog === 'edit-notes'}
        plan={detail}
        onClose={() => setDialog(null)}
      />
      <ImportTemplateModal
        open={dialog === 'import-template'}
        plan={detail}
        onClose={() => setDialog(null)}
      />
    </div>
  );
};
