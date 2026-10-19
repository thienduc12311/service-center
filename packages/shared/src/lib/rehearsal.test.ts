import { describe, expect, it } from 'vitest';
import type { PlanDetail, PlanItemDetail } from '../types/domain.js';
import type { FileSummary, FileVersionSummary, PlanFileEntry } from '../types/files.js';
import type { OfflinePackRecord, RehearsalManifest } from '../types/rehearsal.js';
import {
  buildRehearsalManifest,
  isRehearsalManifestExpired,
  nextRehearsalIndex,
  offlinePackKey,
  offlinePackKeysToRemove,
  offlinePackStatus,
  rehearsalPlaylist,
  selectOfflinePack,
} from './rehearsal.js';
import { offlinePackRequestSchema, setPlanItemMediaSchema } from '../schemas/media.js';

const base = {
  plan_id: 'plan',
  song_id: null,
  arrangement_id: null,
  key_override: null,
  description: null,
  created_at: '',
  updated_at: '',
  song: null,
  arrangement: null,
  sequence_override: null,
  leader_person_id: null,
  leader_position_id: null,
  service_segment: 'service' as const,
};
const song = { id: 's', title: 'Amazing Grace', author: 'Newton', copyright: null, default_key: 'C', default_bpm: 72 };
const arrangement = {
  id: 'a', song_id: 's', name: 'In C', song_key: 'C', bpm: 80, sequence: ['V1', 'C'], chord_chart: '[C]Amazing [G]grace',
  chart_columns: 1, chart_font: null, chart_font_size: null, chart_chord_color: null, is_default: false, length_seconds: null,
};
const items: PlanItemDetail[] = [
  { ...base, id: 'h', item_type: 'header', title: 'Worship', length_seconds: 0, sort_order: 0 },
  {
    ...base, id: 'song', item_type: 'song', title: 'Amazing Grace', length_seconds: 300, sort_order: 1,
    song_id: 's', arrangement_id: 'a', key_override: 'D', sequence_override: ['C', 'V1'], song, arrangement,
  },
  { ...base, id: 'video', item_type: 'item', title: 'Countdown', length_seconds: 60, sort_order: 2, media_id: 'm' },
  { ...base, id: 'welcome', item_type: 'item', title: 'Welcome', length_seconds: 120, sort_order: 3 },
];
const plan = {
  id: 'plan', title: 'Sunday', service_date: '2026-11-01', content_revision: 7, items,
} as unknown as PlanDetail;

const version = (id: string, mime: string, size = 1000, number = 1): FileVersionSummary => ({
  id, version_number: number, status: 'ready', filename: `${id}.bin`, mime_type: mime, size_bytes: size,
  declared_size: size, failure_reason: null, upload_expires_at: null, created_at: '', created_by: null,
  finalized_at: '', is_current: true,
});
const file = (id: string, over: Partial<FileSummary> = {}): FileSummary => ({
  id, owner: { kind: 'song', id: 's' }, plan_id: null, song_id: 's', kind: 'upload', title: id, category: 'audio',
  audience: 'organization', audience_targets: [], external_url: null, playback_rights: 'download',
  current_version: version(`${id}-v1`, 'audio/mpeg'), pending_versions: [], revision: 1, archived_at: null,
  created_at: '', updated_at: '', can_edit: false, ...over,
});
const entry = (f: FileSummary, source: PlanFileEntry['source'], item: string | null, over: Partial<PlanFileEntry> = {}): PlanFileEntry => ({
  file: f, source, plan_item_id: item, link: null, version: f.current_version, newer_version_available: false, ...over,
});

const songAudio = file('song-mp3');
const pinnedV1 = version('pinned-v1', 'audio/mpeg', 500, 1);
const arrAudio = file('arr-mp3', { current_version: version('arr-v2', 'audio/mpeg', 800, 2) });
const streamOnly = file('stream', { playback_rights: 'stream_only' });
const chartPdf = file('chart', { category: 'chart', current_version: version('chart-v1', 'application/pdf') });
const ytLink = file('yt', { kind: 'link', category: 'video', external_url: 'https://video.example/x', current_version: null });
const archived = file('old', { archived_at: '2026-01-01' });
const mediaVideo = file('mv', { owner: { kind: 'media', id: 'm' }, song_id: null, category: 'video', current_version: version('mv-v1', 'video/mp4', 4000) });
const planDoc = file('notes', { owner: { kind: 'plan', id: 'plan' }, kind: 'document', category: 'document', current_version: version('notes-v1', 'text/markdown') });

const planFiles: PlanFileEntry[] = [
  entry(planDoc, 'plan', null),
  entry(songAudio, 'song', 'song'),
  entry(arrAudio, 'link', 'song', {
    version: pinnedV1,
    link: { id: 'l', attachment_id: 'arr-mp3', plan_id: 'plan', plan_item_id: 'song', pinned_version_id: 'pinned-v1', source: 'manual', created_at: '' },
    newer_version_available: true,
  }),
  entry(streamOnly, 'song', 'song'),
  entry(chartPdf, 'arrangement', 'song'),
  entry(ytLink, 'item', 'welcome'),
  entry(archived, 'song', 'song'),
];

