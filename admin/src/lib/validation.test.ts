import { describe, expect, it } from 'vitest';
import { adminCreateChurchSchema } from '@service-center/shared';
import { fieldErrorsFrom } from './validation';

describe('fieldErrorsFrom', () => {
  it('keeps the first message per field', () => {
    expect(
      fieldErrorsFrom([
        { path: ['slug'], message: 'First' },
        { path: ['slug'], message: 'Second' },
        { path: [], message: 'Form' },
      ]),
    ).toEqual({ slug: 'First', '': 'Form' });
  });

  it('reads a shared schema result', () => {
    const result = adminCreateChurchSchema.safeParse({ name: 'Grace', slug: 'G!', timezone: 'Mars/Base', owner_email: 'x' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = fieldErrorsFrom(result.error.issues);
    expect(Object.keys(errors).sort()).toEqual(['owner_email', 'slug', 'timezone']);
  });
});
