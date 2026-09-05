import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}`, code: 'not_found' });
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

  const message = err instanceof Error ? err.message : 'Unexpected error';
  if (!config.isTest) console.error('[error]', err);

  res.status(500).json({
    error: config.isProduction ? 'Internal server error' : message,
    code: 'internal_error',
  });
};
