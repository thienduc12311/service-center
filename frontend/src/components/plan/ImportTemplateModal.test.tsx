import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { foldSearchText, type ListPlansRequest, type Paginated, type PlanDetail, type PlanSummary } from '@service-center/shared';
import { api } from '../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { ImportTemplateModal } from './ImportTemplateModal';

vi.mock('../../lib/api', () => ({ api: { listPlans: vi.fn(), listPeople: vi.fn(), importPlanContents: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => ({ organizationId: 'org-1', can: () => false }) }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const NOW = '2026-11-21T00:00:00Z';
const sunday: NonNullable<PlanSummary['service_type']> = { id: 'sunday', name: 'Sunday Service', recurrence: 'weekly' };
const youth: NonNullable<PlanSummary['service_type']> = { id: 'youth', name: 'Youth Night', recurrence: 'weekly' };

const summary = (id: string, title: string, serviceDate: string, serviceType = sunday): PlanSummary => ({
  id,
  organization_id: 'org-1',
  service_type_id: serviceType.id,
  title,
  service_date: serviceDate,
  location: null,
  status: 'published',
  notes: null,
  content_revision: 1,
  staffing_revision: 1,
  created_by: null,
  created_at: NOW,
  updated_at: NOW,
  service_type: serviceType,
  times: [],
  counts: { items: 5, songs: 3, confirmed: 4, unconfirmed: 0, declined: 0, prepared: 0 },
});

const plan: PlanDetail = {
  ...summary('plan-now', 'This Sunday', '2026-11-22T10:00:00Z'),
  items: [],
  assignments: [],
  plan_positions: [],
  position_needs: [],
  total_length_seconds: 0,
};

// 30 past Sunday plans, newest first; the oldest is Easter last year.
const sundays = Array.from({ length: 30 }, (_, index) =>
  summary(`s-${index}`, index === 29 ? 'Lễ Phục Sinh' : `Sunday ${index}`, `2026-${String(10 - Math.floor(index / 4)).padStart(2, '0')}-${String(28 - (index % 4) * 7).padStart(2, '0')}T10:00:00Z`),
);
const youthPlan = summary('y-1', 'Youth worship night', '2026-11-14T19:00:00Z', youth);

const page = (rows: PlanSummary[], query: ListPlansRequest): Paginated<PlanSummary> => {
  const perPage = query.per_page ?? 50;
  const current = query.page ?? 1;
  return { data: rows.slice((current - 1) * perPage, current * perPage), page: current, per_page: perPage, total: rows.length };
};

it('searches past plans accent-insensitively, pages to older ones, and can widen to every service type', async () => {
  const user = userEvent.setup();
  vi.mocked(api.listPeople).mockResolvedValue([]);
  vi.mocked(api.listPlans).mockImplementation(async (query) => {
    const request = (query ?? {}) as ListPlansRequest;
    const rows = request.service_type_id ? sundays : [youthPlan, ...sundays];
    const words = request.q ? foldSearchText(request.q).split(/\s+/) : [];
    return page(rows.filter((row) => words.every((word) => foldSearchText(row.title).includes(word))), request);
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider>
        <ImportTemplateModal open plan={plan} onClose={vi.fn()} />
      </LanguageProvider>
    </QueryClientProvider>,
  );

  expect(await screen.findByRole('button', { name: /Sunday 0/ })).toBeTruthy();
  expect(screen.getByText('Showing 25 of 30')).toBeTruthy();
  expect(vi.mocked(api.listPlans).mock.calls[0]?.[0]).toMatchObject({ service_type_id: 'sunday', order: 'desc', per_page: 25 });

  // Easter is older than the first page: the server search still finds it.
  const search = screen.getByRole('searchbox', { name: 'Search past plans' });
  await user.type(search, 'phuc sinh');
  const easter = await screen.findByRole('button', { name: /Lễ Phục Sinh/ });
  expect(vi.mocked(api.listPlans).mock.calls.at(-1)?.[0]).toMatchObject({ q: 'phuc sinh', service_type_id: 'sunday' });
  expect(screen.queryByRole('button', { name: /Sunday 0/ })).toBeNull();
  await user.click(easter);
  expect(easter.getAttribute('aria-pressed')).toBe('true');

  // Clearing the search keeps the chosen plan listed and pages to older plans again.
  await user.clear(search);
  await waitFor(() => expect(screen.getByRole('button', { name: /Sunday 0/ })).toBeTruthy());
  expect(screen.getByRole('button', { name: /Lễ Phục Sinh/ }).getAttribute('aria-pressed')).toBe('true');
  await user.click(screen.getByRole('button', { name: 'Show more' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull());

  // Widening to every service type clears the choice and shows each plan's type.
  await user.clear(search);
  await user.click(screen.getByRole('checkbox', { name: 'Only Sunday Service plans' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Youth worship night/ })).toBeTruthy());
  expect(screen.getByRole('button', { name: /Youth worship night/ }).textContent).toContain('Youth Night');
  expect(screen.getByRole('button', { name: 'Import' })).toHaveProperty('disabled', true);
  expect(vi.mocked(api.listPlans).mock.calls.at(-1)?.[0]).not.toHaveProperty('service_type_id');
});
