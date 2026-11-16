import { Router } from 'express';
import { getOrganizationStorage } from '../services/organization-platform.js';

/** `/api/v1/organization-storage`: the active church's media use against its quota. */
export const organizationStorageRouter: Router = Router();

organizationStorageRouter.get('/', async (req, res) => {
  res.json(await getOrganizationStorage(req.db, req.orgId));
});
