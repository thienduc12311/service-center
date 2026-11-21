import {
  ALREADY_CHURCH_MEMBER,
  CHURCH_APPLICATION_REQUIRED,
  CHURCH_NOT_FOUND,
  JOIN_REQUEST_NOT_PENDING,
  JOIN_REQUEST_PENDING,
  STORAGE_QUOTA_EXCEEDED,
} from '@service-center/shared';
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
  static upstreamUnavailable = () =>
    new HttpError(503, 'A required service is temporarily unavailable. Please try again.', 'upstream_unavailable');
  static upstreamError = () =>
    new HttpError(502, 'A required service returned an unexpected response. Please try again.', 'upstream_error');
  static upstreamTimeout = () =>
    new HttpError(504, 'A required service took too long to respond. Please try again.', 'upstream_timeout');
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
  // F12 — every one of these means "nothing was applied; reload the run".
  run_changed: 'run_revision_stale',
  run_control_lost: 'run_control_lost',
  run_control_held: 'run_control_held',
  run_exists: 'run_exists',
  run_state: 'run_state_invalid',
  import_changed: 'import_changed',
  library_changed: 'library_changed',
  song_revision_stale: 'song_revision_stale',
  arrangement_revision_stale: 'arrangement_revision_stale',
  // F13
  file_changed: 'file_revision_stale',
  file_in_use: 'file_in_use',
  // Super-admin user management.
  target_is_platform_admin: 'target_is_platform_admin',
  last_platform_admin: 'last_platform_admin',
  already_platform_admin: 'already_platform_admin',
  user_blocked: 'user_blocked',
  invitation_not_open: 'invitation_not_open',
  // F16
  attendance_changed: 'attendance_revision_stale',
  publication_changed: 'publication_revision_stale',
  // F17
  webhook_changed: 'webhook_endpoint_stale',
  // Account deletion: an organization would be left without an owner.
  account_deletion_blocked: 'account_deletion_blocked',
  // Super-admin dashboard: the application was decided or withdrawn meanwhile.
  application_not_pending: 'application_not_pending',
  // Joining a church by its slug.
  already_church_member: ALREADY_CHURCH_MEMBER,
  join_request_pending: JOIN_REQUEST_PENDING,
  join_request_not_pending: JOIN_REQUEST_NOT_PENDING,
};

const TIMEOUT_PATTERN = /timeout|timed out|aborted|ETIMEDOUT/i;
const NETWORK_PATTERN = /fetch failed|network|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket|EPIPE|UND_ERR/i;
const JWT_PATTERN = /\bJWT\b.*(expired|invalid|malformed|signature)|invalid jwt/i;
const JWT_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303']);

const logUpstream = (detail: Record<string, unknown>): void => {
  if (process.env.NODE_ENV === 'test') return;
  console.error('[upstream-error]', detail);
};

/**
 * Maps a failure from an upstream dependency (network, Kong, PostgREST) that
 * has no application meaning. The client only ever sees a generic message and
 * a stable code; the detail goes to the server log.
 */
export const fromUpstreamFailure = (message: string, code?: string): HttpError => {
  logUpstream({ code: code ?? null, message });
  if (TIMEOUT_PATTERN.test(message)) return HttpError.upstreamTimeout();
  if (NETWORK_PATTERN.test(message) || code === 'PGRST000' || code === 'PGRST001' || code === 'PGRST002') {
    return HttpError.upstreamUnavailable();
  }
  return HttpError.upstreamError();
};

export const fromPostgrestError = (error: {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}): HttpError => {
  // The caller's access token was rejected by PostgREST: same 401 the auth
  // middleware sends, so clients refresh their session.
  if ((error.code && JWT_CODES.has(error.code)) || JWT_PATTERN.test(error.message)) {
    return HttpError.unauthorized('Invalid or expired session');
  }
  if (error.code === 'PT409' && error.hint && PT409_HINTS[error.hint]) {
    return new HttpError(
      409,
      error.message,
      PT409_HINTS[error.hint],
      error.hint === 'scheduling_conflict' ? parseConflictDetail(error.details) : undefined,
    );
  }
  // Super-admin user management: blocking, deleting or revoking yourself.
  if (error.code === '22023' && error.hint === 'cannot_target_self') {
    return new HttpError(400, error.message, 'cannot_target_self');
  }
  switch (error.code) {
    case 'PGRST116':
      return HttpError.notFound();
    case '55P03':
    case '40P01':
      return HttpError.conflict('Library is busy; retry the same reviewed request');
    case '23505':
      return HttpError.conflict('That record already exists', error.details);
    case '23503':
      return HttpError.badRequest('Referenced record does not exist', error.details);
    case '23514':
      return HttpError.badRequest('A value failed a database constraint', error.details);
    // Malformed uuid/number/date literals that slipped past request
    // validation: the caller's input, never the engine's message.
    case '22P02':
      return HttpError.badRequest('Invalid identifier or value');
    // NUL bytes / unencodable text and lone surrogates that slipped past validation.
    case '22P05':
    case '22021':
      return HttpError.unprocessable('Text contains unsupported characters');
    // PostgREST's general "invalid request body" (malformed JSON, mismatched bulk keys).
    case 'PGRST102':
      return HttpError.badRequest('Invalid request body');
    case '22007':
    case '22008':
      return HttpError.badRequest('Invalid date or time');
    case '42501':
      // A beneficiary tried to approve their own claim, offer or swap (W2-RESP-D2).
      if (error.hint === 'self_approval') return new HttpError(403, error.message, 'self_approval');
      // Self-serve church creation is off: the person should apply instead.
      if (error.hint === 'church_application_required') {
        return new HttpError(403, error.message, CHURCH_APPLICATION_REQUIRED);
      }
      return HttpError.forbidden();
    // Raised by our own database functions with a message written for people.
    case 'PT404':
    case 'P0002':
      // Unknown and disabled churches read the same (request_to_join_church).
      if (error.hint === 'church_not_found') return new HttpError(404, error.message, CHURCH_NOT_FOUND);
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
    // The church is out of media storage.
    case 'PT413':
      return new HttpError(413, error.message, STORAGE_QUOTA_EXCEEDED);
    case 'PT410':
      return new HttpError(410, error.message, 'assignment_request_expired');
    default:
      // No SQLSTATE/PostgREST code: the failure came from the network or a
      // gateway, not from the database.
      if (!error.code) return fromUpstreamFailure(error.message);
      if (/^PGRST00[012]$/.test(error.code)) return fromUpstreamFailure(error.message, error.code);
      logUpstream({ code: error.code, message: error.message, details: error.details ?? null, hint: error.hint ?? null });
      return new HttpError(500, 'Internal server error', 'internal_error');
  }
};
