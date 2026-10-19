import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import {
  listDeliveriesQuerySchema,
  runDeliveryWorkerSchema,
  type ListDeliveriesQuery,
  type RunDeliveryWorkerInput,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { parsedQuery, validateQuery } from '../lib/validate.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';
import { requireAdmin } from '../middleware/organization.js';
import { deliveryTransportStatus, listDeliveries, retryDelivery } from '../services/deliveries.js';
import { runDeliveryWorker } from '../services/delivery-worker.js';
import { runReportExportsSafely } from '../services/report-exports.js';
import { runFileMaintenanceSafely } from '../services/file-maintenance.js';
import { runWebhookDeliveriesSafely } from '../services/webhook-dispatch.js';

/** Administrator view of delivery outcomes, and manual retry. */
export const deliveriesRouter: Router = Router();

deliveriesRouter.get('/status', requireAdmin, async (req, res) => {
  res.json(await deliveryTransportStatus(req.db, req.orgId));
});

deliveriesRouter.get('/', requireAdmin, validateQuery(listDeliveriesQuerySchema), async (req, res) => {
  res.json(await listDeliveries(req.db, req.orgId, parsedQuery<ListDeliveriesQuery>(res)));
});

deliveriesRouter.post('/:id/retry', requireAdmin, async (req, res) => {
  res.json(await retryDelivery(req.db, req.orgId, param(req, 'id')));
});

/**
 * Bounded worker run for a scheduler: Vercel Cron (GET with
 * `Authorization: Bearer $CRON_SECRET`), a container cron, or an operator.
 * Not behind user auth; the shared secret is the only way in, and the route
 * does not exist unless the secret is configured.
 */
export const deliveryWorkerRouter: Router = Router();

const authorizedWorker = (header: string | undefined): boolean => {
  if (!config.CRON_SECRET || !header) return false;
  const expected = Buffer.from(`Bearer ${config.CRON_SECRET}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

deliveryWorkerRouter.all('/run', validateQuery(runDeliveryWorkerSchema), async (req, res) => {
  if (!config.CRON_SECRET) throw HttpError.notFound();
  if (req.method !== 'GET' && req.method !== 'POST') throw HttpError.notFound();
  if (!authorizedWorker(req.header('authorization'))) throw HttpError.unauthorized('Worker secret required');
  const { limit } = parsedQuery<RunDeliveryWorkerInput>(res);
  // Stay inside a 60s function budget: claim once, finish within ~45s.
  const deliveries = await runDeliveryWorker({ limit, timeBudgetMs: 45_000 });
  // F13: the same scheduled run settles expired uploads and removes discarded bytes.
  // F16: the same run builds queued report exports and deletes expired ones.
  // F17: and sends due webhook deliveries (short budget: the run shares 60 s).
  res.json({
    ...deliveries,
    files: await runFileMaintenanceSafely(),
    report_exports: await runReportExportsSafely(),
    webhooks: await runWebhookDeliveriesSafely(),
  });
});
