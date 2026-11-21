import { describe, expect, it } from 'vitest';
import { optionalSecret } from './optional-secret.js';

const rule = { name: 'CRON_SECRET', isValid: (value: string) => value.length >= 16, requirement: 'at least 16 characters' };

const parse = (value: string | undefined): { result: string | undefined; warnings: string[] } => {
  const warnings: string[] = [];
  const result = optionalSecret(rule, (message) => warnings.push(message)).parse(value);
  return { result, warnings };
};

describe('optionalSecret', () => {
  it('treats a missing value as unset, silently', () => {
    expect(parse(undefined)).toEqual({ result: undefined, warnings: [] });
  });

  it('treats an empty value as unset, silently', () => {
    expect(parse('')).toEqual({ result: undefined, warnings: [] });
  });

  it('ignores an invalid value with a warning that never contains it', () => {
    const { result, warnings } = parse('too-short');
    expect(result).toBeUndefined();
    expect(warnings).toEqual(['[config] CRON_SECRET ignored: must be at least 16 characters. Features that need it stay off.']);
    expect(warnings.join()).not.toContain('too-short');
  });

  it('keeps a valid value', () => {
    expect(parse('a-long-enough-cron-secret')).toEqual({ result: 'a-long-enough-cron-secret', warnings: [] });
  });
});
