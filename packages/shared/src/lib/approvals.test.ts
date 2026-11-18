import { describe, expect, it } from 'vitest';
import { isOwnApproval, mayApproveAsLeader } from './approvals.js';

describe('leader approval gating (W2-RESP-D2)', () => {
  it('never offers Approve to a beneficiary', () => {
    expect(isOwnApproval({ beneficiaryPersonIds: ['p1'] }, 'p1')).toBe(true);
    expect(isOwnApproval({ beneficiaryPersonIds: ['p1', 'p2'] }, 'p2')).toBe(true);
    expect(mayApproveAsLeader({ beneficiaryPersonIds: ['p1'] }, 'p1', true)).toBe(false);
  });

  it('offers Approve to an independent leader only', () => {
    expect(mayApproveAsLeader({ beneficiaryPersonIds: ['p1'] }, 'p2', true)).toBe(true);
    expect(mayApproveAsLeader({ beneficiaryPersonIds: ['p1'] }, 'p2', false)).toBe(false);
    // An unknown caller Person is not a beneficiary; the server still decides.
    expect(mayApproveAsLeader({ beneficiaryPersonIds: ['p1', null] }, null, true)).toBe(true);
  });
});
