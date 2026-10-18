import { describe, expect, it } from 'vitest';
import {
  messageVariableValues,
  renderMessageTemplate,
  unknownMessageVariables,
} from './message-templates.js';
import { messageAudienceSchema, savePlanNoteSchema, sendOperationalMessageSchema } from '../schemas/collaboration.js';

describe('message template variables', () => {
  it('reports only variables outside the allowlist, once each', () => {
    expect(unknownMessageVariables('Hi {{ first_name }}, {{password}} and {{password}} {{ }}')).toEqual(['password', '']);
    expect(unknownMessageVariables('Hi {{first_name}} — {{plan_title}}')).toEqual([]);
  });

  it('substitutes values as plain text and leaves unknown variables untouched', () => {
    const values = messageVariableValues(
      { first_name: '<b>Sam</b>', last_name: 'Rivera' },
      { organization_name: 'Riverside', plan_title: 'Sunday', plan_date: '2026-10-25T14:00:00Z', organization_timezone: 'America/Toronto', sender_name: 'Jordan' },
    );
    expect(renderMessageTemplate('{{first_name}} / {{full_name}} / {{plan_date}} / {{nope}}', values))
      .toBe('<b>Sam</b> / <b>Sam</b> Rivera / Sun, Oct 25, 2026 / {{nope}}');
  });

  it('does not re-expand variables that appear inside substituted values', () => {
    const values = messageVariableValues({ first_name: '{{sender_name}}', last_name: null }, { sender_name: 'Jordan' });
    expect(renderMessageTemplate('Hi {{first_name}}', values)).toBe('Hi {{sender_name}}');
  });
});

describe('collaboration schemas', () => {
  it('requires teams for a team note', () => {
    expect(savePlanNoteSchema.safeParse({ audience: 'teams', body: 'x' }).success).toBe(false);
    expect(savePlanNoteSchema.safeParse({ audience: 'teams', team_ids: ['00000000-0000-4000-8000-000000000001'], body: 'x' }).success).toBe(true);
  });

  it('requires a plan for scheduled audiences and teams for team members', () => {
    expect(messageAudienceSchema.safeParse({ include: ['scheduled_pending'] }).success).toBe(false);
    expect(messageAudienceSchema.safeParse({ include: ['team_members'] }).success).toBe(false);
    expect(messageAudienceSchema.safeParse({ include: ['team_members'], team_ids: ['00000000-0000-4000-8000-000000000001'] }).success).toBe(true);
  });

  it('refuses unknown variables before anything is sent', () => {
    const result = sendOperationalMessageSchema.safeParse({
      audience: { plan_id: '00000000-0000-4000-8000-000000000001', include: ['scheduled_confirmed'] },
      subject: 'Hi {{first_name}}',
      body: 'Your code is {{password}}',
      audience_hash: '0'.repeat(32),
      idempotency_key: 'message-key-1',
    });
    expect(result.success).toBe(false);
  });
});
