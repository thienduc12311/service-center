import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConversationDetail, ConversationMessage } from '@service-center/shared';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { api } from '../lib/api';
import { ChatPage } from './ChatPage';

vi.mock('../lib/api', () => ({
  getStoredOrganizationId: () => 'org-1',
  api: {
    conversationsPage: vi.fn(),
    getConversation: vi.fn(),
    listTeams: vi.fn(),
    mentionCandidates: vi.fn(),
    postConversationMessage: vi.fn(),
    conversationMessages: vi.fn(),
    markConversationRead: vi.fn(),
    blockUser: vi.fn(),
  },
}));
vi.mock('../providers/AuthProvider', () => ({
  useAuth: () => ({ organizationId: 'org-1', session: { user: { id: 'account-1' } }, can: () => true }),
}));
vi.mock('../hooks/useBroadcastRefresh', () => ({ useBroadcastRefresh: vi.fn() }));
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'account-1' } } } }) } },
}));

const thread: ConversationDetail = {
  conversation: {
    id: 'thread-1', kind: 'team', team_id: 'team-1', plan_id: null, title: 'Production',
    service_date: null, last_message_at: null, unread_count: 0, muted: false, can_moderate: false, open_reports: 0,
  },
  messages: { data: [], next_before: null },
  reports: [],
};

const message = (id: string, body: string): ConversationMessage => ({
  id, body, organization_id: 'org-1', conversation_id: 'thread-1', author_id: 'account-1',
  author_person_id: null, reply_to_id: null, edited_at: null, deleted_at: null, hidden_at: null,
  hidden_by: null, created_at: '2026-11-20T00:00:00Z', author_name: 'App', mentions: [], is_mine: true,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};

type ConversationsPage = Awaited<ReturnType<typeof api.conversationsPage>>;

const renderChat = (listPage: (cursor: string | undefined) => ConversationsPage = () => (
  { items: [thread.conversation], next_cursor: null, has_more: false }
), detail: ConversationDetail = thread) => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  vi.mocked(api.conversationsPage).mockImplementation(async (query) => listPage(query?.cursor));
  vi.mocked(api.getConversation).mockResolvedValue(detail);
  vi.mocked(api.listTeams).mockResolvedValue([]);
  vi.mocked(api.mentionCandidates).mockResolvedValue([]);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/chat/thread-1']}>
          <Routes>
            <Route path="/chat/:conversationId" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('web chat sending', () => {
  it('shows pending messages and accepts another send while the request and refresh are slow', async () => {
    const user = renderChat();
    const first = deferred<Awaited<ReturnType<typeof api.postConversationMessage>>>();
    const second = deferred<Awaited<ReturnType<typeof api.postConversationMessage>>>();
    const refresh = deferred<ConversationDetail>();
    vi.mocked(api.postConversationMessage).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const input = await screen.findByRole('textbox', { name: 'Message Production…' }) as HTMLTextAreaElement;

    await user.type(input, 'First message');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const firstBubble = (await screen.findByText('First message')).closest('li')!;
    expect(within(firstBubble).getByRole('status').textContent).toBe('Sending');
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);

    await user.type(input, 'Second message');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Second message')).toBeTruthy();
    const [[, firstDraft], [, secondDraft]] = vi.mocked(api.postConversationMessage).mock.calls as [
      Parameters<typeof api.postConversationMessage>, Parameters<typeof api.postConversationMessage>,
    ];
    expect(firstDraft.id).not.toBe(secondDraft.id);
    expect(screen.getAllByRole('status').map((status) => status.textContent)).toEqual(['Sending', 'Sending']);

    vi.mocked(api.getConversation).mockReturnValue(refresh.promise);
    await act(async () => second.resolve({ item: message(secondDraft.id, secondDraft.body), replayed: false }));
    await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(1));
    await act(async () => first.resolve({ item: message(firstDraft.id, firstDraft.body), replayed: false }));
    await waitFor(() => expect(screen.queryByText('Sending')).toBeNull());
    expect(screen.getAllByText('First message')).toHaveLength(1);
    expect(screen.getAllByText('Second message')).toHaveLength(1);

    await act(async () => refresh.resolve({
      ...thread, messages: { data: [message(firstDraft.id, firstDraft.body), message(secondDraft.id, secondDraft.body)], next_before: null },
    }));
    expect(screen.getAllByText('First message')).toHaveLength(1);
    expect(screen.getAllByText('Second message')).toHaveLength(1);
  });

  it('keeps a failed message available and retries with the same id', async () => {
    const user = renderChat();
    vi.mocked(api.postConversationMessage)
      .mockRejectedValueOnce(new Error('Connection dropped'))
      .mockImplementationOnce(async (_threadId, draft) => ({ item: message(draft.id, draft.body), replayed: true }));
    const input = await screen.findByRole('textbox', { name: 'Message Production…' });
    await user.type(input, 'Retry this message');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    const entry = (await screen.findByText('Retry this message')).closest('li')!;
    const retry = await within(entry).findByRole('button', { name: 'Try again' });
    const serverRefresh = deferred<ConversationDetail>();
    vi.mocked(api.getConversation).mockReturnValue(serverRefresh.promise);
    await user.click(retry);

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(api.postConversationMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.postConversationMessage).mock.calls[1]).toEqual(vi.mocked(api.postConversationMessage).mock.calls[0]);
    expect(screen.getAllByText('Retry this message')).toHaveLength(1);
  });
});

