import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  FILE_MAX_BYTES,
  createFileUploadIntentSchema,
  type ArrangementMaterials,
  type CreateFileUploadIntentRequest,
  type FileFinalizeResult,
  type FileSummary,
  type FileUploadIntent,
  type FileVersionSummary,
  type PlanFileEntry,
} from '@service-center/shared';
import {
  StorageUploadError,
  UploadCancelledError,
  checkPickedFile,
  runFileUpload,
  uploadIntentRequest,
  type FileUploadIO,
  type FileUploadState,
  type PendingFileUpload,
  type PickedDeviceFile,
} from './file-upload';
import {
  audienceTargetsMissing,
  canSaveCopy,
  fileErrorMessage,
  fileKeyLabels,
  filePreviewMode,
  fileUploadFailureMessage,
  groupPlanFiles,
  isFileAccessLost,
  linkHost,
  planFileBadges,
  planLinkActions,
  safeShareFileName,
} from './file-view';

const OWNER = { kind: 'plan_item' as const, id: '00000000-0000-4000-8000-000000000001' };
const FILE_ID = '00000000-0000-4000-8000-0000000000f1';
const KEY = '00000000-0000-4000-8000-0000000000aa';

const version = (overrides: Partial<FileVersionSummary> = {}): FileVersionSummary => ({
  id: '00000000-0000-4000-8000-0000000000b1',
  version_number: 1,
  status: 'ready',
  filename: 'chart.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  declared_size: 2048,
  failure_reason: null,
  upload_expires_at: null,
  created_at: '2026-10-20T10:00:00Z',
  created_by: null,
  finalized_at: '2026-10-20T10:00:05Z',
  is_current: true,
  ...overrides,
});

const summary = (overrides: Partial<FileSummary> = {}): FileSummary => ({
  id: FILE_ID,
  owner: OWNER,
  plan_id: null,
  song_id: null,
  kind: 'upload',
  title: 'Chart',
  category: 'chart',
  audience: 'organization',
  audience_targets: [],
  external_url: null,
  playback_rights: 'download',
  current_version: version(),
  pending_versions: [],
  revision: 3,
  archived_at: null,
  created_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-20T10:00:00Z',
  can_edit: false,
  ...overrides,
});

const picked = (overrides: Partial<PickedDeviceFile> = {}): PickedDeviceFile => ({
  uri: 'file:///cache/chart.pdf',
  name: 'chart.pdf',
  size: 2048,
  mimeType: 'application/pdf',
  ...overrides,
});

const pendingVersion = version({ id: '00000000-0000-4000-8000-0000000000c2', version_number: null, status: 'pending', is_current: false });

const intent = (upload = true): FileUploadIntent => ({
  file: summary({ current_version: null, can_edit: true }),
  version: pendingVersion,
  upload: upload
    ? { bucket: 'attachments', path: 'org/file/v/chart.pdf', token: 't', signed_url: 'https://storage.test/upload/sign/x?token=t', expires_at: '2026-10-20T12:00:00Z' }
    : null,
  replayed: !upload,
});

const finalized = (outcome: FileFinalizeResult['outcome'], reason: FileFinalizeResult['reason'] = null): FileFinalizeResult => ({
  outcome,
  reason,
  replayed: false,
  file: summary({ can_edit: true }),
  version: outcome === 'ready' ? version({ id: pendingVersion.id }) : pendingVersion,
});

const pending = (overrides: Partial<PendingFileUpload> = {}): PendingFileUpload => ({
  picked: picked(),
  size: 2048,
  destination: { kind: 'new', owner: OWNER, audience: 'scheduled', teamIds: [], positionIds: [] },
  mimeType: 'application/pdf',
  idempotencyKey: KEY,
  intent: null,
  ...overrides,
});

