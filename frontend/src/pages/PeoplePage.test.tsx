import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RosterPerson, RosterPersonPage } from '@service-center/shared';
import { api } from '../lib/api';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { PeoplePage } from './PeoplePage';

vi.mock('../lib/api', () => ({
  api: { listPeoplePage: vi.fn() },
}));
vi.mock('../providers/AuthProvider', () => ({
  useAuth: () => ({ role: 'member', organizationId: 'org-1', user: null, session: null }),
}));
vi.mock('../lib/supabase', () => ({ supabase: {} }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const person = (id: string, name: string): RosterPerson => ({
  id,
  person_id: id,
  profile_id: null,
  has_login: false,
  full_name: name,
  email: null,
  phone: null,
  avatar_url: null,
  role: null,
  status: 'no_account',
  campus: null,
  invite_pending: false,
  archived: false,
});

const renderPeople = () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageProvider>
        <MemoryRouter>
          <PeoplePage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
};

describe('web People list', () => {
  it('searches on the server with the typed text and shows a member-appropriate placeholder', async () => {
    vi.mocked(api.listPeoplePage).mockImplementation(async (query): Promise<RosterPersonPage> => ({
      items: query?.q ? [person('p-2', 'Mai Tran')] : [person('p-1', 'An Nguyen'), person('p-2', 'Mai Tran')],
      next_cursor: null,
    }));
    const user = renderPeople();
    expect(await screen.findByText('An Nguyen')).toBeTruthy();

    const search = screen.getByRole('searchbox', { name: 'Search people' });
    expect(search.getAttribute('placeholder')).toBe('Search by name or campus');
    await user.type(search, 'Mai');
    await waitFor(() => expect(screen.queryByText('An Nguyen')).toBeNull());
    expect(screen.getByText('Mai Tran')).toBeTruthy();
    expect(api.listPeoplePage).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Mai' }));
  });

  it('loads the next page with the cursor from the previous one', async () => {
    vi.mocked(api.listPeoplePage).mockImplementation(async (query): Promise<RosterPersonPage> =>
      query?.cursor
        ? { items: [person('p-2', 'Second Page')], next_cursor: null }
        : { items: [person('p-1', 'First Page')], next_cursor: 'cursor-1' },
    );
    const user = renderPeople();
    expect(await screen.findByText('First Page')).toBeTruthy();
    expect(screen.queryByText('Second Page')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Load more people' }));
    expect(await screen.findByText('Second Page')).toBeTruthy();
    expect(screen.getByText('First Page')).toBeTruthy();
    expect(vi.mocked(api.listPeoplePage).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ cursor: 'cursor-1' }));
    expect(screen.queryByRole('button', { name: 'Load more people' })).toBeNull();
  });
});
