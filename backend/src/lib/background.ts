import { waitUntil } from '@vercel/functions';

/**
 * Runs work that outlives the response that started it.
 *
 * On a long-lived server (local dev, Docker) the promise simply keeps running,
 * and `waitUntil` is a no-op — outside a Vercel request context it resolves to
 * an empty context object. On Vercel the instance is frozen as soon as the
 * response flushes, so the platform has to be told to keep it alive or the work
 * is silently dropped half-finished.
 *
 * The rejection handler is attached before handing the promise over so a
 * failure is logged rather than surfacing as an unhandled rejection.
 */
export const runAfterResponse = (label: string, work: Promise<void>): void => {
  const tracked = work.catch((error: unknown) => {
    console.error(`[background] ${label} failed`, error);
  });
  waitUntil(tracked);
};
