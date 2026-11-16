import { describe, expect, it } from 'vitest';
import { adminCreateChurchSchema } from '@service-center/shared';
import { createChurchRequestFrom, emptyCreateChurchDraft } from './create-church';

describe('createChurchRequestFrom', () => {
  it('builds a valid request with blanks as null', () => {
    const request = createChurchRequestFrom({
      ...emptyCreateChurchDraft('America/New_York'),
      name: ' Grace Church ',
      slug: 'grace',
      owner_email: 'Pastor@Grace.org ',
      city: 'Atlanta',
      member_count: '120',
    });
    expect(request).toMatchObject({ name: 'Grace Church', city: 'Atlanta', country: null, member_count: 120 });
    const parsed = adminCreateChurchSchema.safeParse(request);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.owner_email).toBe('pastor@grace.org');
  });

  it('lets the schema reject a bad member count', () => {
    const request = createChurchRequestFrom({ ...emptyCreateChurchDraft('UTC'), name: 'A', slug: 'ab', owner_email: 'a@b.co', member_count: '1.5' });
    expect(adminCreateChurchSchema.safeParse(request).success).toBe(false);
  });
});
