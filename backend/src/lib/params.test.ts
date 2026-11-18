import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { isUuid, param } from './params.js';

const request = (params: Record<string, string>): Request => ({ params } as unknown as Request);

/** API-D5 / W2-*-D4/D5: malformed ids are a 400, never a raw Postgres 22P02. */
describe('param', () => {
  it('rejects malformed ids before they reach Postgres', () => {
    for (const [name, value] of [['id', 'abc'], ['planId', 'not-a-uuid'], ['itemId', 'zzz'], ['proposalId', '1']]) {
      expect(() => param(request({ [name!]: value! }), name!)).toThrow(expect.objectContaining({ status: 400 }));
    }
  });

  it('passes uuids and non-id parameters through', () => {
    expect(param(request({ id: 'aaaaaaaa-0000-4000-8000-000000000001' }), 'id')).toBe('aaaaaaaa-0000-4000-8000-000000000001');
    expect(param(request({ token: 'opaque-token' }), 'token')).toBe('opaque-token');
    expect(param(request({ slug: 'easter-2027' }), 'slug')).toBe('easter-2027');
  });

  it('still requires the parameter', () => {
    expect(() => param(request({}), 'id')).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('recognises uuid literals only', () => {
    expect(isUuid('AAAAAAAA-0000-4000-8000-000000000001')).toBe(true);
    expect(isUuid('aaaaaaaa00004000800000000000000001')).toBe(false);
    expect(isUuid("x' or 1=1 --")).toBe(false);
  });
});