const build = (now = new Date('2026-10-18T12:00:00Z')): RehearsalManifest =>
  buildRehearsalManifest({
    plan,
    planFiles,
    mediaFiles: [mediaVideo],
    media: [{ id: 'm', title: 'Countdown video', creator: 'Studio', duration_seconds: 60, archived: false }],
    now,
  });

describe('buildRehearsalManifest', () => {
  const manifest = build();

  it('keeps plan order, including headers', () => {
    expect(manifest.items.map((item) => item.item_id)).toEqual(['h', 'song', 'video', 'welcome']);
    expect(manifest.plan_revision).toBe(7);
    expect(isRehearsalManifestExpired(manifest, new Date('2026-10-18T12:09:59Z'))).toBe(false);
    expect(isRehearsalManifestExpired(manifest, new Date('2026-10-18T12:10:00Z'))).toBe(true);
  });

  it('uses the F11 chart context: service key, plan sequence and chords moved once', () => {
    const songItem = manifest.items[1]!;
    expect(songItem.chart).toMatchObject({ status: 'ready', key: 'D', source_key: 'C', key_from_plan: true, sequence: ['C', 'V1'], sequence_from_plan: true });
    expect(songItem.chart?.chordpro).toContain('[D]');
    expect(songItem.tempo_bpm).toBe(80);
    expect(songItem.arrangement).toEqual({ id: 'a', name: 'In C' });
  });

  it('honours a pinned version and drops archived unpinned files', () => {
    const materials = manifest.items[1]!.materials;
    const pinned = materials.find((material) => material.file_id === 'arr-mp3');
    expect(pinned).toMatchObject({ version_id: 'pinned-v1', pinned: true, newer_version_available: true, source: 'link' });
    expect(materials.some((material) => material.file_id === 'old')).toBe(false);
  });

  it('prefers the most specific playable audio as the track', () => {
    expect(manifest.items[1]!.track_file_id).toBe('arr-mp3');
    expect(manifest.items[0]!.track_file_id).toBeNull();
  });

  it('separates stream and download rights', () => {
    const stream = manifest.items[1]!.materials.find((material) => material.file_id === 'stream');
    expect(stream?.rights).toEqual({ stream: true, download: false, offline: false });
    const pdf = manifest.items[1]!.materials.find((material) => material.file_id === 'chart');
    expect(pdf).toMatchObject({ playback: 'view', rights: { stream: false, download: true, offline: true } });
  });

  it('marks links as external players with no download', () => {
    const link = manifest.items[3]!.materials[0]!;
    expect(link).toMatchObject({ playback: 'external', external_url: 'https://video.example/x', version_id: null });
    expect(link.rights).toEqual({ stream: false, download: false, offline: false });
    expect(manifest.items[3]!.track_file_id).toBe('yt');
  });

  it('adds a linked media bundle and its files to regular items only', () => {
    const video = manifest.items[2]!;
    expect(video.media?.title).toBe('Countdown video');
    expect(video.materials.map((material) => material.file_id)).toEqual(['mv']);
    expect(video.track_file_id).toBe('mv');
  });

  it('keeps plan-level files out of the order', () => {
    expect(manifest.plan_materials.map((material) => material.file_id)).toEqual(['notes']);
    expect(manifest.plan_materials[0]!.playback).toBe('document');
  });

  it('includes nothing the caller could not read', () => {
    const none = buildRehearsalManifest({ plan, planFiles: [], mediaFiles: [], media: [] });
    expect(none.items.every((item) => item.materials.length === 0 && item.track_file_id === null)).toBe(true);
    // A linked bundle the caller cannot see contributes nothing either.
    expect(none.items[2]!.media).toBeNull();
  });
});

describe('player navigation', () => {
  const tracks = rehearsalPlaylist(build());

  it('plays items with a track in plan order', () => {
    expect(tracks.map((track) => track.item_id)).toEqual(['song', 'video', 'welcome']);
  });

  it('lets the reader choose another playable material, never an unplayable one', () => {
    expect(rehearsalPlaylist(build(), { song: 'song-mp3' })[0]!.material.file_id).toBe('song-mp3');
    expect(rehearsalPlaylist(build(), { song: 'chart' })[0]!.material.file_id).toBe('arr-mp3');
  });

  it('moves, stops at the ends and repeats as asked', () => {
    expect(nextRehearsalIndex(3, 0, 1, 'off', 'user')).toBe(1);
    expect(nextRehearsalIndex(3, 2, 1, 'off', 'ended')).toBeNull();
    expect(nextRehearsalIndex(3, 0, -1, 'off', 'user')).toBeNull();
    expect(nextRehearsalIndex(3, 2, 1, 'all', 'ended')).toBe(0);
    expect(nextRehearsalIndex(3, 0, -1, 'all', 'user')).toBe(2);
    expect(nextRehearsalIndex(3, 1, 1, 'one', 'ended')).toBe(1);
    expect(nextRehearsalIndex(3, 1, 1, 'one', 'user')).toBe(2);
    expect(nextRehearsalIndex(0, 0, 1, 'all', 'ended')).toBeNull();
  });
});

