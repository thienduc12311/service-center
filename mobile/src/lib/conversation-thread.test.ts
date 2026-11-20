import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { ConversationMessage, DiscussionPage } from '@service-center/shared';
import { describe, expect, it } from 'vitest';
import { conversationWindow, readConversationHistory, type ConversationHistory } from './conversation-thread';
import { queryKeys } from './query-keys';

const stamp = (second: number) => new Date(Date.UTC(2026, 10, 19, 0, 0, second)).toISOString();

function message(second: number, overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: String(second),
    conversation_id: 'chat',
    organization_id: 'church',
    author_id: 'author',
    author_person_id: null,
    author_name: 'Author',
    reply_to_id: null,
    body: String(second),
    edited_at: null,
    deleted_at: null,
    hidden_at: null,
    hidden_by: null,
    created_at: stamp(second),
    mentions: [],
    is_mine: false,
    ...overrides,
  };
}

function page(rows: ConversationMessage[], cursor?: number): DiscussionPage<ConversationMessage> {
  return { data: rows, next_before: cursor === undefined ? null : stamp(cursor) };
}

describe('conversation thread history', () => {
  it('publishes the newest page with TanStack while a background history request is deferred', async () => {
    const scope = { userId: 'user', organizationId: 'church', generation: 1 };
    const queryKey = queryKeys.conversation(scope, 'chat');
    const historyKey = queryKeys.conversationHistory(scope, 'chat');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const first = page([message(4), message(5)], 4);
    const history = { ...page([message(1), message(2), message(3)]), before: stamp(4) };
    client.setQueryData(queryKey, first);
    client.setQueryData(historyKey, history);

    let release: (value: DiscussionPage<ConversationMessage>) => void = () => {};
    const deferred = new Promise<DiscussionPage<ConversationMessage>>((resolve) => { release = resolve; });
    const request = client.fetchQuery({
      queryKey: historyKey,
      queryFn: () => readConversationHistory({ before: stamp(5), previous: history, expand: false, loadPage: () => deferred }),
    });
    const detail = new QueryObserver(client, {
      queryKey,
      queryFn: async () => page([message(5), message(6)], 5),
    });

    const latest = await detail.refetch();
    expect(client.isFetching({ queryKey: historyKey, exact: true })).toBe(1);
    const previous = conversationWindow(first, history, []);
    const shown = conversationWindow(latest.data!, client.getQueryData<ConversationHistory>(historyKey), previous);
    expect(shown.map((row) => row.id)).toEqual(['1', '2', '3', '4', '5', '6']);

    release(page([message(1, { body: 'edited', edited_at: stamp(7) }), message(3, { body: '', hidden_at: stamp(7) }), message(4)]));
    const refreshed = await request;
    const reconciled = conversationWindow(latest.data!, refreshed, shown);
    expect(reconciled.map((row) => row.body)).toEqual(['edited', '', '4', '5', '6']);
    expect(reconciled[1]?.hidden_at).toBe(stamp(7));
    client.clear();
  });

  it('reaches the previous oldest row across shifted pages and pages onward from the new cursor', async () => {
    const previous = { ...page([message(2), message(3)], 2), before: stamp(4) };
    const seen: string[] = [];
    const loadPage = async (before: string) => {
      seen.push(before);
      if (before === stamp(7)) return page([message(5), message(6)], 5);
      if (before === stamp(5)) return page([message(3), message(4)], 3);
      if (before === stamp(3)) return page([message(2)], 2);
      return page([message(1)]);
    };
    const result = await readConversationHistory({ before: stamp(7), previous, expand: false, loadPage });
    expect(seen).toEqual([stamp(7), stamp(5), stamp(3)]);
    expect(result.data.map((row) => row.id)).toEqual(['2', '3', '4', '5', '6']);
    const expanded = await readConversationHistory({ before: stamp(7), previous: result, expand: true, loadPage });
    expect(seen.at(-1)).toBe(stamp(2));
    expect(expanded.data.map((row) => row.id)).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});
