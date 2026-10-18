import { describe, expect, it } from 'vitest';
import { runStaffingProposal, STAFFING_PROPOSAL_RULE_VERSION, type StaffingProposalRow, type StaffingProposalSnapshot } from '@service-center/shared';
import { canonicalJson, mapProposal, parseProposalRow, ProposalIntegrityError, storedResultMatches } from './staffing-proposal.model.js';

const snapshot: StaffingProposalSnapshot = {
  rule_version: STAFFING_PROPOSAL_RULE_VERSION, organization_id: 'org', time_zone: 'America/Toronto',
  captured_at: '2026-10-18T00:00:00.000Z', lookback_days: 90, team_ids: ['team'],
  plans: [{ id: 'plan', title: 'Sunday', service_date: '2026-11-01T14:00:00.000Z', local_date: '2026-11-01',
    service_type_id: null, staffing_revision: 3, needs: [{ team_id: 'team', position_id: 'pos', needed: 1 }] }],
  people: [{ id: 'ana', full_name: 'Ana' }], memberships: [{ person_id: 'ana', team_id: 'team', position_id: 'pos' }],
  assignments: [], unavailable: [], preferences: [], serving: [], rotations: [],
};
const edits = { locks: [], exclusions: [] };

const row = (overrides: Partial<StaffingProposalRow> = {}): StaffingProposalRow => ({
  id: 'proposal', organization_id: 'org', author_id: 'author', status: 'draft', revision: 0,
  rule_version: STAFFING_PROPOSAL_RULE_VERSION, seed: 'seed', lookback_days: 90, plan_ids: ['plan'], team_ids: ['team'],
  base_revisions: [], rotation_versions: [], snapshot, input_hash: 'a'.repeat(64), edits,
  result: runStaffingProposal({ snapshot, edits, seed: 'seed' }), expires_at: '2026-10-19T00:00:00.000Z',
  superseded_by: null, commit_key: null, committed_at: null, commit_result: null,
  created_at: '2026-10-18T00:00:00.000Z', updated_at: '2026-10-18T00:00:00.000Z', ...overrides,
});

describe('staffing proposal model', () => {
  it('canonical JSON ignores key order (jsonb reorders keys)', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });

  it('detects a stored result that does not match the engine output', () => {
    expect(storedResultMatches(parseProposalRow(row()))).toBe(true);
    const forged = row({ result: { ...runStaffingProposal({ snapshot, edits, seed: 'seed' }), choices: [] } });
    expect(storedResultMatches(parseProposalRow(forged))).toBe(false);
  });

  it('refuses malformed or other-version payloads', () => {
    expect(() => parseProposalRow(row({ snapshot: { plans: 'nope' } }))).toThrow(ProposalIntegrityError);
    expect(() => parseProposalRow(row({ rule_version: 'f06.fairness.v0' }))).toThrow(ProposalIntegrityError);
  });

  it('maps a proposal with expiry, plans and the visible policy', () => {
    const mapped = mapProposal(parseProposalRow(row()), { teams: { team: 'Band' }, positions: { pos: 'Drums' } }, new Date('2026-10-20T00:00:00Z'));
    expect(mapped.expired).toBe(true);
    expect(mapped.plans).toEqual([{ id: 'plan', title: 'Sunday', service_date: '2026-11-01T14:00:00.000Z', local_date: '2026-11-01', staffing_revision: 3 }]);
    expect(mapped.result.choices[0]).toMatchObject({ person_id: 'ana', source: 'fairness' });
    expect(mapped.policy.join(' ')).toContain('last 90 days');
  });
});
