import {
  ApiError,
  isInlineTrack,
  type RehearsalManifestItem,
  type RehearsalRepeatMode,
  type RehearsalTrack,
} from '@service-center/shared';

/**
 * MOB-024: the native rules of the F14 rehearsal player. Order, track choice
 * and repeat come from the shared `rehearsalPlaylist`/`nextRehearsalIndex`;
 * this file only decides what a phone can do with a track and when to ask
 * the API for a fresh link. Pure, so it is tested without the audio module.
 */

/** The platforms the native app runs on (`Platform.OS`, narrowed). */
export type NativeAudioPlatform = 'ios' | 'android';

/**
 * How the app presents one playlist stop.
 * - `audio`: plays in the app's one audio player (background + lock screen).
 * - `device_player`: a video upload; the in-app player has no picture, so it
 *   opens in the device's own player through a fresh link.
 * - `external`: a link to another site's player; never imported or hosted.
 * - `unsupported`: an audio format this platform's player cannot decode.
 */
export type NativeTrackMode = 'audio' | 'device_player' | 'external' | 'unsupported';

/**
 * Audio types the platform players decode (AVPlayer on iOS, Media3/ExoPlayer
 * on Android). Anything else is gated instead of being tried and skipped.
 */
const PLAYABLE_AUDIO: Record<NativeAudioPlatform, ReadonlySet<string>> = {
  ios: new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/aac',
    'audio/x-aac',
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/aiff',
    'audio/x-aiff',
    'audio/flac',
    'audio/x-flac',
    'audio/x-caf',
  ]),
  android: new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/aac',
    'audio/x-aac',
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/flac',
    'audio/x-flac',
    'audio/ogg',
    'audio/opus',
    'audio/webm',
    'audio/3gpp',
    'audio/amr',
  ]),
};

export const nativeTrackMode = (track: RehearsalTrack, platform: NativeAudioPlatform): NativeTrackMode => {
  if (track.material.playback === 'external') return 'external';
  if (!isInlineTrack(track)) return 'unsupported';
  if (track.material.playback === 'video') return 'device_player';
  const mime = track.material.mime_type?.toLowerCase().split(';')[0]?.trim() ?? '';
  return PLAYABLE_AUDIO[platform].has(mime) ? 'audio' : 'unsupported';
};

/** The version a stop plays; a new version is a new source. */
export const rehearsalTrackKey = (track: RehearsalTrack): string =>
  `${track.material.file_id}:${track.material.version_id ?? ''}`;

/** Ask for a new link this long before the old one expires (the website's margin). */
export const SIGNED_URL_RENEW_MARGIN_MS = 20_000;

/** True when a link must be renewed before (re)starting playback. */
export const signedUrlNeedsRenewal = (expiresAt: number, now: number = Date.now()): boolean =>
  now > expiresAt - SIGNED_URL_RENEW_MARGIN_MS;

/** `expires_at` from `fileDownload` as a timestamp (no expiry → never). */
export const signedUrlExpiry = (expiresAt: string | null): number =>
  expiresAt ? new Date(expiresAt).getTime() : Number.POSITIVE_INFINITY;

/**
 * After a playback error: ask once more for a link (an expired or revoked URL;
 * access is rechecked), and after a second failure stop with "Try again" —
 * never skip to another track by itself.
 */
export const playerErrorAction = (alreadyRenewed: boolean): 'renew' | 'stop' => (alreadyRenewed ? 'stop' : 'renew');

/** "Previous" restarts a track that has played for more than this. */
export const PREVIOUS_RESTARTS_AFTER_SECONDS = 3;

export const previousAction = (positionSeconds: number): 'restart' | 'move' =>
  positionSeconds > PREVIOUS_RESTARTS_AFTER_SECONDS ? 'restart' : 'move';

/** Why the current stop does not play, as a catalog key (rendered in the displayed language). */
export type RehearsalPlayerFailureKey =
  | 'media:rehearsal.unavailable'
  | 'media:rehearsal.loadFailed'
  | 'plans:mobileRehearse.player.playbackFailed';

/** A failed link request: revoked/denied (403/404) vs a connection or server problem. */
export const linkFailureKey = (cause: unknown): RehearsalPlayerFailureKey =>
  cause instanceof ApiError && (cause.status === 403 || cause.status === 404)
    ? 'media:rehearsal.unavailable'
    : 'media:rehearsal.loadFailed';

/** A manifest refresh that means this person can no longer read the plan. */
export const isRehearsalAccessLoss = (cause: unknown): boolean =>
  cause instanceof ApiError && (cause.status === 403 || cause.status === 404);

/**
 * The playlist changed (manifest refresh, rights change, another recording
 * chosen): stay on the same item while it is still a stop. Returns null when
 * the item is gone, so the caller stops instead of playing something else.
 */
export const followItemIndex = (tracks: readonly RehearsalTrack[], itemId: string | null): number | null => {
  if (!itemId) return tracks.length ? 0 : null;
  const index = tracks.findIndex((candidate) => candidate.item_id === itemId);
  return index >= 0 ? index : null;
};

const REPEAT_ORDER: readonly RehearsalRepeatMode[] = ['off', 'all', 'one'];

export const nextRepeatMode = (current: RehearsalRepeatMode): RehearsalRepeatMode =>
  REPEAT_ORDER[(REPEAT_ORDER.indexOf(current) + 1) % REPEAT_ORDER.length]!;

/** Lock-screen / Control Center text: the plan item, the recording, the plan. */
export interface RehearsalLockScreenMetadata {
  title: string;
  artist?: string;
  albumTitle: string;
}

export const lockScreenMetadata = (
  track: RehearsalTrack,
  item: Pick<RehearsalManifestItem, 'song'> | null,
  planTitle: string,
): RehearsalLockScreenMetadata => ({
  title: track.title,
  ...(item?.song?.author ? { artist: item.song.author } : {}),
  albumTitle: planTitle,
});

/** Seconds the skip buttons (and the lock screen's seek buttons) move. */
export const REHEARSAL_SKIP_SECONDS = 10;

/** A seek target kept inside the track. */
export const clampSeek = (seconds: number, duration: number): number => {
  if (!Number.isFinite(seconds)) return 0;
  const upper = duration > 0 ? duration : Math.max(0, seconds);
  return Math.max(0, Math.min(seconds, upper));
};
