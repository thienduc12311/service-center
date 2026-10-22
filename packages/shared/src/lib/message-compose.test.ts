import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client.js';
import {
  keptExclusions,
  messageAudience,
  messageAudienceKey,
  messageAudienceProblem,
  messageRecipientsToSend,
  messageSendBody,
  messageSendOutcome,
  messageVariablesFor,
  normalizeTextPhone,
  textComposerUrl,
  textHandoffBody,
  textHandoffRecipients,
} from './message-compose.js';
import { messageAudienceSchema, sendOperationalMessageSchema } from '../schemas/collaboration.js';
import type { MessageAudiencePreview, MessageAudienceRecipient } from '../types/collaboration.js';

const PLAN = '00000000-0000-4000-8000-000000000001';
const TEAM = '00000000-0000-4000-8000-000000000002';
const SAM = '00000000-0000-4000-8000-0000000000a1';
const RILEY = '00000000-0000-4000-8000-0000000000a2';
const GUEST = '00000000-0000-4000-8000-0000000000a3';

const recipient = (person_id: string, first_name: string, overrides: Partial<MessageAudienceRecipient> = {}): MessageAudienceRecipient => ({
  person_id,
  first_name,
  last_name: null,
  reasons: ['scheduled_confirmed'],
  has_login: true,
  has_email: true,
  reachable: true,
  ...overrides,
});

const preview: MessageAudiencePreview = {
  audience_hash: 'a'.repeat(32),
  recipients: [
    recipient(SAM, 'Sam', { last_name: 'Rivera' }),
    recipient(RILEY, 'Riley'),
    recipient(GUEST, 'Guest', { has_login: false, has_email: false, reachable: false }),
  ],
};

describe('message audience selection', () => {
  it('reports the same problems the shared schema refuses', () => {
    const cases = [
      messageAudience(PLAN, [], []),
      messageAudience(PLAN, ['team_members'], []),
      messageAudience(null, ['scheduled_pending'], [TEAM]),
      messageAudience(PLAN, ['scheduled_confirmed'], []),
      messageAudience(null, ['team_members'], [TEAM]),
    ];
    expect(cases.map(messageAudienceProblem)).toEqual(['groups_required', 'teams_required', 'plan_required', null, null]);
    for (const audience of cases) {
      expect(messageAudienceSchema.safeParse(audience).success).toBe(messageAudienceProblem(audience) === null);
    }
  });

  it('compares selections regardless of toggle order', () => {
    expect(messageAudienceKey(messageAudience(PLAN, ['scheduled_pending', 'scheduled_confirmed'], [TEAM, PLAN])))
      .toBe(messageAudienceKey(messageAudience(PLAN, ['scheduled_confirmed', 'scheduled_pending'], [PLAN, TEAM])));
    expect(messageAudienceKey(messageAudience(PLAN, ['scheduled_confirmed'], [])))
      .not.toBe(messageAudienceKey(messageAudience(PLAN, ['scheduled_pending'], [])));
  });

  it('sends to reachable people the sender kept, and offers plan variables only on a plan', () => {
    expect(messageRecipientsToSend(preview, [RILEY]).map((r) => r.first_name)).toEqual(['Sam']);
    expect(messageRecipientsToSend(null, [])).toEqual([]);
    expect(messageVariablesFor(false)).not.toContain('plan_title');
    expect(messageVariablesFor(true)).toContain('plan_date');
  });
});

describe('message send body', () => {
  it('carries the reviewed hash and key, and only exclusions still in the preview', () => {
    const body = messageSendBody({
      audience: messageAudience(PLAN, ['scheduled_confirmed'], []),
      subject: 'Call time',
      body: 'Hi {{first_name}}',
      templateId: null,
      excluded: [RILEY, '00000000-0000-4000-8000-0000000000ff'],
      preview,
      idempotencyKey: 'message-key-1',
    });
    expect(body.audience_hash).toBe(preview.audience_hash);
    expect(body.idempotency_key).toBe('message-key-1');
    expect(body.excluded_person_ids).toEqual([RILEY]);
    expect(sendOperationalMessageSchema.safeParse(body).success).toBe(true);
    expect(keptExclusions({ ...preview, recipients: [] }, [RILEY])).toEqual([]);
  });

  it('classifies refusals: changed audience, lost answer, reused key, anything else', () => {
    expect(messageSendOutcome(new ApiError(409, 'changed', 'audience_changed'))).toBe('audienceChanged');
    expect(messageSendOutcome(new ApiError(409, 'reused', 'idempotency_key_reused'))).toBe('keyReused');
    expect(messageSendOutcome(new ApiError(503, 'down'))).toBe('uncertain');
    expect(messageSendOutcome(new TypeError('Network request failed'))).toBe('uncertain');
    expect(messageSendOutcome(new ApiError(403, 'Only schedulers and team leaders can send messages'))).toBe('refused');
    expect(messageSendOutcome(new ApiError(422, 'Unknown variable'))).toBe('refused');
  });
});

describe('device text handoff', () => {
  it('uses only phone numbers the People list disclosed', () => {
    const people = [
      { person_id: SAM, phone: ' +1 (555) 010-2000 ' },
      { person_id: RILEY, phone: null },
      { person_id: null, phone: '5550100' },
    ];
    expect(textHandoffRecipients(preview.recipients, people)).toEqual([
      { person_id: SAM, name: 'Sam Rivera', phone: '+15550102000' },
      { person_id: RILEY, name: 'Riley', phone: null },
      { person_id: GUEST, name: 'Guest', phone: null },
    ]);
    expect(normalizeTextPhone('12')).toBeNull();
    expect(normalizeTextPhone('555-0100')).toBe('5550100');
  });

  it('fills shared variables, and recipient variables only for one person', () => {
    const snapshot = { plan_title: 'Sunday', sender_name: 'Jordan', organization_name: 'Riverside' };
    expect(textHandoffBody('Hi {{ first_name }}, {{plan_title}}', snapshot, [recipient(SAM, 'Sam')]))
      .toEqual({ ok: true, text: 'Hi Sam, Sunday' });
    expect(textHandoffBody('Hi {{first_name}} {{full_name}}', snapshot, [recipient(SAM, 'Sam'), recipient(RILEY, 'Riley')]))
      .toEqual({ ok: false, personalVariables: ['first_name', 'full_name'] });
    expect(textHandoffBody('{{plan_title}} from {{sender_name}}', snapshot, [recipient(SAM, 'Sam'), recipient(RILEY, 'Riley')]))
      .toEqual({ ok: true, text: 'Sunday from Jordan' });
  });

  it('keeps substituted values as text and encodes them into the link', () => {
    const result = textHandoffBody('{{first_name}} & co?', {}, [recipient(SAM, '<b>{{sender_name}}</b>&body=x')]);
    expect(result).toEqual({ ok: true, text: '<b>{{sender_name}}</b>&body=x & co?' });
    const text = result.ok ? result.text : '';
    const ios = textComposerUrl(['+15550102000'], text, 'ios');
    expect(ios.startsWith('sms:+15550102000&body=')).toBe(true);
    expect(decodeURIComponent(ios.slice(ios.indexOf('&body=') + 6))).toBe(text);
    expect(ios.split('&body=')).toHaveLength(2);
    expect(textComposerUrl(['1', '2'], 'hi', 'ios')).toBe('sms:/open?addresses=1,2&body=hi');
    expect(textComposerUrl(['1', '2'], 'a b', 'android')).toBe('sms:1,2?body=a%20b');
  });
});
