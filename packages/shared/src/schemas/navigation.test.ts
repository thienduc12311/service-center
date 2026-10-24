import { describe, expect, it } from 'vitest';
import { parseExternalNavigationUrl, parsePushNavigationIntent } from './navigation.js';

const token = 'a'.repeat(43);
const organizationId = '11111111-1111-4111-8111-111111111111';
const planId = '22222222-2222-4222-8222-222222222222';
const notificationId = '33333333-3333-4333-8333-333333333333';
const policy = { schemes: ['servicecenter'], hosts: ['app.example.test'] };

describe('parseExternalNavigationUrl', () => {
  it('accepts configured HTTPS and custom-scheme public routes', () => {
    expect(
      parseExternalNavigationUrl(`https://app.example.test/respond?token=${token}`, policy),
    ).toEqual({
      status: 'accepted',
      intent: { kind: 'assignment-response', token },
    });
    expect(
      parseExternalNavigationUrl(`servicecenter://accept-invite?token=${token}`, policy),
    ).toEqual({
      status: 'accepted',
      intent: { kind: 'accept-invite', token },
    });
  });

  it('requires a valid organization and plan for private links', () => {
    expect(
      parseExternalNavigationUrl(
        `servicecenter://open/plan/${planId}?organization_id=${organizationId}`,
        policy,
      ),
    ).toMatchObject({
      status: 'accepted',
      intent: { kind: 'plan', organizationId, planId },
    });
    expect(
      parseExternalNavigationUrl(`servicecenter://open/plan/not-a-plan`, policy),
    ).toEqual({ status: 'rejected' });
  });

  it('accepts the rehearsal view of the same plan link (MOB-033) and nothing else under it', () => {
    const result = parseExternalNavigationUrl(
      `servicecenter://open/plan/${planId}/rehearse?organization_id=${organizationId}`,
      policy,
    );
    expect(result).toMatchObject({
      status: 'accepted',
      intent: { kind: 'plan', organizationId, planId, view: 'rehearse', intentId: `link:rehearse:${organizationId}:${planId}` },
    });
    const plain = parseExternalNavigationUrl(`servicecenter://open/plan/${planId}?organization_id=${organizationId}`, policy);
    expect(plain.status === 'accepted' && 'view' in plain.intent).toBe(false);
    expect(
      parseExternalNavigationUrl(`servicecenter://open/plan/${planId}/rehearse`, policy),
    ).toEqual({ status: 'rejected' });
    expect(
      parseExternalNavigationUrl(`servicecenter://open/plan/${planId}/edit?organization_id=${organizationId}`, policy),
    ).toEqual({ status: 'rejected' });
  });

  it('rejects unknown HTTPS hosts and routes, and ignores unrelated schemes', () => {
    expect(
      parseExternalNavigationUrl(`https://attacker.example/respond?token=${token}`, policy),
    ).toEqual({ status: 'rejected' });
    expect(
      parseExternalNavigationUrl(`servicecenter://chat/${planId}`, policy),
    ).toEqual({ status: 'rejected' });
    expect(parseExternalNavigationUrl('exp://127.0.0.1:8081', policy)).toEqual({
      status: 'ignored',
    });
  });
});

describe('parsePushNavigationIntent', () => {
  it('accepts the existing typed plan payload', () => {
    expect(
      parsePushNavigationIntent({
        notification_id: notificationId,
        type: 'plan_updated',
        organization_id: organizationId,
        plan_id: planId,
      }),
    ).toMatchObject({
      status: 'accepted',
      intent: { kind: 'plan', organizationId, planId, notificationId },
    });
  });

  it('rejects malformed IDs and invented targets', () => {
    expect(
      parsePushNavigationIntent({
        notification_id: notificationId,
        type: 'plan_updated',
        organization_id: 'wrong',
        plan_id: planId,
      }),
    ).toEqual({ status: 'rejected' });
    expect(
      parsePushNavigationIntent({
        notification_id: notificationId,
        type: 'plan_updated',
        organization_id: organizationId,
        plan_id: planId,
        chat_id: planId,
      }),
    ).toEqual({ status: 'rejected' });
  });
});
