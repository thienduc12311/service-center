import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { TimeInputError } from '@service-center/shared';
import { HttpError, fromUpstreamFailure } from '../lib/errors.js';

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}`, code: 'not_found' });
};

/** What the client is told about a body-parser failure: never the parser's own message. */
interface BodyParserFailure {
  status: number;
  error: string;
  code: string;
}

const UNSUPPORTED_ENCODING: BodyParserFailure = { status: 415, error: 'Request body encoding is not supported', code: 'unsupported_media_type' };

const BODY_PARSER_FAILURES: Readonly<Record<string, BodyParserFailure>> = {
  'entity.parse.failed': { status: 400, error: 'Request body is not valid JSON', code: 'invalid_json' },
  'entity.too.large': { status: 413, error: 'Request body is too large', code: 'payload_too_large' },
  'encoding.unsupported': UNSUPPORTED_ENCODING,
  'charset.unsupported': UNSUPPORTED_ENCODING,
  'request.aborted': { status: 400, error: 'Request body was not received completely', code: 'request_aborted' },
  'request.size.invalid': { status: 400, error: 'Request body does not match its Content-Length', code: 'bad_request' },
};

/**
 * body-parser errors carry a `type`; known ones get a fixed answer, any other
 * client-side one keeps the parser's 4xx status with a generic message.
 */
const bodyParserFailure = (err: unknown): BodyParserFailure | null => {
  if (typeof err !== 'object' || err === null || !('type' in err) || typeof err.type !== 'string') return null;
  const known = BODY_PARSER_FAILURES[err.type];
  if (known) return known;
  if ('status' in err && typeof err.status === 'number' && err.status >= 400 && err.status < 500) {
    return { status: err.status, error: 'Invalid request body', code: 'bad_request' };
  }
  return null;
};

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    return;
  }

  // body-parser failures: never echo the parser's message (W7-ACC-D6, W7-RESP-D3).
  const bodyFailure = bodyParserFailure(err);
  if (bodyFailure) {
    res.status(bodyFailure.status).json({ error: bodyFailure.error, code: bodyFailure.code });
    return;
  }

  // A local date/time the caller supplied cannot be resolved (W2-AVAIL-D1).
  if (err instanceof TimeInputError) {
    res.status(400).json({ error: err.message, code: 'bad_request' });
    return;
  }

  // A dependency failing mid-request (aborted by our timeout, connection refused).
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError' || /fetch failed/i.test(err.message))) {
    const mapped = fromUpstreamFailure(`${err.name}: ${err.message}`);
    res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    return;
  }

  if (!config.isTest) console.error('[error]', err);

  // The raw message may carry upstream or database detail: never send it.
  res.status(500).json({ error: 'Internal server error', code: 'internal_error' });
};
