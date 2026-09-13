import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { nextOccurrence, type PlanSummary } from '@service-center/shared';
import { api } from '../lib/api';
import { usePlan, usePlans, useTeams, useInvalidateOrg } from '../hooks/queries';
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
import { EditNotesModal } from '../components/plan/EditNotesModal';
import { ImportTemplateModal } from '../components/plan/ImportTemplateModal';
import { PLAN_TABS, PLAN_TAB_LABELS, buildPlanTeams, type PlanTab } from '../components/plan/types';

/** Which dialog, if any, is on top of the workspace. */
type PlanDialog = 'add-item' | 'schedule-people' | 'edit-times' | 'edit-notes' | 'import-template';

export const PlanDetailPage = () => {
  const { planId } = useParams<{ planId: string }>();
  const { canManage, user, organizationId } = useAuth();
  const navigate = useNavigate();
  const invalidate = useInvalidateOrg();

  const plan = usePlan(planId);
  const teams = useTeams();

  const [tab, setTab] = useState<PlanTab>('order');
  const [dialog, setDialog] = useState<PlanDialog | null>(null);
  const [showAllTeams, setShowAllTeams] = useState(false);
  const [editingNeeds, setEditingNeeds] = useState(false);

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

  const notify = useMutation({
    mutationFn: () => api.notifyPlan(planId!),
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
  const organizationName =
    user?.memberships.find((membership) => membership.organization.id === organizationId)
      ?.organization.name ?? 'Service Center';

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

  return (
    <div>
      <PlanWorkspaceHeader
        plan={detail}
        organizationName={organizationName}
        canManage={canManage}
        previousPlanId={neighbours.previous}
        nextPlanId={neighbours.next}
        creatingNextPlan={addNextPlan.isPending}
        onCreateNextPlan={() => addNextPlan.mutate()}
        onTogglePublished={() =>
          publish.mutate(detail.status === 'published' ? 'draft' : 'published')
        }
        onNotify={() => notify.mutate()}
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
            setNeed.error ??
            addNextPlan.error ??
            removePlan.error
          }
        />
        {notify.isSuccess && (
          <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            Sent {notify.data.notified} notification{notify.data.notified === 1 ? '' : 's'}.
            {notify.data.skipped.length > 0 &&
              ` ${notify.data.skipped.length} could not be reached because no email address is available.`}
          </p>
        )}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[16rem_1fr]">
        <PlanSidebar
          plan={detail}
          canManage={canManage}
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
              canManage={canManage}
              onAddItem={() => setDialog('add-item')}
              onMoveItem={move}
              onRemoveItem={(itemId) => removeItem.mutate(itemId)}
            />
          )}

          {tab === 'teams' && (
            <TeamsTab
              teams={showAllTeams ? everyTeam : serviceTeams}
              canManage={canManage}
              currentUserId={user?.profile.id ?? null}
              editingNeeds={editingNeeds && canManage}
              onEditingNeedsChange={setEditingNeeds}
              onNeedChange={(positionId, needed) => setNeed.mutate({ positionId, needed })}
              onAddPeople={() => setDialog('schedule-people')}
              onRemoveAssignment={(assignmentId) => removeAssignment.mutate(assignmentId)}
              onRespond={(id, status) => respond.mutate({ id, status })}
              showAllTeams={showAllTeams}
              onToggleAllTeams={() => setShowAllTeams((current) => !current)}
            />
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
        onClose={() => setDialog(null)}
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
