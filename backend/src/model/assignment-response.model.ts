import type {
  AssignmentRow,
  AssignmentStatus,
  SelfResponseStatus,
  SelfResponseTransition,
} from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

/** A signed-in person answering one of their own assignments. */
export interface RespondToOwnAssignmentInput {
  db: Db;
  orgId: string;
  userId: string;
  assignmentId: string;
  status: SelfResponseStatus;
  reason: string | null;
  /** The status the client last saw; a mismatch is refused as stale. */
  expectedStatus?: AssignmentStatus;
}

/** The persisted result, and what kind of change it was. */
export interface SelfResponseOutcome {
  assignment: AssignmentRow;
  previousStatus: AssignmentStatus;
  transition: Exclude<SelfResponseTransition, 'forbidden'>;
}
