/**
 * Super-admin dashboard and church applications: API error codes and the
 * storage warning threshold shared by the API and every client.
 */

/** 413: the church is out of media storage. */
export const STORAGE_QUOTA_EXCEEDED = 'storage_quota_exceeded';
/** 403: self-serve church creation is off; apply instead. */
export const CHURCH_APPLICATION_REQUIRED = 'church_application_required';
/** 403: the church in X-Organization-Id was disabled by a super admin. */
export const ORGANIZATION_DISABLED = 'organization_disabled';
/** 403: platform-admin routes need a session that completed two-factor login. */
export const MFA_REQUIRED = 'mfa_required';

/** Church owners and admins see a warning once this much of the quota is used. */
export const STORAGE_QUOTA_WARNING_FRACTION = 0.8;

/** Used / quota, 0 when the quota is unknown. */
export const storageFractionUsed = (usedBytes: number, quotaBytes: number): number =>
  quotaBytes > 0 ? usedBytes / quotaBytes : 0;
