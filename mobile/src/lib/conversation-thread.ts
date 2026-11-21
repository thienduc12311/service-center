import {
  isBeforeKeysetCursor,
  mergeConversationPages,
  type ConversationMessage,
  type DiscussionPage,
} from '@service-center/shared';

export interface ConversationHistory extends DiscussionPage<ConversationMessage> {
  /** The newest-page cursor from which this history was read. */
  before: string | null;
}

interface HistoryRequest {
  before: string | null;
  previous?: ConversationHistory;
  expand: boolean;
  loadPage: (before: string) => Promise<DiscussionPage<ConversationMessage>>;
}

/** Re-read through the oldest already visible message, even when new rows shift page boundaries. */
export async function readConversationHistory({ before, previous, expand, loadPage }: HistoryRequest): Promise<ConversationHistory> {
  const append = expand && previous?.before === before;
  let cursor = append ? previous.next_before : before;
  const data = append ? [...previous.data] : [];
  const oldest = append ? null : previous?.data[0]?.created_at ?? null;
  let extendAfterRefresh = expand && !append && oldest !== null;

  while (cursor) {
    const page = await loadPage(cursor);
    data.push(...page.data);
    cursor = page.next_before;
    const first = page.data[0];
    if (oldest && first && first.created_at > oldest) continue;
    if (!extendAfterRefresh) break;
    extendAfterRefresh = false;
  }
  return { before, data: mergeConversationPages([], data), next_before: cursor };
}

/** Keep rows pushed off the newest page during a delayed history read, then replace them from the API. */
export function conversationWindow(
  newest: DiscussionPage<ConversationMessage>,
  history: ConversationHistory | undefined,
  previous: readonly ConversationMessage[],
): ConversationMessage[] {
  const before = newest.next_before;
  if (!before) return newest.data;
  const historyStart = history?.before;
  // Cursors are `<created_at>~<id>`: compare on both, never as text against created_at.
  const adjacent = previous.filter((message) =>
    isBeforeKeysetCursor(message, before) && (!historyStart || !isBeforeKeysetCursor(message, historyStart)));
  const older = history?.data.filter((message) => isBeforeKeysetCursor(message, before)) ?? [];
  return mergeConversationPages(mergeConversationPages(older, adjacent), newest.data);
}
