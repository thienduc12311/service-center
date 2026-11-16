import { Router, type Request } from 'express';
import {
  adminActivityQuerySchema,
  adminChurchApplicationsQuerySchema,
  adminCreateChurchSchema,
  adminOrganizationParamsSchema,
  approveChurchApplicationSchema,
  churchApplicationParamsSchema,
  disableOrganizationSchema,
  enterOrganizationSchema,
  rejectChurchApplicationSchema,
  setOrganizationQuotaSchema,
  updateChurchApplicationSchema,
  updatePlatformSettingsSchema,
  type AdminActivityQuery,
  type AdminChurchApplicationsQuery,
  type AdminCreateChurchInput,
  type AdminSession,
  type ApproveChurchApplicationInput,
  type DisableOrganizationInput,
  type EnterOrganizationInput,
  type RejectChurchApplicationInput,
  type SetOrganizationQuotaInput,
  type UpdateChurchApplicationInput,
  type UpdatePlatformSettingsInput,
} from '@service-center/shared';
import {
  adminUserParamsSchema,
  blockUserSchema,
  deleteUserSchema,
  invitePlatformAdminSchema,
  platformAdminInvitationParamsSchema,
  type BlockUserInput,
  type DeleteUserInput,
  type InvitePlatformAdminInput,
} from '@service-center/shared';
import { parseOrThrow, parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requirePlatformAdmin } from '../middleware/platform-admin.js';
import {
  approveApplication,
  createChurch,
  getAdminApplication,
  getOrganizationDetail,
  getOverview,
  getSettings,
  grantPlatformAccess,
  listActivity,
  listApplications,
  listOrganizationSummaries,
  rejectApplication,
  revokePlatformAccess,
  setOrganizationQuota,
  setOrganizationStatus,
  updateApplication,
  updateSettings,
  type PlatformActor,
} from '../services/platform-admin.js';
import {
  acceptPlatformAdminInvitation,
  blockUser,
  deleteUser,
  getMyPlatformAdminInvitation,
  getUserDetail,
  invitePlatformAdmin,
  listPlatformAdmins,
  listUsers,
  revokePlatformAdmin,
  revokePlatformAdminInvitation,
  unblockUser,
} from '../services/platform-users.js';

/**
 * `/api/v1/admin`: the super-admin dashboard (admin.graceaogchurch.com).
 * Mounted behind `requireAuth`. `GET /session` only needs a super admin; every
 * other route also needs a two-factor session.
 */
export const adminRouter: Router = Router();

const actor = (req: Request): PlatformActor => ({ userId: req.auth.userId });
const organizationId = (req: Request): string => parseOrThrow(adminOrganizationParamsSchema, req.params).id;
const applicationId = (req: Request): string => parseOrThrow(churchApplicationParamsSchema, req.params).id;
const userId = (req: Request): string => parseOrThrow(adminUserParamsSchema, req.params).id;
const invitationId = (req: Request): string => parseOrThrow(platformAdminInvitationParamsSchema, req.params).id;

adminRouter.get('/session', requirePlatformAdmin({ allowWithoutMfa: true }), (req, res) => {
  const aal = req.platformAdmin?.aal ?? 'aal1';
  const session: AdminSession = {
    user_id: req.auth.userId,
    email: req.auth.email,
    aal,
    mfa_required: aal !== 'aal2',
  };
  res.json(session);
});

// The invitee's side: any signed-in account, not yet a super admin.
adminRouter.get('/invitation', async (req, res) => {
  res.json(await getMyPlatformAdminInvitation(req.auth.userId));
});

adminRouter.post('/invitation/:id/accept', async (req, res) => {
  await acceptPlatformAdminInvitation(req.auth.userId, invitationId(req));
  res.status(204).end();
});

adminRouter.use(requirePlatformAdmin());

adminRouter.get('/overview', async (_req, res) => {
  res.json(await getOverview());
});

// ------------------------------------------------------------ churches -----

adminRouter.get('/organizations', async (_req, res) => {
  res.json(await listOrganizationSummaries());
});

adminRouter.post('/organizations', validateBody(adminCreateChurchSchema), async (req, res) => {
  res.status(201).json(await createChurch(actor(req), req.body as AdminCreateChurchInput));
});

adminRouter.get('/organizations/:id', async (req, res) => {
  res.json(await getOrganizationDetail(actor(req), organizationId(req)));
});

