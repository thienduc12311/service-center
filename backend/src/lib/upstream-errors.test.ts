import { describe, expect, it } from 'vitest';
import { fromPostgrestError } from './errors.js';

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
});
