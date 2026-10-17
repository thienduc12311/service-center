import type {
  AssignmentRequestSnapshotItemRow,
  AssignmentRequestSnapshotRow,
  AssignmentRow,
  AssignmentTimeResponseRow,
  PlanTimeRow,
} from '@service-center/shared';

export interface SnapshotAssignmentJoin extends AssignmentRequestSnapshotItemRow {
  assignment: Pick<AssignmentRow, 'id' | 'plan_id' | 'status' | 'request_revision'> & {
    team: { name: string } | null;
    position: { name: string } | null;
    plan: { title: string } | null;
    time_responses: AssignmentTimeResponseRow[];
  };
}

export interface SnapshotWithItems extends AssignmentRequestSnapshotRow {
  items: SnapshotAssignmentJoin[];
}

export interface SnapshotTimeIndex {
  byId: Map<string, PlanTimeRow>;
}
