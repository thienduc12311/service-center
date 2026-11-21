import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type PlanSummary, type StaffingMatrixPage, type StaffingMatrixQueryInput } from '@service-center/shared';
import { api } from '../lib/api';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { StaffingMatrixPage as StaffingMatrixScreen } from './StaffingMatrixPage';

vi.mock('../lib/api', () => ({
  api: {
    staffingMatrix: vi.fn(),
    staffingMatrixViews: vi.fn(),
    listTeams: vi.fn(),
    listServiceTypes: vi.fn(),
    listPlans: vi.fn(),
  },
}));
vi.mock('../providers/AuthProvider', () => ({ useAuth: () => ({ organizationId: 'org-1' }) }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = Date.now();
/** Plan `n` falls `n` days (and an hour) into the default four-week range. */
const planDate = (n: number): string => new Date(base + n * 86_400_000 + 3_600_000).toISOString();

const page = (people: number[], nextCursor: string | null, plans = [1]): StaffingMatrixPage => ({
  plans: plans.map((n) => ({
    id: id(100 + n), title: `Plan ${n}`, service_date: planDate(n), service_type_id: null, service_type_name: null,
    staffing_revision: 1, times: [], needs: [],
  })),
  people: people.map((n) => ({ id: id(n), full_name: `Person ${n}`, avatar_url: null, campus: null, recent_serving_count: 0, last_served_at: null })),
  assignments: [],
  conflicts: [],
  next_cursor: nextCursor,
});

const renderMatrix = () => {
  vi.mocked(api.staffingMatrixViews).mockResolvedValue([]);
  vi.mocked(api.listTeams).mockResolvedValue([]);
  vi.mocked(api.listServiceTypes).mockResolvedValue([]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LanguageProvider>
          <StaffingMatrixScreen />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
};

const lastInput = (): StaffingMatrixQueryInput => vi.mocked(api.staffingMatrix).mock.calls.at(-1)![0];

describe('web staffing matrix paging', () => {
  it('goes forward and back through people pages with the remembered cursors', async () => {
    vi.mocked(api.staffingMatrix).mockImplementation(async (input) =>
      input.cursor === id(2) ? page([3, 4], null) : page([1, 2], id(2)));
    const user = renderMatrix();
    expect(await screen.findByText('Person 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Previous people' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Next people' }));
    expect(await screen.findByText('Person 3')).toBeTruthy();
    expect(lastInput().cursor).toBe(id(2));
    expect(screen.getByText('People page 2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Previous people' }));
    expect(await screen.findByText('Person 1')).toBeTruthy();
    expect(lastInput().cursor).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Previous people' })).toBeNull();
  });

  it('waits for typing to settle before searching, and starts the search on the first page', async () => {
    vi.mocked(api.staffingMatrix).mockResolvedValue(page([1, 2], id(2)));
    const user = renderMatrix();
    await screen.findByText('Person 1');
    await user.click(screen.getByRole('button', { name: 'Next people' }));
    await waitFor(() => expect(lastInput().cursor).toBe(id(2)));
    const calls = vi.mocked(api.staffingMatrix).mock.calls.length;

    await user.type(screen.getByRole('searchbox', { name: 'Find a person' }), 'mai');
    await waitFor(() => expect(lastInput().filters.search).toBe('mai'));
    // One request for the settled text, none per keystroke.
    expect(vi.mocked(api.staffingMatrix).mock.calls.length).toBe(calls + 1);
    expect(lastInput().cursor).toBeUndefined();
  });

  it('turns the 12-plan refusal into a one-click narrower range', async () => {
    const plans = Array.from({ length: 13 }, (_, index) => ({ id: id(100 + index + 1), service_date: planDate(index + 1) }) as PlanSummary);
    vi.mocked(api.listPlans).mockResolvedValue({ data: plans, page: 1, per_page: 13, total: 20 });
    vi.mocked(api.staffingMatrix).mockImplementation(async (input) => {
      if (input.filters.to !== planDate(12)) throw new ApiError(400, 'Narrow the filters to 12 plans or fewer', 'bad_request');
      return page([1], null, [1, 12]);
    });
    const user = renderMatrix();

    const action = await screen.findByRole('button', { name: 'Show the next 12 plans' });
    expect(screen.queryByText(/Narrow the filters/)).toBeNull();
    await user.click(action);

    expect(await screen.findByText('Plan 12')).toBeTruthy();
    expect(api.listPlans).toHaveBeenCalledWith(expect.objectContaining({ order: 'asc', per_page: 13 }));
    expect(lastInput().filters.to).toBe(planDate(12));
    expect(screen.getByText(/Showing 12 plans at a time/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next 12 plans' })).toBeTruthy();
  });
});
