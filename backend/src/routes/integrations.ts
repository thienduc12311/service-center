import { Router } from 'express';
import {
  createApiCredentialSchema,
  createWebhookEndpointSchema,
  setWebhookEnabledSchema,
  webhookDeliveriesQuerySchema,
  type CreateApiCredentialInput,
  type CreateWebhookEndpointInput,
  type SetWebhookEnabledInput,
  type WebhookDeliveriesQuery,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireAdmin } from '../middleware/organization.js';
import { createApiCredential, listApiCredentials, revokeApiCredential } from '../services/api-credentials.js';
import {
  createWebhookEndpoint,
  integrationStatus,
  listWebhookDeliveries,
  listWebhookEndpoints,
  retryWebhookDelivery,
  revokeWebhookEndpoint,
  sendWebhookTest,
  setWebhookEndpointEnabled,
} from '../services/webhooks.js';

/** F17: administrators manage API credentials and webhooks (RLS re-checks). */
export const integrationsRouter: Router = Router();

integrationsRouter.use(requireAdmin);

integrationsRouter.get('/status', (_req, res) => {
  res.json(integrationStatus());
});

integrationsRouter.get('/credentials', async (req, res) => {
  res.json(await listApiCredentials(req));
});

integrationsRouter.post('/credentials', validateBody(createApiCredentialSchema), async (req, res) => {
  const created = await createApiCredential(req, req.body as CreateApiCredentialInput);
  res.setHeader('Cache-Control', 'no-store');
  res.status(created.replayed ? 200 : 201).json(created);
});

integrationsRouter.post('/credentials/:id/revoke', async (req, res) => {
  res.json(await revokeApiCredential(req, param(req, 'id')));
});

integrationsRouter.get('/webhooks', async (req, res) => {
  res.json(await listWebhookEndpoints(req));
});

integrationsRouter.post('/webhooks', validateBody(createWebhookEndpointSchema), async (req, res) => {
  const created = await createWebhookEndpoint(req, req.body as CreateWebhookEndpointInput);
  res.setHeader('Cache-Control', 'no-store');
  res.status(created.replayed ? 200 : 201).json(created);
});

integrationsRouter.post('/webhooks/:id/enabled', validateBody(setWebhookEnabledSchema), async (req, res) => {
  res.json(await setWebhookEndpointEnabled(req, param(req, 'id'), req.body as SetWebhookEnabledInput));
});

integrationsRouter.post('/webhooks/:id/revoke', async (req, res) => {
  res.json(await revokeWebhookEndpoint(req, param(req, 'id')));
});

integrationsRouter.post('/webhooks/:id/test', async (req, res) => {
  res.status(202).json(await sendWebhookTest(req, param(req, 'id')));
});

integrationsRouter.get('/webhooks/:id/deliveries', validateQuery(webhookDeliveriesQuerySchema), async (req, res) => {
  res.json(await listWebhookDeliveries(req, param(req, 'id'), parsedQuery<WebhookDeliveriesQuery>(res)));
});

integrationsRouter.post('/webhook-deliveries/:id/retry', async (req, res) => {
  res.json(await retryWebhookDelivery(req, param(req, 'id')));
});
