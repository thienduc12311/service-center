import { describe, expect, it } from 'vitest';
import { fromPostgrestError, upstreamLogEntry } from './errors.js';

describe('fromPostgrestError: upstream failures (W8-RES-D1)', () => {
  it.each([
    [{ code: 'PGRST301', message: 'JWT expired' }],
    [{ code: 'PGRST303', message: 'JWT issued at future' }],
    [{ code: 'PGRST302', message: 'Anonymous access is disabled' }],
    [{ code: '', message: 'JWT expired' }],
  ])('maps a rejected token to 401 unauthorized: %j', (error) => {
    expect(fromPostgrestError(error)).toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it.each([
    ['TypeError: fetch failed', 503, 'upstream_unavailable'],
    ['connect ECONNREFUSED 127.0.0.1:54321', 503, 'upstream_unavailable'],
    ['TimeoutError: The operation was aborted due to timeout', 504, 'upstream_timeout'],
    ['An invalid response was received from the upstream server', 502, 'upstream_error'],
  ])('maps the codeless failure %s to %i %s without echoing it', (message, status, code) => {
    const mapped = fromPostgrestError({ message });
    expect(mapped).toMatchObject({ status, code });
    expect(mapped.message).not.toContain(message);
  });

  it('maps a PostgREST connection failure to 503', () => {
    expect(fromPostgrestError({ code: 'PGRST002', message: 'schema cache unavailable' })).toMatchObject({ status: 503 });
  });

  it('hides the detail of an unmapped database error', () => {
    const mapped = fromPostgrestError({ code: 'XX000', message: 'secret internal detail', details: 'row data', hint: 'h' });
    expect(mapped).toMatchObject({ status: 500, code: 'internal_error', message: 'Internal server error' });
    expect(mapped.details).toBeUndefined();
  });

  it('maps a statement timeout (57014) to 504 upstream_timeout', () => {
    expect(fromPostgrestError({ code: '57014', message: 'canceling statement due to statement timeout' }))
      .toMatchObject({ status: 504, code: 'upstream_timeout' });
  });
});

describe('upstreamLogEntry: no personal data in the server log', () => {
  it('never keeps `details` (23502 failing row)', () => {
    const entry = upstreamLogEntry({
      code: '23502',
      message: 'null value in column "first_name" of relation "people" violates not-null constraint',
      details: 'Failing row contains (Ada, ada@example.test, +1 555 0100).',
      hint: null,
    });
    expect(entry).toEqual({
      code: '23502',
      message: 'null value in column "first_name" of relation "people" violates not-null constraint',
      hint: null,
    });
    expect(JSON.stringify(entry)).not.toMatch(/ada@example|555 0100/);
  });

  it('cuts key values from a 23505 message and keeps the hint', () => {
    const entry = upstreamLogEntry({
      code: '23505',
      message: 'duplicate key value violates unique constraint "people_email_key": Key (lower(email))=(ada@example.test) already exists.',
      details: 'Key (lower(email))=(ada@example.test) already exists.',
      hint: 'use another email',
    });
    expect(entry.message).toBe('duplicate key value violates unique constraint "people_email_key": Key (lower(email))=([redacted]) already exists.');
    expect(entry.hint).toBe('use another email');
    expect(JSON.stringify(entry)).not.toContain('ada@example.test');
  });

  it('cuts the quoted value from a class 22 message', () => {
    const entry = upstreamLogEntry({ code: '22003', message: 'value "0123456789012" is out of range for type integer' });
    expect(entry.message).toBe('value "[redacted]" is out of range for type integer');
  });

  it('cuts a failing row from the message too', () => {
    const entry = upstreamLogEntry({ code: '23514', message: 'Failing row contains (Ada, ada@example.test).' });
    expect(entry.message).toBe('Failing row contains ([redacted]).');
  });
});
