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
  next_cursor: nextCursor, prev_cursor: null,
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

  it('pages through all 25 plans at the same instant after a 12-plan refusal', async () => {
    const plans = page([1], null, Array.from({ length: 25 }, (_, index) => index + 1))
      .plans.map((plan) => ({ ...plan, service_date: planDate(1) }));
    const summaries = plans.map(({ id: planId, title, service_date }): PlanSummary => ({
      id: planId,
      title,
      service_date,
      organization_id: 'org-1',
      service_type_id: null,
      service_type: null,
      location: null,
      notes: null,
      status: 'draft',
      content_revision: 1,
      staffing_revision: 1,
      created_by: null,
      created_at: service_date,
      updated_at: service_date,
      times: [],
      counts: { items: 0, songs: 0, confirmed: 0, unconfirmed: 0, declined: 0, prepared: 0 },
    }));
    vi.mocked(api.listPlans).mockImplementation(async (query) => {
      const pageNumber = Number(query?.page);
      const perPage = Number(query?.per_page);
      return {
        data: summaries.slice((pageNumber - 1) * perPage, pageNumber * perPage),
        page: pageNumber,
        per_page: perPage,
        total: plans.length,
      };
    });
    vi.mocked(api.staffingMatrix).mockImplementation(async ({ filters }) => {
      if (filters.plan_ids.length === 0) throw new ApiError(400, 'Narrow the filters to 12 plans or fewer', 'bad_request');
      return { ...page([1], null), plans: plans.filter((plan) => filters.plan_ids.includes(plan.id)) };
    });
    const user = renderMatrix();

    const action = await screen.findByRole('button', { name: 'Show the next 12 plans' });
    expect(screen.queryByText(/Narrow the filters/)).toBeNull();
    await user.click(action);

    expect(await screen.findByText('Plan 12')).toBeTruthy();
    const { from, to } = lastInput().filters;
    expect(lastInput().filters.plan_ids).toEqual(plans.slice(0, 12).map((plan) => plan.id));
    expect(screen.getByText(/Showing 12 plans at a time/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Next 12 plans' }));
    expect(await screen.findByText('Plan 13')).toBeTruthy();
    expect(lastInput().filters.plan_ids).toEqual(plans.slice(12, 24).map((plan) => plan.id));
    expect(screen.queryByText('Plan 12')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Next 12 plans' }));
    expect(await screen.findByText('Plan 25')).toBeTruthy();
    expect(lastInput().filters.plan_ids).toEqual([id(125)]);
    expect(screen.queryByRole('button', { name: 'Next 12 plans' })).toBeNull();
    expect(vi.mocked(api.listPlans).mock.calls.map(([query]) => query)).toEqual(
      [1, 2, 3].map((number) => ({ from, to, order: 'asc', page: number, per_page: 12 })),
    );
  });
});
