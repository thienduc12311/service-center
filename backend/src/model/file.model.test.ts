import { describe, expect, it } from 'vitest';
import type { AttachmentLinkRow, AttachmentRow } from '@service-center/shared';
import { buildPlanFileEntries, toFileSummary, type FileRowsBundle, type FileVersionListRow } from './file.model.js';

const NOW = new Date('2026-10-18T12:00:00Z');

const file = (over: Partial<AttachmentRow>): AttachmentRow => ({
  id: 'f',
  organization_id: 'org',
  owner_kind: 'plan',
  plan_id: 'plan',
  plan_item_id: null,
  song_id: null,
  arrangement_id: null,
  service_type_id: null,
  kind: 'upload',
  title: 'File',
  category: 'other',
  audience: 'organization',
  external_url: null,
  current_version_id: null,
  revision: 1,
  storage_path: null,
  filename: 'file.pdf',
  mime_type: 'application/pdf',
  size_bytes: 10,
  archived_at: null,
  archived_by: null,
  created_by: 'u',
  created_at: '2026-10-01T00:00:00Z',
  updated_by: null,
  updated_at: '2026-10-01T00:00:00Z',
  ...over,
});

const version = (over: Partial<FileVersionListRow>): FileVersionListRow => ({
  id: 'v',
  attachment_id: 'f',
  version_number: 1,
  status: 'ready',
  filename: 'file.pdf',
  mime_type: 'application/pdf',
  size_bytes: 10,
  declared_size: 10,
  failure_reason: null,
  upload_expires_at: null,
  created_at: '2026-10-01T00:00:00Z',
  created_by: 'u',
  finalized_at: '2026-10-01T00:00:00Z',
  ...over,
});

const link = (over: Partial<AttachmentLinkRow>): AttachmentLinkRow => ({
  id: 'l',
  organization_id: 'org',
  attachment_id: 'f',
  plan_id: 'plan',
  plan_item_id: null,
  pinned_version_id: null,
  source: 'manual',
  created_by: 'u',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...over,
});

const bundle = (files: AttachmentRow[], versions: FileVersionListRow[], writable: string[] = []): FileRowsBundle => ({
  files,
  versions,
  targets: [],
  writableIds: new Set(writable),
});

describe('toFileSummary', () => {
  it('shows unfinished uploads only to writers', () => {
    const row = file({ current_version_id: 'v1' });
    const versions = [
      version({ id: 'v1' }),
      version({ id: 'v2', status: 'pending', version_number: null, upload_expires_at: '2026-10-18T13:00:00Z', created_at: '2026-10-18T11:00:00Z' }),
      version({ id: 'v3', status: 'failed', version_number: null, failure_reason: 'abandoned', created_at: '2026-10-18T11:00:00Z' }),
    ];
    expect(toFileSummary(row, bundle([row], versions, ['f']), NOW).pending_versions.map((v) => v.id)).toEqual(['v2']);
    const reader = toFileSummary(row, bundle([row], versions), NOW);
    expect(reader.pending_versions).toEqual([]);
    expect(reader.current_version?.id).toBe('v1');
    expect(reader.can_edit).toBe(false);
  });
});

describe('buildPlanFileEntries', () => {
  it('uses the pinned version and flags a newer current one', () => {
    const row = file({ id: 'f', owner_kind: 'song', plan_id: null, song_id: 's', current_version_id: 'v2' });
    const entries = buildPlanFileEntries(
      [],
      [link({ pinned_version_id: 'v1' })],
      bundle([row], [version({ id: 'v1' }), version({ id: 'v2', version_number: 2 })]),
      NOW,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ source: 'link', newer_version_available: true });
    expect(entries[0]?.version?.id).toBe('v1');
  });

  it('hides a pinned link whose version the caller cannot read instead of showing the current one', () => {
    const row = file({ id: 'f', owner_kind: 'song', plan_id: null, song_id: 's', current_version_id: 'v2' });
    const entries = buildPlanFileEntries([], [link({ pinned_version_id: 'v1' })], bundle([row], [version({ id: 'v2' })]), NOW);
    expect(entries).toEqual([]);
  });

  it('lists plan, item, song and arrangement files once each, and skips archived library files', () => {
    const files = [
      file({ id: 'p', current_version_id: 'vp' }),
      file({ id: 'i', owner_kind: 'plan_item', plan_item_id: 'item1', current_version_id: 'vi' }),
      file({ id: 's', owner_kind: 'song', plan_id: null, song_id: 'song1', current_version_id: 'vs' }),
      file({ id: 'a', owner_kind: 'arrangement', plan_id: null, song_id: 'song1', arrangement_id: 'arr1', current_version_id: 'va' }),
      file({ id: 'old', owner_kind: 'song', plan_id: null, song_id: 'song1', current_version_id: 'vo', archived_at: '2026-10-02T00:00:00Z' }),
    ];
    const versions = ['p', 'i', 's', 'a', 'o'].map((k) =>
      version({ id: `v${k}`, attachment_id: k === 'o' ? 'old' : k }),
    );
    const entries = buildPlanFileEntries(
      [
        { id: 'item1', song_id: 'song1', arrangement_id: 'arr1' },
        { id: 'item2', song_id: 'song1', arrangement_id: null },
      ],
      [],
      bundle(files, versions),
      NOW,
    );
    expect(entries.map((e) => `${e.file.id}@${e.plan_item_id ?? 'plan'}:${e.source}`)).toEqual([
      'p@plan:plan',
      'i@item1:item',
      'a@item1:arrangement',
      's@item1:song',
      's@item2:song',
    ]);
  });

  it('keeps an archived file reachable through a pin', () => {
    const row = file({ id: 'f', owner_kind: 'service_type', plan_id: null, service_type_id: 'st', current_version_id: 'v1', archived_at: '2026-10-02T00:00:00Z' });
    const entries = buildPlanFileEntries([], [link({ pinned_version_id: 'v1', source: 'service_type_default' })], bundle([row], [version({ id: 'v1' })]), NOW);
    expect(entries[0]).toMatchObject({ source: 'link', newer_version_available: false });
  });
});
