import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { HttpError } from './errors.js';

const formatIssues = (error: z.ZodError) =>
  error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));

/** Parses and replaces `req.body`, responding 422 with field-level detail. */
export const validateBody =
  <T extends ZodTypeAny>(schema: T) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      next(HttpError.unprocessable('Invalid request body', formatIssues(result.error)));
      return;
    }
    req.body = result.data;
    next();
  };

/**
 * Express 5 exposes `req.query` as a getter, so the parsed value is stashed on
 * `res.locals` rather than assigned back.
 */
export const validateQuery =
  <T extends ZodTypeAny>(schema: T) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) {
      next(HttpError.unprocessable('Invalid query parameters', formatIssues(result.error)));
      return;
    }
    res.locals.query = result.data;
    next();
  };

export const parsedQuery = <T>(res: Response): T => res.locals.query as T;

export const parseOrThrow = <T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw HttpError.unprocessable('Validation failed', formatIssues(result.error));
  }
  return result.data;
};
