import type { AssignmentDetail, StageRosterPerson } from '@service-center/shared';

/**
 * The people a plan currently staffs, one entry per Person, as a stage layout
 * compares against. Declined requests do not count; prepared ones (visible to
 * their schedulers only, by RLS) are marked so the UI can say "not yet asked".
 */
export const stageRosterFromPlan = (
  assignments: ReadonlyArray<
    Pick<AssignmentDetail, 'person_id' | 'status' | 'visibility' | 'person' | 'team' | 'position'>
  >,
): StageRosterPerson[] => {
  const byPerson = new Map<string, StageRosterPerson>();
  for (const assignment of assignments) {
    if (assignment.status === 'declined' || !assignment.person_id) continue;
    const role = [assignment.team?.name, assignment.position?.name].filter(Boolean).join(': ');
    const existing = byPerson.get(assignment.person_id);
    const prepared = assignment.visibility === 'prepared';
    if (existing) {
      if (role && !existing.roles.includes(role)) existing.roles.push(role);
      existing.prepared = existing.prepared && prepared;
      continue;
    }
    byPerson.set(assignment.person_id, {
      person_id: assignment.person_id,
      name: assignment.person?.full_name?.trim() || 'Unnamed person',
      roles: role ? [role] : [],
      prepared,
      archived: false,
    });
  }
  return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
};
