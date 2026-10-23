import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  nextRehearsalIndex,
  rehearsalPlaylist,
  selectRehearsalTrack,
  type RehearsalManifest,
  type RehearsalManifestItem,
  type RehearsalMaterial,
} from '@service-center/shared';
import {
  PRACTICE_PITCH_CORRECTION,
  SIGNED_URL_RENEW_MARGIN_MS,
  clampSeek,
  followItemIndex,
  isRehearsalAccessLoss,
  linkFailureKey,
  lockScreenMetadata,
  nativeTrackMode,
  nextRepeatMode,
  playerErrorAction,
  previousAction,
  rehearsalTrackKey,
  signedUrlExpiry,
  signedUrlNeedsRenewal,
} from './rehearsal-player';

const material = (fileId: string, overrides: Partial<RehearsalMaterial> = {}): RehearsalMaterial => ({
  file_id: fileId,
  version_id: `${fileId}-v1`,
  version_number: 1,
  title: fileId,
  filename: `${fileId}.mp3`,
  kind: 'upload',
  category: 'audio',
  mime_type: 'audio/mpeg',
  size_bytes: 1000,
  source: 'item',
  external_url: null,
  playback: 'audio',
  rights: { stream: true, download: true, offline: true },
  playback_rights: 'download',
  pinned: false,
  newer_version_available: false,
  ...overrides,
});

const item = (id: string, position: number, materials: RehearsalMaterial[], overrides: Partial<RehearsalManifestItem> = {}): RehearsalManifestItem => ({
  item_id: id,
  position,
  item_type: 'song',
  title: id,
  length_seconds: 240,
  service_segment: 'service',
  song: { id: `${id}-song`, title: id, author: null },
  arrangement: null,
  tempo_bpm: null,
  chart: null,
  media: null,
  materials,
  track_file_id: selectRehearsalTrack(materials)?.file_id ?? null,
  ...overrides,
});

const manifest = (items: RehearsalManifestItem[]): RehearsalManifest => ({
  plan_id: 'plan',
  plan_title: 'Sunday',
  service_date: '2026-10-25',
  plan_revision: 3,
  generated_at: '2026-10-22T10:00:00.000Z',
  expires_at: '2026-10-22T10:10:00.000Z',
  items,
  plan_materials: [],
  truncated: false,
});

const VIDEO = material('video', { mime_type: 'video/mp4', playback: 'video', category: 'video', filename: 'v.mp4' });
const EXTERNAL = material('youtube', {
  kind: 'link',
  version_id: null,
  version_number: null,
  filename: null,
  mime_type: null,
  size_bytes: null,
  external_url: 'https://www.youtube.com/watch?v=1',
  playback: 'external',
  rights: { stream: false, download: false, offline: false },
});
const STREAM_ONLY = material('stream-only', { playback_rights: 'stream_only', rights: { stream: true, download: false, offline: false } });
const PDF = material('chart-pdf', { mime_type: 'application/pdf', playback: 'view', category: 'chart', rights: { stream: false, download: true, offline: true } });

const ORDER = manifest([
  item('Welcome', 0, [], { item_type: 'header', song: null }),
  item('Song A', 1, [material('a-arrangement', { source: 'arrangement' }), material('a-item')]),
  item('Announcements', 2, [PDF], { item_type: 'item', song: null }),
  item('Song B', 3, [STREAM_ONLY]),
  item('Song C', 4, [VIDEO]),
  item('Song D', 5, [EXTERNAL]),
]);

describe('MOB-024 queue order (shared playlist)', () => {
  it('plays permitted tracks in plan order, skipping headers and items without a playable material', () => {
    const tracks = rehearsalPlaylist(ORDER);
    expect(tracks.map((track) => track.item_id)).toEqual(['Song A', 'Song B', 'Song C', 'Song D']);
    // The most specific source wins: the item's own recording over the arrangement's.
    expect(tracks[0]!.material.file_id).toBe('a-item');
    // Stream-only still plays inline; it just cannot be downloaded.
    expect(tracks[1]!.material.file_id).toBe('stream-only');
  });

  it('a file the person may no longer read is absent from the manifest, so it is never queued', () => {
    const revoked = manifest(ORDER.items.map((entry) => (entry.item_id === 'Song B' ? item('Song B', 3, []) : entry)));
    expect(rehearsalPlaylist(revoked).map((track) => track.item_id)).toEqual(['Song A', 'Song C', 'Song D']);
  });

  it('a chosen recording replaces the default only when it is playable', () => {
    expect(rehearsalPlaylist(ORDER, { 'Song A': 'a-arrangement' })[0]!.material.file_id).toBe('a-arrangement');
    expect(rehearsalPlaylist(ORDER, { Announcements: 'chart-pdf' }).map((track) => track.item_id)).not.toContain('Announcements');
  });

  it('next/previous/ended follow the shared repeat rules', () => {
    expect(nextRehearsalIndex(4, 3, 1, 'off', 'ended')).toBeNull();
    expect(nextRehearsalIndex(4, 3, 1, 'all', 'ended')).toBe(0);
    expect(nextRehearsalIndex(4, 1, 1, 'one', 'ended')).toBe(1);
    expect(nextRehearsalIndex(4, 1, 1, 'one', 'user')).toBe(2);
    expect(nextRepeatMode('off')).toBe('all');
    expect(nextRepeatMode('all')).toBe('one');
    expect(nextRepeatMode('one')).toBe('off');
  });
});

