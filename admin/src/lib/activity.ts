import { formatFileSize, type PlatformAuditAction, type PlatformAuditEntry } from '@service-center/shared';
import { formatDateTime } from './format';

export const AUDIT_ACTION_LABELS: Record<PlatformAuditAction, string> = {
  'church.created': 'Created church',
  'church.disabled': 'Disabled church',
  'church.enabled': 'Enabled church',
  'church.quota_changed': 'Changed storage quota',
  'church.access_granted': 'Entered church as owner',
  'church.access_extended': 'Extended owner access',
  'church.access_revoked': 'Exited church',
  'church.access_expired': 'Owner access expired',
  'church.request': 'Made a change inside church',
  'application.approved': 'Approved application',
  'application.rejected': 'Rejected application',
  'application.edited': 'Edited application',
  'settings.updated': 'Updated platform settings',
};

const isKnownAction = (action: string): action is PlatformAuditAction => Object.hasOwn(AUDIT_ACTION_LABELS, action);

/** A label for any action, including ones added after this app was built ("church.renamed" → "Church renamed"). */
export const auditActionLabel = (action: string): string => {
  if (isKnownAction(action)) return AUDIT_ACTION_LABELS[action];
  const words = action.replace(/[._]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown action';
};

/** The entry fields the summary reads. */
export type AuditSummaryInput = Pick<PlatformAuditEntry, 'action' | 'details'>;

type Details = Record<string, unknown>;

const text = (details: Details, key: string): string | null => {
  const value = details[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const number = (details: Details, key: string): number | null => {
  const value = details[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const bool = (details: Details, key: string): boolean | null => {
  const value = details[key];
  return typeof value === 'boolean' ? value : null;
};

const record = (details: Details, key: string): Details | null => {
  const value = details[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Details) : null;
};

const instant = (details: Details, key: string): string | null => {
  const value = text(details, key);
  return value && !Number.isNaN(Date.parse(value)) ? formatDateTime(value) : null;
};

const quotaLabel = (bytes: number | null): string => (bytes === null ? 'platform default' : formatFileSize(bytes));

const memberships = (count: number, verb: string): string =>
  `${count} ${count === 1 ? 'membership' : 'memberships'} ${verb}`;

/** Field names from `application.edited`, as words ("church_name" → "church name"). */
const fieldList = (details: Details): string | null => {
  const fields = details.fields;
  if (!Array.isArray(fields)) return null;
  const names = fields.filter((field): field is string => typeof field === 'string').map((field) => field.replace(/_/g, ' '));
  return names.length ? `Changed ${names.join(', ')}` : null;
};

const settingsChanges = (details: Details): string | null => {
  const before = record(details, 'before');
  const after = record(details, 'after');
  if (!before || !after) return null;
  const changes: string[] = [];
  const quotaBefore = number(before, 'default_storage_quota_bytes');
  const quotaAfter = number(after, 'default_storage_quota_bytes');
  if (quotaBefore !== quotaAfter && quotaAfter !== null) {
    changes.push(`Default quota ${quotaBefore === null ? '?' : formatFileSize(quotaBefore)} → ${formatFileSize(quotaAfter)}`);
  }
  const selfServeBefore = bool(before, 'allow_self_serve_church_creation');
  const selfServeAfter = bool(after, 'allow_self_serve_church_creation');
  if (selfServeBefore !== selfServeAfter && selfServeAfter !== null) {
    changes.push(`Church creation without approval ${selfServeAfter ? 'on' : 'off'}`);
  }
  return changes.length ? changes.join('; ') : 'No changes';
};

/** Up to three plain values, for actions this app doesn't know. */
const genericSummary = (details: Details): string =>
  Object.entries(details)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 3)
    .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value)}`)
    .join(' · ');

const joinParts = (parts: readonly (string | null)[]): string => parts.filter((part): part is string => !!part).join(' · ');

/** A one-line summary of an entry's details; empty when there is nothing to add. */
export const summarizeAuditDetails = ({ action, details }: AuditSummaryInput): string => {
  switch (action) {
    case 'church.created':
    case 'application.approved': {
      const slug = text(details, 'slug');
      return slug ? `/${slug}` : '';
    }
    case 'church.disabled': {
      const reason = text(details, 'reason');
      const count = number(details, 'memberships_changed');
      return joinParts([reason && `Reason: ${reason}`, count === null ? null : memberships(count, 'suspended')]);
    }
    case 'church.enabled': {
      const count = number(details, 'memberships_changed');
      return count === null ? '' : memberships(count, 'restored');
    }
    case 'church.quota_changed': {
      if (!('before' in details) && !('after' in details)) return '';
      return `${quotaLabel(number(details, 'before'))} → ${quotaLabel(number(details, 'after'))}`;
    }
    case 'church.access_granted':
    case 'church.access_extended': {
      const until = instant(details, 'expires_at');
      return until ? `Until ${until}` : '';
    }
    case 'church.access_expired': {
      const at = instant(details, 'expired_at');
      return at ? `Expired ${at}` : '';
    }
    case 'church.access_revoked':
      return '';
    case 'church.request': {
      const method = text(details, 'method');
      const path = text(details, 'path');
      const status = number(details, 'status');
      if (!method && !path) return '';
      return `${[method, path].filter(Boolean).join(' ')}${status === null ? '' : ` → ${status}`}`;
    }
    case 'application.rejected': {
      const reason = text(details, 'reason');
      return joinParts([text(details, 'church_name'), reason && `Reason: ${reason}`]);
    }
    case 'application.edited':
      return fieldList(details) ?? '';
    case 'settings.updated':
      return settingsChanges(details) ?? '';
    default:
      return genericSummary(details);
  }
};
