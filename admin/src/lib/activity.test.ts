import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_LABELS, auditActionLabel, auditTargetLabel, summarizeAuditDetails } from './activity';

const MB = 1_048_576;

describe('auditActionLabel', () => {
  it('labels every known action', () => {
    for (const [action, label] of Object.entries(AUDIT_ACTION_LABELS)) {
      expect(auditActionLabel(action)).toBe(label);
    }
    expect(auditActionLabel('application.approved')).toBe('Approved application');
  });

  it('humanizes an unknown action', () => {
    expect(auditActionLabel('church.renamed')).toBe('Church renamed');
    expect(auditActionLabel('')).toBe('Unknown action');
  });
});

describe('summarizeAuditDetails', () => {
  it('shows the slug of a new church', () => {
    expect(summarizeAuditDetails({ action: 'church.created', details: { name: 'Grace', slug: 'grace', owner_id: 'u' } })).toBe('/grace');
    expect(summarizeAuditDetails({ action: 'application.approved', details: { slug: 'ns' } })).toBe('/ns');
  });

  it('summarizes disabling and enabling', () => {
    expect(
      summarizeAuditDetails({ action: 'church.disabled', details: { reason: 'Unpaid', memberships_changed: 4 } }),
    ).toBe('Reason: Unpaid · 4 memberships suspended');
    expect(summarizeAuditDetails({ action: 'church.enabled', details: { reason: 'Unpaid', memberships_changed: 1 } })).toBe(
      '1 membership restored',
    );
  });

  it('shows quota changes, with null as the platform default', () => {
    expect(summarizeAuditDetails({ action: 'church.quota_changed', details: { before: null, after: 500 * MB } })).toBe(
      'platform default → 500.0 MB',
    );
    expect(summarizeAuditDetails({ action: 'church.quota_changed', details: { before: 300 * MB, after: null } })).toBe(
      '300.0 MB → platform default',
    );
  });

  it('summarizes requests made inside a church', () => {
    expect(
      summarizeAuditDetails({ action: 'church.request', details: { method: 'POST', path: '/api/v1/plans', status: 201 } }),
    ).toBe('POST /api/v1/plans → 201');
  });

  it('lists edited fields and rejection reasons', () => {
    expect(summarizeAuditDetails({ action: 'application.edited', details: { fields: ['church_name', 'city'] } })).toBe(
      'Changed church name, city',
    );
    expect(
      summarizeAuditDetails({ action: 'application.rejected', details: { church_name: 'Hope', reason: 'Duplicate' } }),
    ).toBe('Hope · Reason: Duplicate');
  });

  it('describes settings changes', () => {
    expect(
      summarizeAuditDetails({
        action: 'settings.updated',
        details: {
          before: { default_storage_quota_bytes: 200 * MB, allow_self_serve_church_creation: false },
          after: { default_storage_quota_bytes: 500 * MB, allow_self_serve_church_creation: true },
        },
      }),
    ).toBe('Default quota 200.0 MB → 500.0 MB; Church creation without approval on');
  });

  it('includes access expiry times', () => {
    expect(summarizeAuditDetails({ action: 'church.access_granted', details: { expires_at: '2026-11-15T12:00:00Z' } })).toMatch(
      /^Until Nov 1[56], 2026/,
    );
    expect(summarizeAuditDetails({ action: 'church.access_revoked', details: {} })).toBe('');
  });

  it('tolerates missing or malformed details', () => {
    expect(summarizeAuditDetails({ action: 'church.disabled', details: {} })).toBe('');
    expect(summarizeAuditDetails({ action: 'settings.updated', details: { before: 'x' } })).toBe('');
    expect(summarizeAuditDetails({ action: 'church.created', details: { slug: 42 } })).toBe('');
  });

  it('shows plain values for unknown actions', () => {
    expect(summarizeAuditDetails({ action: 'church.renamed', details: { from: 'A', to: 'B', nested: { x: 1 } } })).toBe(
      'from: A · to: B',
    );
  });
});

describe('user and super-admin actions', () => {
  it('summarizes blocking, unblocking and deleting', () => {
    expect(
      summarizeAuditDetails({ action: 'user.blocked', details: { email: 'u@x.test', reason: 'Spam', sessions_ended: 2 } }),
    ).toBe('Reason: Spam · 2 sessions ended');
    expect(summarizeAuditDetails({ action: 'user.blocked', details: { reason: 'Spam', sessions_ended: 0 } })).toBe('Reason: Spam');
    expect(summarizeAuditDetails({ action: 'user.unblocked', details: { blocked_reason: 'Spam' } })).toBe('Was blocked for: Spam');
    expect(
      summarizeAuditDetails({ action: 'user.deleted', details: { deleted_organizations: [{ id: 'o1', name: 'Solo Church' }] } }),
    ).toBe('Also deleted Solo Church');
    expect(summarizeAuditDetails({ action: 'user.deleted', details: { deleted_organizations: [] } })).toBe('');
  });

  it('summarizes super-admin changes', () => {
    expect(summarizeAuditDetails({ action: 'admin.invited', details: { resent: true } })).toBe('Invitation renewed');
    expect(summarizeAuditDetails({ action: 'admin.granted', details: { email: 'a@x.test' } })).toBe('');
    expect(summarizeAuditDetails({ action: 'admin.revoked', details: { platform_access_removed: 1 } })).toBe(
      'Ended owner access to 1 church',
    );
    expect(summarizeAuditDetails({ action: 'admin.revoked', details: { platform_access_removed: 0 } })).toBe('');
  });
});

describe('auditTargetLabel', () => {
  const entry = { target_user_id: 'u1', target_name: null, target_email: null, details: {} };

  it('prefers the current name, then email, then the email the entry kept', () => {
    expect(auditTargetLabel({ ...entry, target_name: 'Uma', target_email: 'u@x.test' })).toBe('Uma');
    expect(auditTargetLabel({ ...entry, target_email: 'u@x.test' })).toBe('u@x.test');
    expect(auditTargetLabel({ ...entry, details: { email: 'gone@x.test' } })).toBe('gone@x.test');
    expect(auditTargetLabel(entry)).toBe('Deleted account');
  });

  it('labels an invitation to an address with no account, and nothing otherwise', () => {
    expect(auditTargetLabel({ ...entry, target_user_id: null, details: { email: 'new@x.test' } })).toBe('new@x.test');
    expect(auditTargetLabel({ ...entry, target_user_id: null })).toBeNull();
  });
});
