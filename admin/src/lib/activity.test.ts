import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_LABELS, auditActionLabel, summarizeAuditDetails } from './activity';

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
