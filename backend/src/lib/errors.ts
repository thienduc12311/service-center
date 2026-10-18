import { parseConflictDetail } from '../model/attendance.model.js';

/** An error that carries an HTTP status through to the response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest = (message: string, details?: unknown) =>
    new HttpError(400, message, 'bad_request', details);
  static unauthorized = (message = 'Authentication required') =>
    new HttpError(401, message, 'unauthorized');
  static forbidden = (message = 'You do not have access to do that') =>
    new HttpError(403, message, 'forbidden');
  static notFound = (message = 'Not found') => new HttpError(404, message, 'not_found');
  static conflict = (message: string, details?: unknown) =>
    new HttpError(409, message, 'conflict', details);
  static unprocessable = (message: string, details?: unknown) =>
    new HttpError(422, message, 'unprocessable', details);
}

/**
 * Translates a PostgREST error into an HTTP error.
 * RLS denials surface as empty results or 42501, both of which should read as
 * "not found" rather than leaking whether the row exists in another org.
 */
/**
 * F04 PT409 errors carry a machine-readable hint; each becomes its own API
 * code so clients can react (show conflicts, re-preview, refresh).
 */
const PT409_HINTS: Record<string, string> = {
  scheduling_conflict: 'scheduling_conflict',
  time_impact_stale: 'time_impact_stale',
  time_impact_required: 'time_impact_required',
  orphan_resolution_required: 'orphan_resolution_required',
  plan_changed: 'plan_revision_stale',
  assignment_changed: 'assignment_revision_stale',
  time_identity: 'time_identity_required',
  matrix_changed: 'matrix_changed',
  proposal_changed: 'proposal_changed',
  proposal_stale: 'proposal_stale',
  proposal_expired: 'proposal_expired',
  rotation_changed: 'rotation_changed',
  capacity_full: 'capacity_full',
  opportunity_closed: 'opportunity_closed',
  opportunity_changed: 'opportunity_changed',
  // F09
  note_stale: 'note_stale',
  comment_id_conflict: 'comment_id_conflict',
  comment_deleted: 'comment_deleted',
  idempotency_key_reused: 'idempotency_key_reused',
  audience_changed: 'audience_changed',
  message_id_conflict: 'message_id_conflict',
  message_removed: 'message_removed',
  message_unrecoverable: 'message_unrecoverable',
  // F10
  template_changed: 'template_changed',
  template_preview_changed: 'template_preview_changed',
};

export const fromPostgrestError = (error: {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}): HttpError => {
  if (error.code === 'PT409' && error.hint && PT409_HINTS[error.hint]) {
    return new HttpError(
      409,
      error.message,
      PT409_HINTS[error.hint],
      error.hint === 'scheduling_conflict' ? parseConflictDetail(error.details) : undefined,
    );
  }
  switch (error.code) {
    case 'PGRST116':
      return HttpError.notFound();
    case '23505':
      return HttpError.conflict('That record already exists', error.details);
    case '23503':
      return HttpError.badRequest('Referenced record does not exist', error.details);
    case '23514':
      return HttpError.badRequest('A value failed a database constraint', error.details);
    case '42501':
      return HttpError.forbidden();
    // Raised by our own database functions with a message written for people.
    case 'P0002':
      return HttpError.notFound(error.message);
    case '22023':
      return HttpError.badRequest(error.message);
    // Raised by guard triggers when a row is not in a state that allows the
    // change; PostgREST also answers direct table calls with 409 for it.
    case 'PT409':
      return HttpError.conflict('That change is no longer allowed');
    // F09: posting faster than a conversation allows.
    case 'PT429':
      return new HttpError(429, error.message, 'rate_limited');
    case 'PT410':
      return new HttpError(410, error.message, 'assignment_request_expired');
    default:
      return new HttpError(500, error.message, error.code);
  }
};
