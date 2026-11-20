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
    conversations: vi.fn(),
    getConversation: vi.fn(),
    listTeams: vi.fn(),
    mentionCandidates: vi.fn(),
    postConversationMessage: vi.fn(),
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

const renderChat = () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  vi.mocked(api.conversations).mockResolvedValue([thread.conversation]);
  vi.mocked(api.getConversation).mockResolvedValue(thread);
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