/** A scripted server + Storage: each call takes the next answer for that step. */
const fakeIO = (script: {
  intents?: Array<FileUploadIntent | Error>;
  puts?: Array<Error | null>;
  finals?: Array<FileFinalizeResult | Error>;
}) => {
  const calls = { intents: [] as CreateFileUploadIntentRequest[], puts: 0, finals: [] as string[] };
  const next = <T>(list: Array<T | Error> | undefined): T => {
    const value = list?.shift();
    if (value instanceof Error) throw value;
    return value as T;
  };
  const io: FileUploadIO = {
    createIntent: async (body) => {
      calls.intents.push(body);
      return next(script.intents);
    },
    putBytes: async (_target, file, _type, onProgress) => {
      calls.puts += 1;
      const outcome = script.puts?.shift() ?? null;
      if (outcome) throw outcome;
      onProgress(1024, file.size ?? 0);
      onProgress(2048, file.size ?? 0);
    },
    finalize: async (_fileId, versionId) => {
      calls.finals.push(versionId);
      return next(script.finals);
    },
  };
  return { io, calls };
};

const phases = (states: FileUploadState[]) => states.map((state) => state.phase);

describe('MOB-026 picked file checks (same refusals as the website)', () => {
  it('accepts an allowed type and refuses unsupported, empty, oversized and unreadable files', () => {
    expect(checkPickedFile(picked())).toEqual({ ok: true, mimeType: 'application/pdf', size: 2048 });
    expect(checkPickedFile(picked({ name: 'setup.exe', mimeType: 'application/x-msdownload' }))).toEqual({
      ok: false,
      failure: { kind: 'unsupportedType' },
    });
    expect(checkPickedFile(picked({ size: 0 }))).toEqual({ ok: false, failure: { kind: 'empty' } });
    expect(checkPickedFile(picked({ size: FILE_MAX_BYTES + 1 }))).toEqual({
      ok: false,
      failure: { kind: 'tooLarge', maxBytes: FILE_MAX_BYTES },
    });
    expect(checkPickedFile(picked({ size: null }))).toEqual({ ok: false, failure: { kind: 'unreadable' } });
    expect(checkPickedFile(picked({ size: FILE_MAX_BYTES })).ok).toBe(true);
  });

  it('falls back to the extension when the OS reports a generic type (ChordPro, m4a)', () => {
    expect(checkPickedFile(picked({ name: 'song.cho', mimeType: 'application/octet-stream' }))).toMatchObject({ ok: true, mimeType: 'text/plain' });
    expect(checkPickedFile(picked({ name: 'take.m4a', mimeType: null }))).toMatchObject({ ok: true, mimeType: 'audio/mp4' });
  });

  it('words every refusal from the shared catalog', () => {
    expect(fileUploadFailureMessage({ kind: 'unsupportedType' })).toEqual({ key: 'media:upload.unsupportedType' });
    expect(fileUploadFailureMessage({ kind: 'tooLarge', maxBytes: FILE_MAX_BYTES })).toEqual({
      key: 'media:upload.tooLarge',
      values: { size: '25.0 MB' },
    });
    expect(fileUploadFailureMessage({ kind: 'unreadable' })).toEqual({ key: 'media:mobileFiles.unreadable' });
    expect(fileUploadFailureMessage({ kind: 'interrupted', error: new TypeError('Network request failed') })).toBeNull();
  });
});

describe('MOB-026 upload intent bodies (the shared schema the API validates)', () => {
  it('builds a new-file intent with owner, audience and a category from the type', () => {
    const body = uploadIntentRequest(
      { kind: 'new', owner: OWNER, audience: 'teams', teamIds: ['00000000-0000-4000-8000-0000000000d1'], positionIds: [] },
      { name: 'chart.pdf', size: 2048 },
      'application/pdf',
      KEY,
    );
    expect(createFileUploadIntentSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ owner: OWNER, category: 'chart', audience: 'teams', idempotency_key: KEY, size_bytes: 2048 });
  });

  it('builds a replacement against the revision that was shown (stale ones are refused by the server)', () => {
    const body = uploadIntentRequest({ kind: 'replace', file: summary() }, { name: 'chart-v2.pdf', size: 4096 }, 'application/pdf', KEY);
    expect(createFileUploadIntentSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      file_id: FILE_ID,
      expected_revision: 3,
      filename: 'chart-v2.pdf',
      mime_type: 'application/pdf',
      size_bytes: 4096,
      idempotency_key: KEY,
    });
    expect('audience' in body).toBe(false);
  });

  it('refuses a teams/positions audience with nothing chosen before sending (schema agrees)', () => {
    expect(audienceTargetsMissing({ audience: 'teams', teamIds: [], positionIds: [] })).toBe(true);
    expect(audienceTargetsMissing({ audience: 'positions', teamIds: [], positionIds: [] })).toBe(true);
    expect(audienceTargetsMissing({ audience: 'leaders', teamIds: [], positionIds: [] })).toBe(false);
    const body = uploadIntentRequest(
      { kind: 'new', owner: OWNER, audience: 'teams', teamIds: [], positionIds: [] },
      { name: 'a.pdf', size: 1 },
      'application/pdf',
      KEY,
    );
    expect(createFileUploadIntentSchema.safeParse(body).success).toBe(false);
  });
});

