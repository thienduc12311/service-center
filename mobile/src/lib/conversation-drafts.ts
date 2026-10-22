import type { ProtectedQueryScope } from './session-lifecycle';

/**
 * MOB-019: an unsent conversation message. `id` is the message's stable
 * client id: it stays the same until the server confirms the post, so
 * sending again after a lost acknowledgement (even after leaving and
 * reopening the thread) replays the same message instead of posting twice.
 */
export interface ConversationDraft {
  id: string;
  body: string;
  mentionIds: string[];
  replyToId: string | null;
}

/**
 * Drafts kept in memory only (message text never goes to device storage),
 * per signed-in identity: a draft written under one account, organization or
 * session generation is never offered under another.
 */
export class ConversationDraftStore {
  private drafts = new Map<string, ConversationDraft>();
  private scopeKey: string | null = null;

  private keyFor(scope: ProtectedQueryScope, conversationId: string): string {
    const scopeKey = `${scope.userId}:${scope.organizationId}:${scope.generation}`;
    if (scopeKey !== this.scopeKey) {
      // A new identity: everything from the previous one is dropped.
      this.drafts.clear();
      this.scopeKey = scopeKey;
    }
    return `${scopeKey}:${conversationId}`;
  }

  get(scope: ProtectedQueryScope | null, conversationId: string): ConversationDraft | null {
    if (!scope) return null;
    return this.drafts.get(this.keyFor(scope, conversationId)) ?? null;
  }

  /** Keeps a draft while it has text or a pending id worth replaying. */
  set(scope: ProtectedQueryScope | null, conversationId: string, draft: ConversationDraft): void {
    if (!scope) return;
    const key = this.keyFor(scope, conversationId);
    if (!draft.body.trim() && draft.mentionIds.length === 0 && !draft.replyToId) this.drafts.delete(key);
    else this.drafts.set(key, { ...draft, mentionIds: [...draft.mentionIds] });
  }

  clear(scope: ProtectedQueryScope | null, conversationId: string): void {
    if (!scope) return;
    this.drafts.delete(this.keyFor(scope, conversationId));
  }
}

export const conversationDrafts = new ConversationDraftStore();
