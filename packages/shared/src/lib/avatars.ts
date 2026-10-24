/**
 * Profile pictures in the public `avatars` bucket. Each object path is what
 * the bucket's storage policies authorize (see the
 * member_avatars_and_team_rosters migration):
 * - `users/<user id>/…` — anyone, for their own login's picture;
 * - `orgs/<organization id>/people/<person id>/…` — people managers, for any Person.
 */

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export type AvatarMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export const AVATAR_MIME_TYPES: readonly AvatarMimeType[] = ['image/png', 'image/jpeg', 'image/webp'];

const EXTENSIONS: Record<AvatarMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export type AvatarTarget =
  | { kind: 'self'; userId: string }
  | { kind: 'person'; organizationId: string; personId: string };

export type AvatarFileProblem = 'unsupported_type' | 'too_large';

export const isAvatarMimeType = (value: string | null | undefined): value is AvatarMimeType =>
  value != null && (AVATAR_MIME_TYPES as readonly string[]).includes(value);

/** Why a picked file can't be used as an avatar, or null when it can. */
export const avatarFileProblem = (mimeType: string | null | undefined, size: number | null | undefined): AvatarFileProblem | null => {
  if (!isAvatarMimeType(mimeType)) return 'unsupported_type';
  if (size != null && size > AVATAR_MAX_BYTES) return 'too_large';
  return null;
};

/** A fresh object path per upload, so a cached old picture is never served for the new one. */
export const avatarObjectPath = (target: AvatarTarget, fileId: string, mimeType: AvatarMimeType): string => {
  const file = `${fileId}.${EXTENSIONS[mimeType]}`;
  return target.kind === 'self'
    ? `users/${target.userId}/${file}`
    : `orgs/${target.organizationId}/people/${target.personId}/${file}`;
};