adminRouter.put('/organizations/:id/quota', validateBody(setOrganizationQuotaSchema), async (req, res) => {
  const { storage_quota_bytes } = req.body as SetOrganizationQuotaInput;
  res.json(await setOrganizationQuota(actor(req), organizationId(req), storage_quota_bytes));
});

adminRouter.post('/organizations/:id/disable', validateBody(disableOrganizationSchema), async (req, res) => {
  const { reason } = req.body as DisableOrganizationInput;
  res.json(await setOrganizationStatus(actor(req), organizationId(req), { status: 'disabled', reason }));
});

adminRouter.post('/organizations/:id/enable', async (req, res) => {
  res.json(await setOrganizationStatus(actor(req), organizationId(req), { status: 'active' }));
});

/** Enter the church as a temporary owner; then open it in the main app. */
adminRouter.post('/organizations/:id/access', validateBody(enterOrganizationSchema), async (req, res) => {
  const { hours } = req.body as EnterOrganizationInput;
  res.json(await grantPlatformAccess(actor(req), organizationId(req), hours));
});

adminRouter.delete('/organizations/:id/access', async (req, res) => {
  await revokePlatformAccess(actor(req), organizationId(req));
  res.status(204).end();
});

// -------------------------------------------------------- applications -----

adminRouter.get('/church-applications', validateQuery(adminChurchApplicationsQuerySchema), async (_req, res) => {
  const { status } = parsedQuery<AdminChurchApplicationsQuery>(res);
  res.json(await listApplications(status));
});

/** One application (the target of the links in admin emails). */
adminRouter.get('/church-applications/:id', async (req, res) => {
  res.json(await getAdminApplication(applicationId(req)));
});

adminRouter.patch('/church-applications/:id', validateBody(updateChurchApplicationSchema), async (req, res) => {
  res.json(await updateApplication(actor(req), applicationId(req), req.body as UpdateChurchApplicationInput));
});

adminRouter.post('/church-applications/:id/approve', validateBody(approveChurchApplicationSchema), async (req, res) => {
  const { slug } = req.body as ApproveChurchApplicationInput;
  res.json(await approveApplication(actor(req), applicationId(req), slug));
});

adminRouter.post('/church-applications/:id/reject', validateBody(rejectChurchApplicationSchema), async (req, res) => {
  const { reason } = req.body as RejectChurchApplicationInput;
  res.json(await rejectApplication(actor(req), applicationId(req), reason));
});

// --------------------------------------------------------------- users -----

adminRouter.get('/users', async (_req, res) => {
  res.json(await listUsers());
});

adminRouter.get('/users/:id', async (req, res) => {
  res.json(await getUserDetail(actor(req), userId(req)));
});

adminRouter.post('/users/:id/block', validateBody(blockUserSchema), async (req, res) => {
  const { reason } = req.body as BlockUserInput;
  res.json(await blockUser(actor(req), userId(req), reason));
});

adminRouter.post('/users/:id/unblock', async (req, res) => {
  await unblockUser(actor(req), userId(req));
  res.status(204).end();
});

adminRouter.delete('/users/:id', validateBody(deleteUserSchema), async (req, res) => {
  const { confirm_email } = req.body as DeleteUserInput;
  res.json(await deleteUser(actor(req), userId(req), confirm_email));
});

// -------------------------------------------------------- super admins -----

adminRouter.get('/admins', async (_req, res) => {
  res.json(await listPlatformAdmins());
});

adminRouter.post('/admins/invitations', validateBody(invitePlatformAdminSchema), async (req, res) => {
  res.status(201).json(await invitePlatformAdmin(actor(req), req.body as InvitePlatformAdminInput));
});

adminRouter.delete('/admins/invitations/:id', async (req, res) => {
  await revokePlatformAdminInvitation(actor(req), invitationId(req));
  res.status(204).end();
});

adminRouter.delete('/admins/:id', async (req, res) => {
  await revokePlatformAdmin(actor(req), userId(req));
  res.status(204).end();
});

// ------------------------------------------------------ settings, log ------

adminRouter.get('/settings', async (_req, res) => {
  res.json(await getSettings());
});

adminRouter.patch('/settings', validateBody(updatePlatformSettingsSchema), async (req, res) => {
  res.json(await updateSettings(actor(req), req.body as UpdatePlatformSettingsInput));
});

adminRouter.get('/activity', validateQuery(adminActivityQuerySchema), async (_req, res) => {
  res.json(await listActivity(parsedQuery<AdminActivityQuery>(res)));
});