describe('MOB-026 upload lifecycle (intent → signed PUT → finalize)', () => {
  it('is only done once finalize says ready, reporting each step', async () => {
    const { io, calls } = fakeIO({ intents: [intent()], finals: [finalized('ready')] });
    const states: FileUploadState[] = [];
    const run = await runFileUpload(pending(), io, (state) => states.push(state));
    expect(phases(states)).toEqual(['preparing', 'uploading', 'uploading', 'uploading', 'finalizing']);
    expect(run.state.phase).toBe('done');
    expect(run.keepPending).toBe(false);
    expect(calls.intents).toHaveLength(1);
    expect(calls.finals).toEqual([pendingVersion.id]);
  });

  it('a failed PUT keeps the intent; retry re-sends the bytes with the same key, never a second intent', async () => {
    const { io, calls } = fakeIO({ intents: [intent()], puts: [new TypeError('Network request failed')], finals: [finalized('ready')] });
    const job = pending();
    const first = await runFileUpload(job, io, () => undefined);
    expect(first.state).toMatchObject({ phase: 'failed', retryable: true, failure: { kind: 'interrupted' } });
    expect(first.keepPending).toBe(true);
    expect(job.intent).not.toBeNull();
    const second = await runFileUpload(job, io, () => undefined);
    expect(second.state.phase).toBe('done');
    expect(calls.intents).toHaveLength(1);
    expect(calls.puts).toBe(2);
  });

  it('a lost intent answer retries with the same idempotency key (the server replays one file)', async () => {
    const { io, calls } = fakeIO({ intents: [new TypeError('Network request failed'), intent()], finals: [finalized('ready')] });
    const job = pending();
    expect((await runFileUpload(job, io, () => undefined)).state.phase).toBe('failed');
    expect((await runFileUpload(job, io, () => undefined)).state.phase).toBe('done');
    expect(calls.intents.map((body) => body.idempotency_key)).toEqual([KEY, KEY]);
  });

  it('bytes that already landed (Storage 409) go straight to finalize', async () => {
    const { io, calls } = fakeIO({
      intents: [intent()],
      puts: [new StorageUploadError(409, '{"error":"Duplicate","message":"The resource already exists"}')],
      finals: [finalized('ready')],
    });
    expect((await runFileUpload(pending(), io, () => undefined)).state.phase).toBe('done');
    expect(calls.finals).toHaveLength(1);
  });

  it('a replayed intent whose bytes are stored skips the PUT', async () => {
    const { io, calls } = fakeIO({ intents: [intent(false)], finals: [finalized('ready')] });
    expect((await runFileUpload(pending(), io, () => undefined)).state.phase).toBe('done');
    expect(calls.puts).toBe(0);
  });

  it('a failed finalize answer is retried by finalizing the same version again', async () => {
    const { io, calls } = fakeIO({
      intents: [intent()],
      puts: [null, new StorageUploadError(400, 'The resource already exists')],
      finals: [new TypeError('Network request failed'), finalized('ready')],
    });
    const job = pending();
    expect((await runFileUpload(job, io, () => undefined)).state).toMatchObject({ phase: 'failed', retryable: true });
    expect((await runFileUpload(job, io, () => undefined)).state.phase).toBe('done');
    expect(calls.finals).toEqual([pendingVersion.id, pendingVersion.id]);
  });

  it('not_uploaded can be retried; size/type mismatch and superseded cannot and are never shown as saved', async () => {
    const notYet = await runFileUpload(pending(), fakeIO({ intents: [intent()], finals: [finalized('not_uploaded')] }).io, () => undefined);
    expect(notYet).toMatchObject({ state: { phase: 'failed', retryable: true }, keepPending: true });

    for (const reason of ['size_mismatch', 'type_mismatch', 'superseded'] as const) {
      const run = await runFileUpload(pending(), fakeIO({ intents: [intent()], finals: [finalized('failed', reason)] }).io, () => undefined);
      expect(run).toMatchObject({ state: { phase: 'failed', retryable: false }, keepPending: false });
      if (run.state.phase === 'failed') {
        expect(fileUploadFailureMessage(run.state.failure)).toEqual({
          key: `media:uploadOutcome.${reason === 'size_mismatch' ? 'sizeMismatch' : reason === 'type_mismatch' ? 'typeMismatch' : 'superseded'}`,
        });
      }
    }
    const expired = await runFileUpload(pending(), fakeIO({ intents: [intent()], finals: [finalized('expired')] }).io, () => undefined);
    expect(expired.state).toMatchObject({ phase: 'failed', retryable: false });
  });

  it('a stale replacement or revoked right is a refusal, not a retry', async () => {
    const stale = new ApiError(409, 'Someone changed this file', 'file_revision_stale');
    const run = await runFileUpload(
      pending({ destination: { kind: 'replace', file: summary({ can_edit: true }) } }),
      fakeIO({ intents: [stale] }).io,
      () => undefined,
    );
    expect(run).toMatchObject({ state: { phase: 'failed', retryable: false, failure: { kind: 'refused' } }, keepPending: false });
    if (run.state.phase === 'failed') expect(fileUploadFailureMessage(run.state.failure)).toEqual({ key: 'media:fileErrors.revisionStale' });

    const revoked = await runFileUpload(pending(), fakeIO({ intents: [new ApiError(403, 'Forbidden')] }).io, () => undefined);
    if (revoked.state.phase === 'failed') expect(fileUploadFailureMessage(revoked.state.failure)).toEqual({ key: 'media:fileErrors.forbidden' });
    // A rate limit is still worth retrying.
    const limited = await runFileUpload(pending(), fakeIO({ intents: [new ApiError(429, 'Slow down')] }).io, () => undefined);
    expect(limited.state).toMatchObject({ phase: 'failed', retryable: true });
  });

  it('cancelling mid-PUT returns to idle without finalizing', async () => {
    const { io, calls } = fakeIO({ intents: [intent()], puts: [new UploadCancelledError()] });
    const run = await runFileUpload(pending(), io, () => undefined);
    expect(run).toEqual({ state: { phase: 'idle' }, keepPending: false });
    expect(calls.finals).toHaveLength(0);
  });
});

