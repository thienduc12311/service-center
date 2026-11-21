import { unwrap, type Db } from '../lib/supabase.js';
import { chunk } from '../lib/chunk.js';
import { fetchAllPages } from '../lib/paging.js';
import { toTimeResponseNotes, type TimeResponseNotes } from '../model/time-response.model.js';

/**
 * Per-time decline reasons the caller may read (W9-JRN-D1): the assignee, the
 * response owner and schedulers of each assignment. Postgres decides the
 * audience; other callers simply get no entry.
 */
export const timeResponseNotesFor = async (db: Db, assignmentIds: readonly string[]): Promise<TimeResponseNotes> => {
  const ids = [...new Set(assignmentIds)];
  if (ids.length === 0) return new Map();
  const batches = await Promise.all(
    chunk(ids).map((slice) =>
      fetchAllPages((from, to) =>
        unwrap(
          db
            .rpc('assignment_time_response_notes', { p_assignment_ids: slice })
            .order('assignment_id')
            .order('plan_time_id')
            .range(from, to),
        ),
      ),
    ),
  );
  return toTimeResponseNotes(batches.flat());
};
