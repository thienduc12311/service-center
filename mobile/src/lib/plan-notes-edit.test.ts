import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError, planNoteDraftFrom, type NoteCategoryRow, type PlanItemComment } from '@service-center/shared';
import {
  commentNeedsNewId,
  draftWithoutWithdrawnCategory,
  mergeCommentPages,
  noteWriteOutcome,
  threadAccess,
} from './plan-notes-edit';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const category = (n: number): NoteCategoryRow => ({
  id: id(n),
  organization_id: id(90),
  service_type_id: null,
  name: `Category ${n}`,
  default_audience: 'organization',
  sort_order: 0,
  archived_at: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const comment = (n: number, createdAt: string, body = `c${n}`): PlanItemComment => ({
  id: id(n),
  organization_id: id(90),
  plan_id: id(91),
  plan_item_id: id(92),
  author_id: id(93),
  author_person_id: null,
  body,
  edited_at: null,
  deleted_at: null,
  deleted_by: null,
  created_at: createdAt,
  author_name: 'Sam',
  mentions: [],
  is_mine: false,
});

describe('noteWriteOutcome', () => {
  it('maps the F09 answers to what the editor shows', () => {
    expect(noteWriteOutcome(new ApiError(409, 'x', 'note_stale'))).toBe('stale');
    expect(noteWriteOutcome(new ApiError(404, 'Note not found'))).toBe('gone');
    expect(noteWriteOutcome(new ApiError(400, 'This note category is archived'))).toBe('refused');
    expect(noteWriteOutcome(new ApiError(403, 'x'))).toBe('refused');
    expect(noteWriteOutcome(new TypeError('Network request failed'))).toBe('uncertain');
  });
});

describe('draftWithoutWithdrawnCategory', () => {
  const draft = { ...planNoteDraftFrom(null, null), body: 'x', categoryId: id(1) };

  it('drops a newly chosen category that is no longer offered', () => {
    expect(draftWithoutWithdrawnCategory(draft, null, [category(2)])).toEqual({ ...draft, categoryId: null });
  });

  it('keeps a category that is still offered, General, or the one the note already had', () => {
    expect(draftWithoutWithdrawnCategory(draft, null, [category(1)])).toBeNull();
    expect(draftWithoutWithdrawnCategory({ ...draft, categoryId: null }, null, [])).toBeNull();
    // An archived category stays on a note that already uses it (the server allows it).
    expect(draftWithoutWithdrawnCategory(draft, { category_id: id(1) }, [])).toBeNull();
  });
});

describe('threadAccess', () => {
  it('treats not-found and forbidden as "only for people on this plan", other failures as retryable', () => {
    expect(threadAccess(null)).toBe('open');
    expect(threadAccess(new ApiError(404, 'This discussion is only open to people on this plan'))).toBe('unavailable');
    expect(threadAccess(new ApiError(403, 'x'))).toBe('unavailable');
    expect(threadAccess(new ApiError(500, 'x'))).toBe('error');
    expect(threadAccess(new TypeError('Network request failed'))).toBe('error');
  });
});

describe('mergeCommentPages', () => {
  it('keeps older pages, lets the re-read newest page win and orders oldest first', () => {
    const older = [comment(1, '2026-10-01T10:00:00Z'), comment(2, '2026-10-01T10:01:00Z')];
    const firstPage = [comment(3, '2026-10-01T10:02:00Z'), comment(4, '2026-10-01T10:03:00Z')];
    const known = mergeCommentPages(older, firstPage);
    // After a post the newest page no longer holds 3; it must not disappear.
    const reread = [comment(4, '2026-10-01T10:03:00Z', 'edited'), comment(5, '2026-10-01T10:04:00Z')];
    const merged = mergeCommentPages(known, reread);
    expect(merged.map((c) => c.body)).toEqual(['c1', 'c2', 'c3', 'edited', 'c5']);
  });

  it('breaks same-instant ties by id so the order is stable', () => {
    const at = '2026-10-01T10:00:00Z';
    expect(mergeCommentPages([comment(9, at)], [comment(8, at)]).map((c) => c.id)).toEqual([id(8), id(9)]);
  });
});

describe('commentNeedsNewId', () => {
  it('keeps the draft id after no answer or a refusal, and replaces it only on an id conflict', () => {
    expect(commentNeedsNewId(new TypeError('Network request failed'))).toBe(false);
    expect(commentNeedsNewId(new ApiError(422, 'x', 'validation_error'))).toBe(false);
    expect(commentNeedsNewId(new ApiError(409, 'x', 'comment_id_conflict'))).toBe(true);
  });
});

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

describe('native notes source', () => {
  const root = join(__dirname, '..', '..');
  const files = [...sourceFiles(join(root, 'app')), ...sourceFiles(join(root, 'src'))];
  const text = files.map((file) => readFileSync(file, 'utf8'));

  it('never writes the unrevisioned plans.notes string', () => {
    // Notes are saved only through the revisioned F09 note methods.
    expect(text.some((source) => /updatePlan\([^)]*\bnotes\s*:/s.test(source))).toBe(false);
    expect(text.some((source) => /createPlan\([^)]*\bnotes\s*:/s.test(source))).toBe(false);
  });

  it('never filters notes by audience on the phone (the server returns only readable notes)', () => {
    expect(text.some((source) => /\.filter\([^)]*\.audience\b/.test(source))).toBe(false);
  });
});
