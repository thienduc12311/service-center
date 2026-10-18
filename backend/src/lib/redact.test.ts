import { describe, expect, it } from 'vitest';
import { redactTokenPath } from './redact.js';

describe('redactTokenPath', () => {
  it('removes response-link, invitation and feed tokens', () => {
    expect(redactTokenPath('/api/v1/assignment-responses/HJQkn-x_1/respond')).toBe('/api/v1/assignment-responses/[token]/respond');
    expect(redactTokenPath('/api/v1/assignment-responses/HJQkn-x_1')).toBe('/api/v1/assignment-responses/[token]');
    expect(redactTokenPath('/api/v1/invitations/abc?x=1')).toBe('/api/v1/invitations/[token]');
    expect(redactTokenPath('/api/v1/calendar-feed/secret.ics')).toBe('/api/v1/calendar-feed/[token].ics');
  });
  it('leaves other paths alone', () => {
    expect(redactTokenPath('/api/v1/plans/123?x=1')).toBe('/api/v1/plans/123?x=1');
  });
});
