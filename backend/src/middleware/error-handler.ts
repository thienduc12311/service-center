import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { TimeInputError } from '@service-center/shared';
import { HttpError } from '../lib/errors.js';

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}`, code: 'not_found' });
};

/** The `type` body-parser attaches to its errors, or null for any other error. */
const bodyParserErrorType = (err: unknown): string | null => {
  if (typeof err !== 'object' || err === null || !('type' in err) || typeof err.type !== 'string') return null;
  return ['entity.parse.failed', 'entity.too.large', 'encoding.unsupported', 'charset.unsupported', 'request.aborted'].includes(err.type)
    ? err.type
    : null;
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
  const bodyError = bodyParserErrorType(err);
  if (bodyError === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large', code: 'payload_too_large' });
    return;
  }
  if (bodyError) {
    res.status(400).json({ error: 'Request body is not valid JSON', code: 'invalid_json' });
    return;
  }

  // A local date/time the caller supplied cannot be resolved (W2-AVAIL-D1).
  if (err instanceof TimeInputError) {
    res.status(400).json({ error: err.message, code: 'bad_request' });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected error';
  if (!config.isTest) console.error('[error]', err);

  res.status(500).json({
    error: config.isProduction ? 'Internal server error' : message,
    code: 'internal_error',
  });
};
