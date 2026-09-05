import { Router } from 'express';
import { param } from '../lib/params.js';
import { inviteMemberSchema, updateMemberSchema, type PersonSummary } from '@service-center/shared';
import { validateBody } from '../lib/validate.js';
import { requireAdmin } from '../middleware/organization.js';
import { adminDb, raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';

export const peopleRouter: Router = Router();

/** Everyone in the active organization, with their role. */
peopleRouter.get('/', async (req, res) => {
  const rows = (await unwrap(
    raw(req.db)
      .from('organization_members')
      .select('role, status, profile:profiles(id, full_name, email, avatar_url, phone)')
      .eq('organization_id', req.orgId)
      .neq('status', 'inactive'),
  )) as unknown as Array<{ role: string; profile: Record<string, unknown> | null }>;

  const people: PersonSummary[] = rows
    .filter((r) => r.profile)
    .map((r) => ({ ...(r.profile as object), role: r.role } as PersonSummary))
    .sort((a, b) => (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? ''));

  res.json(people);
});

/**
 * Invites someone by email. Creating an auth user requires the service role,
 * so this is one of the few places we step outside RLS — the requireAdmin
 * guard above is what authorises it.
 */
peopleRouter.post(
  '/invitations',
  requireAdmin,
  validateBody(inviteMemberSchema),
  async (req, res) => {
    const { email, full_name, role } = req.body as {
      email: string;
      full_name?: string;
      role: string;
    };

    const existing = await unwrap(
      adminDb.from('profiles').select('id').eq('email', email).maybeSingle(),
    );

    let userId = existing?.id ?? null;
    let invited = false;

    if (!userId) {
      const { data, error } = await adminDb.auth.admin.inviteUserByEmail(email, {
        data: { full_name: full_name ?? null },
        redirectTo: `${config.APP_URL}/accept-invite`,
      });
      if (error || !data.user) {
        throw new HttpError(502, `Could not send the invitation: ${error?.message ?? 'unknown error'}`);
      }
      userId = data.user.id;
      invited = true;
    }

    const member = await unwrapOne(
      adminDb
        .from('organization_members')
        .upsert(
          { organization_id: req.orgId, user_id: userId, role: role as never, status: invited ? 'invited' : 'active' },
          { onConflict: 'organization_id,user_id' },
        )
        .select('*')
        .single(),
    );

    res.status(201).json({ member, invited });
  },
);

peopleRouter.patch('/:userId', requireAdmin, validateBody(updateMemberSchema), async (req, res) => {
  if (param(req, 'userId') === req.auth.userId && req.body.role && req.body.role !== req.orgRole) {
    throw HttpError.badRequest('You cannot change your own role');
  }

  const updated = await unwrap(
    req.db
      .from('organization_members')
      .update(req.body)
      .eq('organization_id', req.orgId)
      .eq('user_id', param(req, 'userId'))
      .select('*')
      .maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('That person is not in this organization');
  res.json(updated);
});

peopleRouter.delete('/:userId', requireAdmin, async (req, res) => {
  if (param(req, 'userId') === req.auth.userId) {
    throw HttpError.badRequest('You cannot remove yourself from the organization');
  }
  await unwrap(
    req.db
      .from('organization_members')
      .delete()
      .eq('organization_id', req.orgId)
      .eq('user_id', param(req, 'userId')),
  );
  res.status(204).end();
});