describe('offline packs', () => {
  const manifest = build();

  it('takes only downloadable uploads and says why the rest are left out', () => {
    const pack = selectOfflinePack(manifest, 1_000_000);
    expect(pack.entries.map((entry) => entry.file_id)).toEqual(['arr-mp3', 'chart', 'song-mp3', 'mv']);
    expect(pack.entries[0]!.version_id).toBe('pinned-v1');
    expect(Object.fromEntries(pack.excluded.map((entry) => [entry.file_id, entry.reason]))).toEqual({
      stream: 'stream_only',
      yt: 'external_link',
      notes: 'document',
    });
    expect(pack.total_bytes).toBe(500 + 1000 + 1000 + 4000);
  });

  it('stops at the size budget', () => {
    const pack = selectOfflinePack(manifest, 1600);
    expect(pack.entries.map((entry) => entry.file_id)).toEqual(['arr-mp3', 'chart']);
    expect(pack.excluded.filter((entry) => entry.reason === 'pack_limit').map((entry) => entry.file_id)).toEqual(['song-mp3', 'mv']);
  });

  const record: OfflinePackRecord = {
    key: offlinePackKey('u', 'o', 'plan'),
    user_id: 'u',
    organization_id: 'o',
    plan_id: 'plan',
    plan_revision: 7,
    created_at: '2026-10-18T12:00:00Z',
    recheck_by: '2026-10-19T12:00:00Z',
    entries: [
      { item_id: 'song', file_id: 'arr-mp3', version_id: 'pinned-v1', version_number: 1, filename: 'a', mime_type: 'audio/mpeg', size_bytes: 500, downloaded_bytes: 500 },
      { item_id: 'song', file_id: 'song-mp3', version_id: 'old-v', version_number: 1, filename: 'b', mime_type: 'audio/mpeg', size_bytes: 1000, downloaded_bytes: 1000 },
      { item_id: 'song', file_id: 'chart', version_id: 'chart-v1', version_number: 1, filename: 'c', mime_type: 'application/pdf', size_bytes: 1000, downloaded_bytes: 10 },
      { item_id: 'song', file_id: 'gone', version_id: 'gone-v1', version_number: 1, filename: 'd', mime_type: 'audio/mpeg', size_bytes: 10, downloaded_bytes: 10 },
    ],
  };

  it('reports ready, stale, missing and revoked entries against a fresh manifest', () => {
    const status = offlinePackStatus(record, manifest);
    expect(Object.fromEntries(status.entries.map((entry) => [entry.file_id, entry.status]))).toEqual({
      'arr-mp3': 'ready',
      'song-mp3': 'stale',
      chart: 'missing',
      gone: 'revoked',
    });
    expect(status.new_file_ids).toEqual(['mv']);
    expect(status.needs_recheck).toBe(false);
  });

  it('a stream-only change revokes an entry already on the device', () => {
    const changed = { ...manifest, items: manifest.items.map((item) => ({
      ...item,
      materials: item.materials.map((material) => material.file_id === 'arr-mp3'
        ? { ...material, playback_rights: 'stream_only' as const, rights: { stream: true, download: false, offline: false } }
        : material),
    })) };
    expect(offlinePackStatus(record, changed).entries[0]!.status).toBe('revoked');
  });

  it('offline, only the clock can say the pack needs a recheck', () => {
    expect(offlinePackStatus(record, null, new Date('2026-10-19T11:59:59Z')).needs_recheck).toBe(false);
    const late = offlinePackStatus(record, null, new Date('2026-10-19T12:00:00Z'));
    expect(late.needs_recheck).toBe(true);
    expect(late.entries.map((entry) => entry.status)).toEqual(['ready', 'ready', 'missing', 'ready']);
  });

  it('removes other users’ and other organizations’ packs on sign-out or switch', () => {
    const records = [
      { key: 'a', user_id: 'u', organization_id: 'o' },
      { key: 'b', user_id: 'u', organization_id: 'gone-org' },
      { key: 'c', user_id: 'other', organization_id: 'o' },
    ];
    expect(offlinePackKeysToRemove(records, { userId: 'u', organizationIds: ['o'] })).toEqual(['b', 'c']);
    expect(offlinePackKeysToRemove(records, { userId: null, organizationIds: [] })).toEqual(['a', 'b', 'c']);
  });

  it('validates request bodies', () => {
    expect(offlinePackRequestSchema.safeParse({ max_bytes: 0 }).success).toBe(false);
    expect(setPlanItemMediaSchema.safeParse({ media_id: null }).success).toBe(true);
    expect(setPlanItemMediaSchema.safeParse({ media_id: 'nope' }).success).toBe(false);
  });
});
