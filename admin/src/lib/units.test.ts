import { describe, expect, it } from 'vitest';
import { setOrganizationQuotaSchema } from '@service-center/shared';
import { bytesToMegabytes, megabytesFieldValue, megabytesToBytes, parseMegabytes, quotaBytesFromInput } from './units';

describe('megabyte conversion', () => {
  it('round-trips whole megabytes', () => {
    expect(megabytesToBytes(200)).toBe(209_715_200);
    expect(bytesToMegabytes(209_715_200)).toBe(200);
  });

  it('rounds fractional megabytes to whole bytes', () => {
    expect(megabytesToBytes(0.5)).toBe(524_288);
    expect(Number.isInteger(megabytesToBytes(1.333))).toBe(true);
  });

  it('formats a field value without noise', () => {
    expect(megabytesFieldValue(209_715_200)).toBe('200');
    expect(megabytesFieldValue(1_572_864)).toBe('1.5');
    expect(megabytesFieldValue(1_000_000)).toBe('0.95');
  });
});

describe('parseMegabytes', () => {
  it('accepts positive numbers', () => {
    expect(parseMegabytes('250')).toBe(250);
    expect(parseMegabytes(' 1.5 ')).toBe(1.5);
    expect(parseMegabytes('1,024')).toBe(1024);
  });

  it('rejects anything else', () => {
    expect(parseMegabytes('')).toBeNull();
    expect(parseMegabytes('0')).toBeNull();
    expect(parseMegabytes('-5')).toBeNull();
    expect(parseMegabytes('12mb')).toBeNull();
    expect(parseMegabytes('1e3')).toBeNull();
  });
});

describe('quotaBytesFromInput', () => {
  it('accepts sizes in range', () => {
    expect(quotaBytesFromInput('500')).toEqual({ ok: true, bytes: 524_288_000 });
    expect(quotaBytesFromInput('1')).toEqual({ ok: true, bytes: 1_048_576 });
  });

  it('explains what is wrong', () => {
    expect(quotaBytesFromInput('abc')).toMatchObject({ ok: false });
    expect(quotaBytesFromInput('0.5')).toEqual({ ok: false, message: 'The smallest quota is 1 MB.' });
    expect(quotaBytesFromInput('2000000')).toMatchObject({ ok: false });
  });

  it('stays inside the API schema', () => {
    for (const text of ['1', '200', '1048576']) {
      const result = quotaBytesFromInput(text);
      expect(result.ok).toBe(true);
      if (result.ok) expect(setOrganizationQuotaSchema.safeParse({ storage_quota_bytes: result.bytes }).success).toBe(true);
    }
  });
});
