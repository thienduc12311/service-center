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
export const fromPostgrestError = (error: { code?: string; message: string; details?: string | null }): HttpError => {
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
    default:
      return new HttpError(500, error.message, error.code);
  }
};
