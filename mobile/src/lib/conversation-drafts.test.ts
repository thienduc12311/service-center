import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConversationDraftStore, type ConversationDraft } from './conversation-drafts';
import type { ProtectedQueryScope } from './session-lifecycle';

const scope: ProtectedQueryScope = { generation: 1, userId: 'user-a', organizationId: 'org-a' };
const draft: ConversationDraft = { id: 'draft-1', body: 'See you at 7', mentionIds: ['riley'], replyToId: null };

describe('ConversationDraftStore', () => {
  it('keeps a draft and its message id per conversation for the same identity', () => {
    const store = new ConversationDraftStore();
    store.set(scope, 'band', draft);
    expect(store.get(scope, 'band')).toEqual(draft);
    expect(store.get(scope, 'prod')).toBeNull();
  });

  it('never offers a draft to another account, organization or session generation', () => {
    for (const other of [
      { ...scope, userId: 'user-b' },
      { ...scope, organizationId: 'org-b' },
      { ...scope, generation: 2 },
    ]) {
      const store = new ConversationDraftStore();
      store.set(scope, 'band', draft);
      expect(store.get(other, 'band')).toBeNull();
      // Switching back does not resurrect it either: the old identity's drafts were dropped.
      expect(store.get(scope, 'band')).toBeNull();
    }
  });

  it('drops empty drafts and cleared ones, and ignores a signed-out scope', () => {
    const store = new ConversationDraftStore();
    store.set(scope, 'band', { ...draft, body: '  ', mentionIds: [] });
    expect(store.get(scope, 'band')).toBeNull();
    store.set(scope, 'band', draft);
    store.clear(scope, 'band');
    expect(store.get(scope, 'band')).toBeNull();
    store.set(null, 'band', draft);
    expect(store.get(null, 'band')).toBeNull();
  });

  it('keeps a reply-only draft so the reply target is not lost', () => {
    const store = new ConversationDraftStore();
    store.set(scope, 'band', { ...draft, body: '', mentionIds: [], replyToId: 'm1' });
    expect(store.get(scope, 'band')?.replyToId).toBe('m1');
  });
});

describe('MOB-019 conversation screens (source contract)', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', 'app', ...parts), 'utf8');
  const thread = read('chat', '[id].tsx');
  const list = readFileSync(join(__dirname, '..', 'components', 'ChatList.tsx'), 'utf8');

  it('posts once per draft id, replacing it only after confirmation or an id conflict', () => {
    expect(thread.match(/api\.postConversationMessage\(/g)).toHaveLength(1);
    expect(thread).toMatch(/id: sent\.id/);
    // New ids come only from the confirmed/arrived path and the 409 message_id_conflict path.
    expect(thread).toContain("outcome === 'newId'");
    expect(thread).toContain('conversationPostOutcome(error)');
    expect(thread).not.toMatch(/\.(map|forEach)\([^)]*postConversationMessage/s);
  });

  it('marks read only with the newest message measured on screen, never the current time', () => {
    expect(thread).toContain('conversationReadMark(measured.current.shown, state.unread, lastMarked.current)');
    expect(thread).toContain('if (!state.visible || state.searching || !state.open || !measured.current.atBottom) return;');
    // The end counts as shown only from layout/scroll measurements, and starts as not shown.
    expect(thread).toContain('offset + viewport >= content - BOTTOM_SLOP');
    expect(thread).toContain("useRef<{ atBottom: boolean; shown: readonly ConversationMessage[] }>({ atBottom: false, shown: [] })");
    expect(thread).toContain('laidOut.current = rendered.current');
    expect(thread).not.toMatch(/markConversationRead\([^)]*new Date/);
  });

  it('polls only while visible and drops the thread when access is gone', () => {
    expect(thread).toContain('refetchInterval: visible ? CONVERSATION_THREAD_POLL_MS : false');
    expect(thread).toContain("access === 'unavailable' ? null");
    expect(thread).toMatch(/if \(access !== 'unavailable'\) return;\s*setKnown\(\[\]\)/);
  });

  it('merges pages by message id and uses the shared action rules', () => {
    expect(thread).toContain('mergeConversationPages(');
    expect(thread).toContain('conversationMessageActions(message, conversation)');
    expect(thread).toContain('api.muteConversation(');
    expect(thread).toContain('api.resolveConversationReport(');
  });

  it('keeps the draft only in memory, scoped to the signed-in identity', () => {
    const store = readFileSync(join(__dirname, 'conversation-drafts.ts'), 'utf8');
    expect(store).not.toMatch(/AsyncStorage|SecureStore|localStorage/);
    expect(thread).toContain('conversationDrafts.get(queryScope, conversationId)');
  });

  it('opens team chats through the server and polls the list like the website', () => {
    expect(list).toContain("api.openConversation({ kind: 'team'");
    expect(list).toContain('refetchInterval: CONVERSATION_LIST_POLL_MS');
    expect(list).toContain('chatStartableTeams(');
  });
});
