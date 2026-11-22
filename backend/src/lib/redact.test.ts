import { describe, expect, it } from 'vitest';
import { redactReferrer, redactTokenPath } from './redact.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl';

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
  it('matches token routes however the path is cased or percent-encoded (W10-SEC-D3)', () => {
    expect(redactTokenPath('/API/V1/INVITATIONS/Secret-Token')).toBe('/api/v1/invitations/[token]');
    expect(redactTokenPath('/api/v1/Invitations/Secret-Token/accept')).toBe('/api/v1/invitations/[token]/accept');
    expect(redactTokenPath('/API/V1/CALENDAR-FEED/scoped/Secret-Token.ics')).toBe('/api/v1/calendar-feed/scoped/[token].ics');
    expect(redactTokenPath('/api/v1/PUBLIC/plans/Secret-Slug?x=1')).toBe('/api/v1/public/plans/[token]');
    expect(redactTokenPath('/api/v1/invit%61tions/Secret-Token')).toBe('/api/v1/invitations/[token]');
    for (const url of ['/API/V1/INVITATIONS/Secret-Token', '/api/v1/invit%61tions/Secret-Token']) {
      expect(redactTokenPath(url)).not.toMatch(/secret-token/i);
    }
  });
  it('never logs a query string, whatever the route (W10-SEC-D3)', () => {
    expect(redactTokenPath(`/api/v1/me?access_token=${JWT}`)).toBe('/api/v1/me?[redacted]');
    expect(redactTokenPath('/api/v1/plans/123?x=1')).toBe('/api/v1/plans/123?[redacted]');
    expect(redactTokenPath('/api/v1/plans/123')).toBe('/api/v1/plans/123');
  });
  it('survives a malformed percent escape', () => {
    expect(redactTokenPath('/api/v1/plans/%E0%A4%A?token=x')).toBe('/api/v1/plans/%E0%A4%A?[redacted]');
  });
});

describe('redactReferrer', () => {
  it('keeps only the origin of the referring page (W10-SEC-D3)', () => {
    expect(redactReferrer('http://localhost:5180/respond?token=Secret-Token')).toBe('http://localhost:5180');
    expect(redactReferrer('https://app.example.test/invite/Secret-Token#x')).toBe('https://app.example.test');
  });
  it('hides a referrer that is not a URL and omits an absent one', () => {
    expect(redactReferrer('not a url Secret-Token')).toBe('[redacted]');
    expect(redactReferrer(undefined)).toBeUndefined();
  });
});
