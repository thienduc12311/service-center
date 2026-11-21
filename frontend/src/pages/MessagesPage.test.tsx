import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeKeysetCursor, type OperationalMessageSummary } from '@service-center/shared';
import { api } from '../lib/api';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { MESSAGES_PAGE_SIZE } from '../lib/message-paging';
import { MessagesPage } from './MessagesPage';

vi.mock('../lib/api', () => ({
  api: {
    listMessages: vi.fn(),
    listTeams: vi.fn(),
  },
}));
vi.mock('../providers/AuthProvider', () => ({
  useAuth: () => ({ organizationId: 'org-1', canAnywhere: () => false, can: () => false }),
}));
vi.mock('../lib/supabase', () => ({ supabase: {} }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/** Message `n`, newest first: a higher `n` is older. */
const message = (n: number, subject = `Rehearsal note ${n}`): OperationalMessageSummary => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  organization_id: 'org-1',
  plan_id: null,
  subject,
  body: 'Body',
  variables: {},
  created_by: 'leader-1',
  created_at: new Date(Date.UTC(2026, 10, 20) - n * 60_000).toISOString(),
  sender_name: n % 2 ? 'Mai Trần' : 'Bảo Lê',
  sent_by_me: false,
});

const range = (from: number, to: number): OperationalMessageSummary[] =>
  Array.from({ length: to - from + 1 }, (_, index) => message(from + index));

const renderPage = () => {
  vi.mocked(api.listTeams).mockResolvedValue([]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LanguageProvider>
          <MessagesPage />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
};

describe('web Messages paging', () => {
  it('loads older messages with the cursor of the oldest one shown, until a short page', async () => {
    const firstPage = range(1, MESSAGES_PAGE_SIZE);
    vi.mocked(api.listMessages).mockImplementation(async (query) =>
      query?.before ? [message(MESSAGES_PAGE_SIZE + 1, 'The oldest note')] : firstPage);
    const user = renderPage();

    expect(await screen.findByText('Rehearsal note 1')).toBeTruthy();
    expect(screen.queryByText('The oldest note')).toBeNull();
    expect(api.listMessages).toHaveBeenCalledWith({ box: 'received', limit: MESSAGES_PAGE_SIZE });

    await user.click(screen.getByRole('button', { name: 'Load older messages' }));
    expect(await screen.findByText('The oldest note')).toBeTruthy();
    expect(vi.mocked(api.listMessages).mock.calls.at(-1)?.[0]).toEqual({
      box: 'received',
      limit: MESSAGES_PAGE_SIZE,
      before: encodeKeysetCursor(firstPage.at(-1)!),
    });
    expect(screen.getByText('Rehearsal note 1')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load older messages' })).toBeNull());
  });

  it('offers no "Load older" when the first page is the whole list', async () => {
    vi.mocked(api.listMessages).mockResolvedValue(range(1, 3));
    renderPage();
    expect(await screen.findByText('Rehearsal note 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load older messages' })).toBeNull();
  });

  it('searches the loaded messages by subject or sender, ignoring accents, and says what it searched', async () => {
    vi.mocked(api.listMessages).mockResolvedValue([message(1, 'Setlist for Sunday'), message(2, 'Parking change')]);
    const user = renderPage();
    const search = await screen.findByRole('searchbox', { name: 'Search loaded messages' });

    await user.type(search, 'bao le');
    expect(screen.getByText('Parking change')).toBeTruthy();
    expect(screen.queryByText('Setlist for Sunday')).toBeNull();
    expect(screen.getByText('Searched the subject and sender of all 2 messages.')).toBeTruthy();

    await user.clear(search);
    await user.type(search, 'nothing like this');
    expect(screen.getByText('No loaded messages match your search.')).toBeTruthy();
  });
});
