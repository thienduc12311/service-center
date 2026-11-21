import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrgRole, RosterPerson, RosterPersonPage, TeamWithPositions } from '@service-center/shared';
import type { PropsWithChildren } from 'react';
import { usePeoplePage, useRosterAudit } from '../hooks/queries';
import { api } from '../lib/api';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { PeoplePage } from './PeoplePage';

vi.mock('../lib/api', () => ({
  api: { listPeoplePage: vi.fn(), listTeams: vi.fn(async () => []), rosterAudit: vi.fn() },
}));
const auth = vi.hoisted(() => ({ role: 'member' as OrgRole, organizationId: 'org-1', accountId: 'account-1' }));
vi.mock('../providers/AuthProvider', () => ({
  useAuth: () => ({ ...auth, user: null, session: { user: { id: auth.accountId } } }),
}));
vi.mock('../lib/supabase', () => ({ supabase: {} }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  Object.assign(auth, { role: 'member', organizationId: 'org-1', accountId: 'account-1' });
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

const team = (id: string, name: string): TeamWithPositions => ({
  id,
  organization_id: 'org-1',
  service_type_id: null,
  name,
  description: null,
  color: '#6366f1',
  sort_order: 0,
  default_visibility: 'released',
  default_response_owner_id: null,
  requires_eligibility: false,
  eligibility_kind: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  positions: [],
  members: [],
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
  it.each([
    { name: 'church', authChange: { organizationId: 'org-2' } },
    { name: 'account', authChange: { accountId: 'account-2' } },
    { name: 'role', authChange: { role: 'member' } },
  ])('retains search results only before a $name change', async ({ authChange }) => {
    auth.role = 'owner';
    const privatePerson = { ...person('p-1', 'An Nguyen'), email: 'private@example.test' };
    vi.mocked(api.listPeoplePage)
      .mockResolvedValueOnce({ items: [privatePerson], next_cursor: null })
      .mockReturnValue(new Promise(() => {}));
    const client = new QueryClient();
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(
      (q: string) => usePeoplePage({ q, includeArchived: false }),
      { initialProps: '', wrapper },
    );
    await waitFor(() => expect(result.current.data).toEqual([privatePerson]));

    rerender('Nguyen');
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toEqual([privatePerson]);

    Object.assign(auth, authChange);
    rerender('Nguyen');
    expect(result.current.isPlaceholderData).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

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
    expect(await screen.findByText('Mai Tran')).toBeTruthy();
    expect(api.listPeoplePage).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Mai' }));
  });

  it('shows the server total and filters by team on the server', async () => {
    vi.mocked(api.listTeams).mockResolvedValue([team('t-band', 'Band'), team('t-tech', 'Tech')]);
    vi.mocked(api.listPeoplePage).mockImplementation(async (query): Promise<RosterPersonPage> =>
      query?.team_id === 't-band'
        ? { items: [person('p-2', 'Mai Tran')], next_cursor: null, total: 1 }
        : { items: [person('p-1', 'An Nguyen'), person('p-2', 'Mai Tran')], next_cursor: 'c-1', total: 340 },
    );
    const user = renderPeople();
    expect(await screen.findByText('340 people')).toBeTruthy();

    await user.click(await screen.findByRole('combobox', { name: 'Filter by team' }));
    await user.click(await screen.findByRole('option', { name: 'Band' }));
    expect(await screen.findByText('1 person')).toBeTruthy();
    expect(screen.queryByText('An Nguyen')).toBeNull();
    expect(api.listPeoplePage).toHaveBeenLastCalledWith(expect.objectContaining({ team_id: 't-band' }));
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

  it('shows a failed load with Try again instead of the empty state (W9-WEB-D2)', async () => {
    vi.mocked(api.listPeoplePage)
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValue({ items: [person('p-1', 'An Nguyen')], next_cursor: null });
    const user = renderPeople();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Nobody here yet')).toBeNull();

    await user.click(retry);
    expect(await screen.findByText('An Nguyen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(api.listPeoplePage).toHaveBeenCalledTimes(2);
  });
});

interface RosterHistoryFilters {
  personId: string;
  limit: number;
}

it('retains roster history when raising the limit for the same person', async () => {
  vi.mocked(api.rosterAudit).mockResolvedValueOnce([]).mockReturnValue(new Promise(() => {}));
  const client = new QueryClient();
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, rerender } = renderHook(
    ({ personId, limit }: RosterHistoryFilters) => useRosterAudit(personId, true, limit),
    { initialProps: { personId: 'person-a', limit: 50 }, wrapper },
  );
  await waitFor(() => expect(result.current.data).toEqual([]));

  rerender({ personId: 'person-a', limit: 100 });
  expect(result.current.isPlaceholderData).toBe(true);

  rerender({ personId: 'person-b', limit: 100 });
  expect(result.current.isPlaceholderData).toBe(false);
  expect(result.current.data).toBeUndefined();
});
