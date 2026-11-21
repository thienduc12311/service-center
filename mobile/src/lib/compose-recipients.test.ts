import { describe, expect, it } from 'vitest';
import { messageRecipientsToSend, type MessageAudienceRecipient } from '@service-center/shared';
import {
  containsAll,
  filterHandoffCandidates,
  filterRecipients,
  includedRecipients,
  recipientName,
  recipientNamePreview,
  toggleableIds,
  withAll,
  withoutAll,
} from './compose-recipients';

const recipient = (person_id: string, first_name: string, last_name: string | null, overrides: Partial<MessageAudienceRecipient> = {}): MessageAudienceRecipient => ({
  person_id,
  first_name,
  last_name,
  reasons: ['team_member'],
  has_login: true,
  has_email: true,
  reachable: true,
  ...overrides,
});

const audience = [
  recipient('a', 'Ân', 'Đặng'),
  recipient('b', 'Ben', null, { reasons: ['signup'] }),
  recipient('c', 'Chris', 'Lee', { reachable: false }),
  recipient('d', 'Dana', 'Ng'),
];

describe('compose recipients', () => {
  it('names recipients and searches names and reasons without accents', () => {
    expect(recipientName(audience[0]!)).toBe('Ân Đặng');
    expect(filterRecipients(audience, 'an dang').map((r) => r.person_id)).toEqual(['a']);
    expect(filterRecipients(audience, 'sign', (reason) => (reason === 'signup' ? 'Signed up' : 'Team member')).map((r) => r.person_id)).toEqual(['b']);
    expect(filterRecipients(audience, '')).toHaveLength(4);
  });

  it('counts the same people the send will reach', () => {
    const preview = { audience_hash: 'h', recipients: audience };
    expect(includedRecipients(audience, ['d']).map((r) => r.person_id))
      .toEqual(messageRecipientsToSend(preview, ['d']).map((r) => r.person_id));
  });

  it('previews a few names and how many more', () => {
    expect(recipientNamePreview(audience, [], 2)).toEqual({ names: ['Ân Đặng', 'Ben'], more: 1 });
    expect(recipientNamePreview(audience, ['a', 'b', 'd'])).toEqual({ names: [], more: 0 });
  });

  it('bulk include/exclude touches only reachable shown people', () => {
    const shown = toggleableIds(audience);
    expect(shown).toEqual(['a', 'b', 'd']);
    expect(withAll(['x', 'a'], shown)).toEqual(['x', 'a', 'b', 'd']);
    expect(withoutAll(['x', 'a', 'b'], shown)).toEqual(['x']);
    expect(containsAll(['a', 'b', 'd', 'x'], shown)).toBe(true);
    expect(containsAll(['a'], shown)).toBe(false);
    expect(containsAll(['a'], [])).toBe(false);
  });

  it('searches handoff candidates by name or phone', () => {
    const candidates = [
      { person_id: 'a', name: 'Ân Đặng', phone: '+84901234567' },
      { person_id: 'b', name: 'Ben', phone: '5550100' },
    ];
    expect(filterHandoffCandidates(candidates, 'an').map((c) => c.person_id)).toEqual(['a']);
    expect(filterHandoffCandidates(candidates, '5550').map((c) => c.person_id)).toEqual(['b']);
  });
});
