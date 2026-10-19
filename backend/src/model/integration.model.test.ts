import { describe, expect, it } from 'vitest';
import { apiCredentialState, decodeCursor, encodeCursor, toExternalPlan } from './integration.model.js';

describe('F17 integration model', () => {
  const row = { revoked_at: null, expires_at: null, created_by: 'u1' };
  const admin = { role: 'admin', status: 'active' };

  it('derives credential state from revocation, expiry and the issuer', () => {
    expect(apiCredentialState(row, admin)).toBe('active');
    expect(apiCredentialState({ ...row, revoked_at: '2026-01-01T00:00:00Z' }, admin)).toBe('revoked');
    expect(apiCredentialState({ ...row, expires_at: '2020-01-01T00:00:00Z' }, admin)).toBe('expired');
    expect(apiCredentialState(row, { role: 'scheduler', status: 'active' })).toBe('issuer_inactive');
    expect(apiCredentialState(row, { role: 'owner', status: 'inactive' })).toBe('issuer_inactive');
    expect(apiCredentialState({ ...row, created_by: null }, admin)).toBe('issuer_inactive');
  });

  it('round-trips cursors and rejects tampered ones', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(decodeCursor(encodeCursor({ id, date: '2027-01-01T00:00:00Z' }), true)).toEqual({ id, date: '2027-01-01T00:00:00Z' });
    expect(decodeCursor(encodeCursor({ id }), true)).toBeNull();
    expect(decodeCursor(encodeCursor({ id: "x' or 1=1" }), false)).toBeNull();
    expect(decodeCursor('not-base64-json', false)).toBeNull();
  });

  it('maps plan JSON to the public shape only', () => {
    const plan = toExternalPlan({
      id: 'p1',
      title: 'Sunday',
      service_date: '2027-01-03T14:00:00Z',
      updated_at: '2027-01-01T00:00:00Z',
      notes: 'private',
      times: [{ id: 't', kind: 'rehearsal', name: null, starts_at: 'a', ends_at: 'b' }],
      items: [{ id: 'i', type: 'song', title: 'Song', position: 2, length_seconds: 240, song_id: 's', description: 'private' }],
    });
    expect(plan).not.toHaveProperty('notes');
    expect(plan?.items[0]).not.toHaveProperty('description');
    expect(plan?.times[0]?.kind).toBe('rehearsal');
    expect(toExternalPlan(null)).toBeNull();
  });
});