describe('MOB-024 what a phone does with each stop', () => {
  const [a, streamOnly, video, external] = rehearsalPlaylist(ORDER);

  it('plays audio in the app, opens video in the device player and keeps external links external', () => {
    expect(nativeTrackMode(a!, 'ios')).toBe('audio');
    expect(nativeTrackMode(streamOnly!, 'android')).toBe('audio');
    expect(nativeTrackMode(video!, 'ios')).toBe('device_player');
    expect(nativeTrackMode(external!, 'android')).toBe('external');
  });

  it('gates audio formats the platform player cannot decode instead of trying and skipping', () => {
    const ogg = { ...a!, material: material('ogg', { mime_type: 'audio/ogg' }) };
    expect(nativeTrackMode(ogg, 'ios')).toBe('unsupported');
    expect(nativeTrackMode(ogg, 'android')).toBe('audio');
    const wma = { ...a!, material: material('wma', { mime_type: 'audio/x-ms-wma' }) };
    expect(nativeTrackMode(wma, 'ios')).toBe('unsupported');
    expect(nativeTrackMode(wma, 'android')).toBe('unsupported');
    const unknown = { ...a!, material: material('unknown', { mime_type: null }) };
    expect(nativeTrackMode(unknown, 'ios')).toBe('unsupported');
    const withParams = { ...a!, material: material('m4a', { mime_type: 'Audio/MP4; codecs=mp4a.40.2' }) };
    expect(nativeTrackMode(withParams, 'ios')).toBe('audio');
  });

  it('a new version of the same file is a new source', () => {
    const v2 = { ...a!, material: { ...a!.material, version_id: 'a-item-v2' } };
    expect(rehearsalTrackKey(v2)).not.toBe(rehearsalTrackKey(a!));
  });
});

describe('MOB-024 signed links, errors and stale state', () => {
  it('renews a link before it expires, and never for a link without expiry', () => {
    const expires = Date.parse('2026-10-22T10:05:00.000Z');
    expect(signedUrlExpiry('2026-10-22T10:05:00.000Z')).toBe(expires);
    expect(signedUrlNeedsRenewal(expires, expires - SIGNED_URL_RENEW_MARGIN_MS - 1)).toBe(false);
    expect(signedUrlNeedsRenewal(expires, expires - SIGNED_URL_RENEW_MARGIN_MS + 1)).toBe(true);
    expect(signedUrlNeedsRenewal(signedUrlExpiry(null), Date.now() + 10 ** 12)).toBe(false);
  });

  it('asks once more after a playback error, then stops (never auto-skips)', () => {
    expect(playerErrorAction(false)).toBe('renew');
    expect(playerErrorAction(true)).toBe('stop');
  });

  it('a revoked or denied file says so; other failures say to check the connection', () => {
    expect(linkFailureKey(new ApiError(404, 'Version not found'))).toBe('media:rehearsal.unavailable');
    expect(linkFailureKey(new ApiError(403, 'Forbidden'))).toBe('media:rehearsal.unavailable');
    expect(linkFailureKey(new ApiError(500, 'Server error'))).toBe('media:rehearsal.loadFailed');
    expect(linkFailureKey(new TypeError('Network request failed'))).toBe('media:rehearsal.loadFailed');
    expect(isRehearsalAccessLoss(new ApiError(404, 'Plan not found'))).toBe(true);
    expect(isRehearsalAccessLoss(new TypeError('Network request failed'))).toBe(false);
  });

  it('a refreshed manifest keeps the current item, or stops when it is gone', () => {
    const tracks = rehearsalPlaylist(ORDER);
    expect(followItemIndex(tracks, 'Song C')).toBe(2);
    expect(followItemIndex(tracks, 'Song gone')).toBeNull();
    expect(followItemIndex(tracks, null)).toBe(0);
    expect(followItemIndex([], null)).toBeNull();
  });

  it('previous restarts after a few seconds, seeks stay inside the track', () => {
    expect(previousAction(2)).toBe('move');
    expect(previousAction(10)).toBe('restart');
    expect(clampSeek(-5, 200)).toBe(0);
    expect(clampSeek(250, 200)).toBe(200);
    expect(clampSeek(Number.NaN, 200)).toBe(0);
  });

  it('the lock screen shows the plan item, its author and the plan', () => {
    const [a] = rehearsalPlaylist(ORDER);
    const songItem = { song: { id: 's', title: 'Song A', author: 'Writer' } };
    expect(lockScreenMetadata(a!, songItem, 'Sunday')).toEqual({ title: 'Song A', artist: 'Writer', albumTitle: 'Sunday' });
    expect(lockScreenMetadata(a!, null, 'Sunday')).toEqual({ title: 'Song A', albumTitle: 'Sunday' });
  });
});