describe('MOB-026 preview and share rights', () => {
  it('chooses a preview per kind and type; unsupported types stay explicitly unpreviewed', () => {
    const at = (mime_type: string) => filePreviewMode(summary(), version({ mime_type }));
    expect(at('application/pdf')).toBe('browser');
    expect(at('audio/mpeg')).toBe('browser');
    expect(at('video/mp4')).toBe('browser');
    expect(at('text/plain')).toBe('browser');
    expect(at('image/png')).toBe('image');
    expect(at('image/heic')).toBe('browser');
    expect(at('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('none');
    expect(at('application/vnd.recordare.musicxml+xml')).toBe('none');
    expect(filePreviewMode(summary({ kind: 'document' }), version({ mime_type: 'text/markdown' }))).toBe('document');
    expect(filePreviewMode(summary({ kind: 'link', external_url: 'https://example.com/a', current_version: null }), null)).toBe('external');
    expect(filePreviewMode(summary({ current_version: null }), null)).toBe('none');
  });

  it('offers a copy only for finished uploads, and a play-only file only to writers', () => {
    expect(canSaveCopy(summary(), version())).toBe(true);
    expect(canSaveCopy(summary({ playback_rights: 'stream_only' }), version())).toBe(false);
    expect(canSaveCopy(summary({ playback_rights: 'stream_only', can_edit: true }), version())).toBe(true);
    expect(canSaveCopy(summary({ kind: 'link' }), null)).toBe(false);
    expect(canSaveCopy(summary({ kind: 'document' }), version())).toBe(false);
    expect(canSaveCopy(summary(), null)).toBe(false);
    expect(canSaveCopy(summary(), version({ status: 'pending' }))).toBe(false);
  });

  it('maps refusals to the website wording and drops the file on lost access', () => {
    expect(fileErrorMessage(new ApiError(403, 'x', 'file_stream_only'))).toEqual({ key: 'media:fileErrors.streamOnly' });
    expect(fileErrorMessage(new ApiError(404, 'x'))).toEqual({ key: 'media:fileErrors.notFound' });
    expect(fileErrorMessage(new ApiError(403, 'x'))).toEqual({ key: 'media:fileErrors.forbidden' });
    expect(fileErrorMessage(new ApiError(409, 'x', 'file_in_use'))).toBeNull();
    expect(fileErrorMessage(new TypeError('Network request failed'))).toBeNull();
    // Revoked download (narrowed audience, archived, deleted) → refresh and hide.
    expect(isFileAccessLost(new ApiError(404, 'x'))).toBe(true);
    // Play-only: the file is still readable, only the copy is refused.
    expect(isFileAccessLost(new ApiError(403, 'x', 'file_stream_only'))).toBe(false);
    expect(isFileAccessLost(new TypeError('offline'))).toBe(false);
  });

  it('keeps share file names inside the share folder', () => {
    expect(safeShareFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeShareFileName('..')).toBe('file');
    expect(safeShareFileName('Chart: v2?.pdf')).toBe('Chart_ v2_.pdf');
    expect(safeShareFileName('')).toBe('file');
    expect(linkHost('https://youtu.be/x')).toBe('youtu.be');
    expect(linkHost('not a url')).toBeNull();
  });
});

describe('MOB-026 plan entries and F15 key scope', () => {
  const entry = (overrides: Partial<PlanFileEntry>): PlanFileEntry => ({
    file: summary(),
    source: 'plan',
    plan_item_id: null,
    link: null,
    version: version(),
    newer_version_available: false,
    ...overrides,
  });
  const link = (pinned: string | null): NonNullable<PlanFileEntry['link']> => ({
    id: '00000000-0000-4000-8000-0000000000e1',
    attachment_id: FILE_ID,
    plan_id: '00000000-0000-4000-8000-0000000000e2',
    plan_item_id: null,
    pinned_version_id: pinned,
    source: 'service_type_default',
    created_at: '2026-10-20T10:00:00Z',
  });

  it('groups by plan and item and hides an archived, unlinked plan file (website rule)', () => {
    const groups = groupPlanFiles([
      entry({}),
      entry({ file: summary({ id: 'archived', archived_at: '2026-10-21T00:00:00Z' }) }),
      entry({ file: summary({ id: 'pinned-archived', archived_at: '2026-10-21T00:00:00Z' }), link: link('v1') }),
      entry({ plan_item_id: 'item-1', source: 'arrangement' }),
    ]);
    expect(groups.plan.map((item) => item.file.id)).toEqual([FILE_ID, 'pinned-archived']);
    expect(groups.items.get('item-1')).toHaveLength(1);
  });

  it('shows pinned and newer-version state, and offers the website link actions to editors only', () => {
    const pinnedOld = entry({ link: link('v1'), newer_version_available: true });
    expect(planFileBadges(pinnedOld)).toEqual([{ kind: 'serviceTypeDefault' }, { kind: 'pinnedTo', number: 1 }, { kind: 'newerAvailable' }]);
    expect(planLinkActions(pinnedOld, true)).toEqual(['useNewest', 'followNewest', 'removeFromPlan']);
    expect(planLinkActions(entry({ link: link(null) }), true)).toEqual(['pinCurrent', 'removeFromPlan']);
    expect(planLinkActions(pinnedOld, false)).toEqual([]);
    expect(planLinkActions(entry({}), true)).toEqual([]);
  });

  it('labels arrangement files with the labeled keys they serve', () => {
    const materials: ArrangementMaterials = {
      keys: [
        { id: 'k-high', arrangement_id: 'a', label: 'High', song_key: 'E', capo: null, vocal_label: null, file_ids: [FILE_ID], revision: 1, created_at: '' },
        { id: 'k-low', arrangement_id: 'a', label: 'Low', song_key: 'C', capo: 2, vocal_label: null, file_ids: [], revision: 1, created_at: '' },
      ],
      files: [
        { id: FILE_ID, title: 'Chart', revision: 3, key_ids: ['k-high'], reused: false },
        { id: 'general', title: 'Lyrics', revision: 1, key_ids: [], reused: false },
      ],
    };
    expect(fileKeyLabels(materials, FILE_ID)).toEqual(['High — E']);
    expect(fileKeyLabels(materials, 'general')).toEqual([]);
    expect(fileKeyLabels(undefined, FILE_ID)).toEqual([]);
  });
});

describe('MOB-026 source contract', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');
  const sources = {
    upload: read('src', 'lib', 'file-upload.ts'),
    view: read('src', 'lib', 'file-view.ts'),
    transfer: read('src', 'lib', 'file-transfer.ts'),
    pick: read('src', 'lib', 'file-pick.ts'),
    uploadHook: read('src', 'lib', 'useFileUpload.ts'),
    openHook: read('src', 'lib', 'useFileOpen.ts'),
    add: read('app', 'files', 'add.tsx'),
    detail: read('app', 'files', '[id].tsx'),
    planFiles: read('src', 'components', 'files', 'PlanFiles.tsx'),
    songFiles: read('src', 'components', 'files', 'SongFiles.tsx'),
    audience: read('src', 'components', 'files', 'AudiencePicker.tsx'),
  };
  const all = Object.values(sources).join('\n');

  it('uses only the existing shared F13/F15 client methods', () => {
    const used = new Set([...all.matchAll(/\bapi\.(\w+)\(/g)].map((match) => match[1]));
    expect([...used].sort()).toEqual(
      [
        'abandonFileUpload',
        'archiveFile',
        'createFileDocument',
        'createFileLink',
        'createFileUploadIntent',
        'file',
        'fileDocument',
        'fileDownload',
        'files',
        'finalizeFile',
        'getArrangementMaterials',
        'linkFileToPlan',
        'listTeams',
        'planFiles',
        'setFileLinkPin',
        'unlinkFile',
      ].sort(),
    );
    // No locally redefined wire shapes and no direct table/Storage access.
    expect(all).not.toMatch(/supabase\.(from|storage)/);
    expect(all).not.toMatch(/interface (FileSummary|FileDetail|PlanFileEntry|FileUploadIntent)\b/);
  });

  it('sends bytes only to the signed path, unchanged, without overwriting', () => {
    expect(sources.transfer).toContain('target.signed_url');
    expect(sources.transfer).toContain("httpMethod: 'PUT'");
    expect(sources.transfer).toContain('UploadType.BINARY_CONTENT');
    expect(sources.transfer).toContain("'x-upsert': 'false'");
  });

  it('asks for an attachment link only to share, from a button, and deletes the copy afterwards', () => {
    expect(sources.openHook.match(/disposition: 'attachment'/g)).toHaveLength(1);
    expect(sources.transfer).toMatch(/finally \{\s*clearSharedCopies\(\);/);
    expect(sources.transfer).toContain('Paths.cache');
    expect(sources.detail).toMatch(/onPress=\{\(\) => void share\(\)\}/);
    // Nothing about a share is written to the server.
    expect(sources.openHook).not.toMatch(/api\.(create|update|record)/);
  });

  it('never stores or logs file links', () => {
    expect(all).not.toMatch(/console\./);
    expect(all).not.toContain('AsyncStorage');
    expect(all).not.toMatch(/setQueryData/);
  });

  it('drops late results after an identity change', () => {
    expect((sources.uploadHook.match(/isCurrentGeneration\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((sources.openHook.match(/isCurrentGeneration\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(sources.detail).toContain('isCurrentGeneration(');
  });

  it('keeps file queries under the account/organization/generation scope', () => {
    expect(all).toMatch(/queryKeys\.planFiles\(queryScope/);
    expect(all).toMatch(/queryKeys\.parentFiles\(queryScope/);
    expect(all).toMatch(/queryKeys\.file\(queryScope/);
    expect(all).not.toMatch(/queryKey: \['files'/);
  });
});
