import { describe, expect, it } from 'vitest';
import { redactTokenPath } from './redact.js';

describe('redactTokenPath', () => {
  it('removes response-link, invitation and feed tokens', () => {
    expect(redactTokenPath('/api/v1/assignment-responses/HJQkn-x_1/respond')).toBe('/api/v1/assignment-responses/[token]/respond');
    expect(redactTokenPath('/api/v1/assignment-responses/HJQkn-x_1')).toBe('/api/v1/assignment-responses/[token]');
    expect(redactTokenPath('/api/v1/invitations/abc?x=1')).toBe('/api/v1/invitations/[token]');
    expect(redactTokenPath('/api/v1/calendar-feed/secret.ics')).toBe('/api/v1/calendar-feed/[token].ics');
  });
  it('removes the token of a scoped team or service-type feed, not the word "scoped"', () => {
    expect(redactTokenPath('/api/v1/calendar-feed/scoped/s3cr3t-T0ken.ics')).toBe('/api/v1/calendar-feed/scoped/[token].ics');
    expect(redactTokenPath('/api/v1/calendar-feed/scoped/s3cr3t-T0ken.ics?v=2')).toBe('/api/v1/calendar-feed/scoped/[token].ics');
  });
  it('removes the slug of an unlisted public plan or set list', () => {
    expect(redactTokenPath('/api/v1/public/plans/abc123def456')).toBe('/api/v1/public/plans/[token]');
    expect(redactTokenPath('/api/v1/public/set-lists/abc123def456')).toBe('/api/v1/public/set-lists/[token]');
  });
  it('leaves other paths alone', () => {
    expect(redactTokenPath('/api/v1/plans/123?x=1')).toBe('/api/v1/plans/123?x=1');
  });
});