describe('web chat list paging', () => {
  it('loads the next page of conversations with the previous cursor', async () => {
    const second = { ...thread.conversation, id: 'thread-2', title: 'Worship band' };
    const user = renderChat((cursor) => (cursor
      ? { items: [second], next_cursor: null, has_more: false }
      : { items: [thread.conversation], next_cursor: 'cursor-1', has_more: true }));
    const more = await screen.findByRole('button', { name: 'Load more conversations' });
    expect(screen.queryByText('Worship band')).toBeNull();

    await user.click(more);
    expect(await screen.findByText('Worship band')).toBeTruthy();
    expect(vi.mocked(api.conversationsPage).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ cursor: 'cursor-1' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more conversations' })).toBeNull());
  });
});

describe('web chat thread history and search', () => {
  it('loads older messages above the newest page with the thread cursor', async () => {
    const user = renderChat(undefined, {
      ...thread, messages: { data: [{ ...message('m-new', 'Newest message'), created_at: '2026-11-20T10:00:00Z' }], next_before: 'cursor-older' },
    });
    vi.mocked(api.conversationMessages).mockResolvedValue({
      data: [{ ...message('m-old', 'Older message'), created_at: '2026-11-19T10:00:00Z' }], next_before: null,
    });
    await user.click(await screen.findByRole('button', { name: 'Load older messages' }));
    expect(await screen.findByText('Older message')).toBeTruthy();
    expect(api.conversationMessages).toHaveBeenCalledWith('thread-1', { before: 'cursor-older', limit: 30 });
    expect(screen.getByText('Newest message')).toBeTruthy();
    const bodies = screen.getAllByText(/message$/).map((node) => node.textContent);
    expect(bodies.indexOf('Older message')).toBeLessThan(bodies.indexOf('Newest message'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load older messages' })).toBeNull());
  });

  it('shows "Searching" rather than "No matches" until the debounced search answers', async () => {
    const user = renderChat();
    const answer = deferred<Awaited<ReturnType<typeof api.conversationMessages>>>();
    vi.mocked(api.conversationMessages).mockReturnValue(answer.promise);
    await user.type(await screen.findByRole('textbox', { name: 'Search this conversation' }), 'setlist');

    expect(screen.queryByText('No messages match.')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Searching');
    await waitFor(() => expect(api.conversationMessages).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.conversationMessages).mock.calls[0]?.[1]).toEqual({ q: 'setlist', limit: 30 });

    await act(async () => answer.resolve({ data: [], next_before: null }));
    expect(await screen.findByText('No messages match.')).toBeTruthy();
  });

  it('drops a blocked author from loaded history and reply quotes before either page refreshes', async () => {
    const blocked = {
      ...message('m-blocked', 'Private older message'), author_id: 'other-account', author_name: 'Dana',
      is_mine: false, created_at: '2026-11-19T10:00:00Z',
    };
    const kept = { ...message('m-kept', 'Unrelated history'), created_at: '2026-11-19T11:00:00Z' };
    const reply = { ...message('m-reply', 'A reply to Dana'), reply_to_id: blocked.id };
    const user = renderChat(undefined, {
      ...thread, messages: { data: [reply], next_before: 'cursor-older' },
    });
    const historyRefresh = deferred<Awaited<ReturnType<typeof api.conversationMessages>>>();
    const threadRefresh = deferred<ConversationDetail>();
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.mocked(api.conversationMessages)
      .mockResolvedValueOnce({ data: [blocked, kept], next_before: null })
      .mockReturnValue(historyRefresh.promise);
    vi.mocked(api.blockUser).mockResolvedValue({
      blocker_id: 'account-1', blocked_id: blocked.author_id, created_at: new Date().toISOString(),
    });

    await user.click(await screen.findByRole('button', { name: 'Load older messages' }));
    const replyEntry = (await screen.findByText(reply.body)).closest('li')!;
    const blockedEntry = (await screen.findByText(blocked.body, { exact: true })).closest('li')!;
    expect(within(replyEntry).getByText(/Private older message/)).toBeTruthy();
    vi.mocked(api.getConversation).mockReturnValue(threadRefresh.promise);

    await user.click(within(blockedEntry).getByRole('button', { name: /Dana/ }));
    await user.click(within(blockedEntry).getByRole('menuitem', { name: 'Block Dana' }));

    await waitFor(() => expect(screen.queryByText(/Private older message/)).toBeNull());
    expect(api.blockUser).toHaveBeenCalledWith(blocked.author_id);
    expect(screen.getByText(kept.body)).toBeTruthy();
    expect(screen.getByText(reply.body)).toBeTruthy();
    await waitFor(() => expect(api.conversationMessages).toHaveBeenCalledTimes(2));
    await act(async () => {
      historyRefresh.resolve({ data: [kept], next_before: null });
      threadRefresh.resolve({ ...thread, messages: { data: [reply], next_before: 'cursor-older' } });
    });
    expect(screen.queryByText(/Private older message/)).toBeNull();
  });
});

describe('web chat conversation list filters', () => {
  it('narrows the loaded conversations by name and by unread', async () => {
    const band = { ...thread.conversation, id: 'thread-2', title: 'Worship band', unread_count: 2 };
    const user = renderChat(() => ({ items: [thread.conversation, band], next_cursor: null, has_more: false }));
    const list = (await screen.findByRole('link', { name: /Worship band/ })).closest('ul')!;

    await user.type(screen.getByRole('searchbox', { name: 'Search conversations' }), 'prod');
    expect(within(list).queryByRole('link', { name: /Worship band/ })).toBeNull();
    expect(within(list).getByRole('link', { name: /Production/ })).toBeTruthy();

    await user.clear(screen.getByRole('searchbox', { name: 'Search conversations' }));
    await user.click(screen.getByRole('button', { name: 'Unread' }));
    expect(within(list).queryByRole('link', { name: /Production/ })).toBeNull();
    expect(within(list).getByRole('link', { name: /Worship band/ })).toBeTruthy();
  });
});