describe('MOB-024 source contract', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');
  const hook = read('src', 'lib', 'useRehearsalPlayer.ts');
  // MOB-025 moved the player UI into a view shared with the offline library.
  const screen = read('app', 'plan', 'rehearse', '[id].tsx') + read('src', 'components', 'rehearsal', 'RehearsalView.tsx');
  const config = read('app.config.js');
  const both = hook + screen;

  it('uses only the implemented F14/F13 methods and the shared playlist rules', () => {
    const methods = [...both.matchAll(/api\.(\w+)\(/g)].map((match) => match[1]);
    expect(new Set(methods)).toEqual(new Set(['rehearsalManifest', 'fileDownload']));
    // Offline packs (MOB-025) live in their own hook; the player never asks for one.
    expect(both).not.toContain('rehearsalOfflinePack');
    expect(hook).toContain('rehearsalPlaylist(manifest, choices)');
    expect(hook).toContain('nextRehearsalIndex(');
    // The manifest's chart is already in the service key; nothing re-transposes it.
    expect(both).not.toMatch(/transpose\w*\(|getChart\(/);
  });

  it('owns one player, requests a link only for the stop about to play and drops late answers', () => {
    expect(hook.match(/createAudioPlayer\(/g)).toHaveLength(1);
    expect(hook).toMatch(/disposition: 'inline'/);
    expect(hook).toMatch(/if \(id !== request\.current \|\| !isCurrentGeneration\(loadGeneration\)\) return/);
    // iOS refuses a null source (seen on the simulator): stopping must never call it.
    expect(hook).not.toMatch(/player\.replace\(null\)/);
  });

  it('stores no links or audio on the device itself (offline packs are MOB-025, in their own store)', () => {
    expect(both).not.toMatch(/AsyncStorage|SecureStore|setItem|expo-file-system|downloadFirst: true/);
    // A local file is used only when the offline pack hands one over; otherwise a link is requested.
    expect(hook).toMatch(/const local = localSource\?\.\(target\) \?\? null;/);
  });

  it('plays in the background with lock-screen controls and releases everything on leave', () => {
    expect(hook).toMatch(/shouldPlayInBackground: true, interruptionMode: 'doNotMix'/);
    expect(hook).toContain('setActiveForLockScreen(true');
    expect(hook).toContain('player.clearLockScreenControls()');
    expect(hook).toContain('player.remove()');
    expect(config).toMatch(/'expo-audio', \{ microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: true \}/);
  });

  it('stops on a second failure with Try again instead of moving on', () => {
    expect(hook).toMatch(/playerErrorAction\(renewed\.current\?\.key === current\) === 'renew'/);
    expect(screen).toContain("t('common:actions.retry')");
  });
});

describe('MOB-027 practice speed source contract', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');
  const hook = read('src', 'lib', 'useRehearsalPlayer.ts');
  const view = read('src', 'components', 'rehearsal', 'RehearsalView.tsx');
  const web = read('..', 'frontend', 'src', 'components', 'rehearsal', 'useRehearsalPlayer.ts');

  it('keeps the pitch: never the iOS varispeed quality', () => {
    expect(PRACTICE_PITCH_CORRECTION).not.toBe('low');
    expect(hook).toContain('player.shouldCorrectPitch = true;');
    expect(hook).toContain('player.setPlaybackRate(rateRef.current, PRACTICE_PITCH_CORRECTION)');
    // The website's element keeps pitch too, and the speed survives a track change.
    expect(web).toContain('element.preservesPitch = true;');
    expect(web).toContain('element.defaultPlaybackRate = rate;');
  });

  it('applies the speed to every newly loaded stop of the one player, with no new request or storage', () => {
    expect(hook).toMatch(/player\.replace\(\{ uri \}\);\n\s+applyRate\(\);/);
    expect(hook.match(/createAudioPlayer\(/g)).toHaveLength(1);
    expect(hook).not.toMatch(/AsyncStorage|SecureStore|setItem/);
  });

  it('offers exactly the shared speeds, only for in-app audio, with the tempo-only note', () => {
    expect(view).toContain('REHEARSAL_PLAYBACK_RATES.map(');
    expect(view).toMatch(/\{audio \? \(\n\s+<View style=\{styles\.speed\}>/);
    expect(view).toContain("t('rehearse.speedNote')");
  });
});
