import { describe, expect, it } from 'vitest';
import { AVATAR_MAX_BYTES, avatarFileProblem, avatarObjectPath } from './avatars.js';

describe('avatarObjectPath', () => {
  it('puts your own picture under your login', () => {
    expect(avatarObjectPath({ kind: 'self', userId: 'u1' }, 'f1', 'image/jpeg')).toBe('users/u1/f1.jpg');
  });

  it('puts a Person picture under their organization', () => {
    expect(avatarObjectPath({ kind: 'person', organizationId: 'o1', personId: 'p1' }, 'f1', 'image/webp')).toBe(
      'orgs/o1/people/p1/f1.webp',
    );
  });
});

describe('avatarFileProblem', () => {
  it('accepts the bucket image types within the size limit', () => {
    expect(avatarFileProblem('image/png', 1024)).toBeNull();
    expect(avatarFileProblem('image/jpeg', null)).toBeNull();
  });

  it('refuses other types and oversized files', () => {
    expect(avatarFileProblem('image/gif', 10)).toBe('unsupported_type');
    expect(avatarFileProblem('image/svg+xml', 10)).toBe('unsupported_type');
    expect(avatarFileProblem(undefined, 10)).toBe('unsupported_type');
    expect(avatarFileProblem('image/png', AVATAR_MAX_BYTES + 1)).toBe('too_large');
  });
});
