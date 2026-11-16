import type {
  ChurchApplication,
  ChurchApplicationRow,
  SubmitChurchApplicationInput,
  UpdateChurchApplicationInput,
} from '@service-center/shared';
import { adminDb, raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';
import { mapChurchApplication } from '../model/platform-admin.model.js';
import { newChurchApplicationEmail } from './email/templates/church-application.js';
import { sendPlatformEmails } from './platform-email.js';

/**
 * The applicant's side of church applications. Everything runs as the caller:
 * RLS and column grants let them read their own applications and edit or
 * withdraw one only while it is pending.
 */

/** The signed-in applicant. */
export interface ApplicantCaller {
  /** RLS-scoped to the caller. */
  db: Db;
  userId: string;
}

type ApplicantApplicationRow = Omit<ChurchApplicationRow, 'reviewed_by'>;

/** The columns the applicant may read (`reviewed_by` is not granted). */
const APPLICANT_COLUMNS =
  'id, applicant_id, status, church_name, leader_name, contact_phone, website, address_line1, address_line2, ' +
  'city, state_province, postal_code, country, expected_member_count, timezone, note, rejection_reason, ' +
  'reviewed_at, organization_id, created_at, updated_at';

const notPending = (): HttpError =>
  new HttpError(409, 'This application was already decided or withdrawn', 'application_not_pending');

/** Newest first. */
export const listMyApplications = async (caller: ApplicantCaller): Promise<ChurchApplication[]> => {
  const rows = (await unwrap(
    raw(caller.db)
      .from('church_applications')
      .select(APPLICANT_COLUMNS)
      .eq('applicant_id', caller.userId)
      .order('created_at', { ascending: false }),
  )) as ApplicantApplicationRow[] | null;
  return (rows ?? []).map(mapChurchApplication);
};

/** Tells every super admin; a failed email never fails the application. */
const notifyPlatformAdmins = async (application: ChurchApplication, applicantId: string): Promise<void> => {
  const adminIds = ((await unwrap(raw(adminDb).rpc('platform_admin_user_ids'))) ?? []) as string[];
  const ids = [...new Set([...adminIds, applicantId])];
  const profiles = (await unwrap(adminDb.from('profiles').select('id, full_name, email').in('id', ids))) ?? [];
  const applicantName = profiles.find((profile) => profile.id === applicantId)?.full_name ?? null;
  const content = newChurchApplicationEmail({
    churchName: application.church_name,
    applicantName,
    city: application.city,
    country: application.country,
    reviewUrl: `${config.ADMIN_APP_URL}/applications/${application.id}`,
  });
  await sendPlatformEmails(
    profiles.flatMap((profile) => (adminIds.includes(profile.id) && profile.email ? [{ to: profile.email, ...content }] : [])),
  );
};

export const submitApplication = async (
  caller: ApplicantCaller,
  input: SubmitChurchApplicationInput,
): Promise<ChurchApplication> => {
  let row: ApplicantApplicationRow;
  try {
    row = (await unwrap(
      raw(caller.db).from('church_applications').insert(input).select(APPLICANT_COLUMNS).single(),
    )) as ApplicantApplicationRow;
  } catch (error) {
    // The one-pending-application index.
    if (error instanceof HttpError && error.status === 409 && error.code === 'conflict') {
      throw new HttpError(409, 'You already have an application waiting for review', 'application_pending');
    }
    throw error;
  }
  const application = mapChurchApplication(row);
  try {
    await notifyPlatformAdmins(application, caller.userId);
  } catch (error) {
    console.error(`[church-applications] notifying platform admins failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  return application;
};

/** Explains a pending-only update that matched nothing: gone (404) or decided (409). */
const refuseUpdate = async (caller: ApplicantCaller, applicationId: string): Promise<never> => {
  const existing = await unwrap(
    raw(caller.db).from('church_applications').select('status').eq('id', applicationId).maybeSingle(),
  );
  if (!existing) throw HttpError.notFound('Application not found');
  throw notPending();
};

export const updateMyApplication = async (
  caller: ApplicantCaller,
  applicationId: string,
  changes: UpdateChurchApplicationInput,
): Promise<ChurchApplication> => {
  const row = (await unwrap(
    raw(caller.db)
      .from('church_applications')
      .update(changes)
      .eq('id', applicationId)
      .eq('status', 'pending')
      .select(APPLICANT_COLUMNS)
      .maybeSingle(),
  )) as ApplicantApplicationRow | null;
  if (!row) return refuseUpdate(caller, applicationId);
  return mapChurchApplication(row);
};

export const withdrawMyApplication = async (caller: ApplicantCaller, applicationId: string): Promise<ChurchApplication> => {
  const row = (await unwrap(
    raw(caller.db)
      .from('church_applications')
      .update({ status: 'withdrawn' })
      .eq('id', applicationId)
      .eq('status', 'pending')
      .select(APPLICANT_COLUMNS)
      .maybeSingle(),
  )) as ApplicantApplicationRow | null;
  if (!row) return refuseUpdate(caller, applicationId);
  return mapChurchApplication(row);
};
