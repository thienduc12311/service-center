import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  GenerationDateProblem,
  GenerationPlanPreview,
  PlanGenerationPreview,
  PlanGenerationResult,
  PlanSeriesRequest,
  PlanTemplateSummary,
  ServiceTypeRow,
} from '@service-center/shared';
import { api } from '../lib/api';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { GeneratePlansPage } from './GeneratePlansPage';

vi.mock('../lib/api', () => ({
  api: {
    planTemplates: vi.fn(),
    listServiceTypes: vi.fn(),
    listPeople: vi.fn(),
    previewPlanGeneration: vi.fn(),
    generatePlans: vi.fn(),
  },
}));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../providers/AuthProvider', () => ({
  useAuth: () => ({
    organizationId: 'org-1',
    canAnywhere: () => true,
    can: () => true,
    // A zone no test machine runs in, so a time read in the browser's zone would show.
    user: { profile: { id: 'user-1' }, memberships: [{ organization: { id: 'org-1', timezone: 'Pacific/Kiritimati' } }] },
  }),
}));

const template = {
  id: 'tpl-1',
  organization_id: 'org-1',
  service_type_id: 'st-1',
  kind: 'plan',
  name: 'Communion Sunday',
  description: null,
  current_revision: 3,
  archived_at: null,
  created_by: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  service_type: { id: 'st-1', name: 'Communion' },
  current_revision_id: 'rev-3',
  counts: { times: 1, items: 2, needs: 0, roster: 0, has_notes: false },
} as unknown as PlanTemplateSummary;

const monthlyServiceType = {
  id: 'st-1',
  organization_id: 'org-1',
  name: 'Communion',
  recurrence: 'monthly',
} as unknown as ServiceTypeRow;

const proposed = (localDate: string): GenerationPlanPreview => ({
  local_date: localDate,
  title: 'Communion Sunday',
  service_date: `${localDate}T17:00:00.000Z`,
  existing_plans: [],
  preview: {
    template: { id: 'tpl-1', name: 'Communion Sunday', kind: 'plan', revision: 3, revision_id: 'rev-3', latest_revision: 3 },
    plan_id: null,
    destination_revision: null,
    anchor_date: localDate,
    timezone: 'America/Los_Angeles',
    mode: 'append',
    components: [],
    blocking: [],
    warnings: [],
  },
});

const previewOf = (dates: string[], problems: GenerationDateProblem[] = []): PlanGenerationPreview => ({
  template_id: 'tpl-1',
  service_type_id: 'st-1',
  revision_id: 'rev-3',
  timezone: 'America/Los_Angeles',
  plans: dates.map(proposed),
  excluded: [],
  problems,
  preview_hash: problems.length ? null : 'a'.repeat(32),
  max_plans: 52,
});

const lastRequest = (): PlanSeriesRequest => vi.mocked(api.previewPlanGeneration).mock.calls.at(-1)![0];

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageProvider>
        <MemoryRouter>
          <GeneratePlansPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );

/** Picks the template and sets the first date to Sunday 9 May 2027 (the 2nd Sunday). */
const chooseTemplate = async () => {
  const select = await screen.findByLabelText('Template');
  await waitFor(() => expect(screen.getByRole('option', { name: /Communion Sunday/ })).toBeTruthy());
  fireEvent.change(select, { target: { value: 'tpl-1' } });
  fireEvent.change(screen.getByLabelText('First date'), { target: { value: '2027-05-09' } });
};

beforeEach(() => {
  vi.mocked(api.planTemplates).mockResolvedValue([template]);
  vi.mocked(api.listServiceTypes).mockResolvedValue([monthlyServiceType]);
  vi.mocked(api.listPeople).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('GeneratePlansPage recurrence', () => {
  it('starts from the service type frequency, says it in words and sends it for review', async () => {
    const user = userEvent.setup();
    vi.mocked(api.previewPlanGeneration).mockResolvedValue(previewOf(['2027-05-09', '2027-06-13', '2027-07-11']));
    renderPage();
    await chooseTemplate();

    await waitFor(() => expect((screen.getByLabelText('Repeats') as HTMLSelectElement).value).toBe('monthly_weekday'));
    expect((screen.getByLabelText('Which week') as HTMLSelectElement).value).toBe('second');
    expect(screen.getByText('Starts with Communion’s usual rhythm.')).toBeTruthy();
    expect(screen.getByTestId('recurrence-summary').textContent).toBe('Every 2nd Sunday, 4 plans');

    await user.click(screen.getByRole('button', { name: 'Review plans' }));
    await screen.findByText('3 plans to create');
    expect(lastRequest()).toMatchObject({
      revision_id: 'rev-3',
      start_date: '2027-05-09',
      recurrence: { frequency: 'monthly_weekday', ordinal: 'second', weekday: 0 },
      count: 4,
    });
    expect(lastRequest().end_date).toBeUndefined();
    expect(screen.getByTestId('preview-summary').textContent).toBe('Every 2nd Sunday, 3 plans');
  });

  it('offers the last weekday, a day of month with short-month handling, and an until date', async () => {
    const user = userEvent.setup();
    vi.mocked(api.previewPlanGeneration).mockResolvedValue(previewOf(['2027-05-31']));
    renderPage();
    await chooseTemplate();

    await user.selectOptions(await screen.findByLabelText('Which week'), 'last');
    expect(screen.getByTestId('recurrence-summary').textContent).toBe('Every last Sunday, 4 plans');

    await user.selectOptions(screen.getByLabelText('Repeats'), 'monthly_day');
    expect((screen.getByLabelText('Day of the month') as HTMLSelectElement).value).toBe('9');
    expect(screen.queryByLabelText('In months without that day')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Day of the month'), '31');
    expect(screen.getByTestId('recurrence-summary').textContent).toBe('Monthly on day 31, skipping months without it, 4 plans');
    await user.selectOptions(screen.getByLabelText('In months without that day'), 'clamp');

    await user.click(screen.getByRole('radio', { name: 'On a date' }));
    fireEvent.change(screen.getByLabelText('Last date'), { target: { value: '2027-12-31' } });
    expect(screen.queryByLabelText('How many plans')).toBeNull();
    expect(screen.getByTestId('recurrence-summary').textContent).toMatch(/^Monthly on day 31, or the last day of shorter months, until /);

    await user.click(screen.getByRole('button', { name: 'Review plans' }));
    await screen.findByText('1 plan to create');
    expect(lastRequest()).toMatchObject({
      recurrence: { frequency: 'monthly_day', day_of_month: 31, short_month: 'clamp' },
      count: 52,
      end_date: '2027-12-31',
    });
  });

  it('keeps per-date skip working and does not offer a skip for a series-wide problem', async () => {
    const user = userEvent.setup();
    vi.mocked(api.previewPlanGeneration)
      .mockResolvedValueOnce(previewOf(['2027-05-09', '2027-06-13']))
      .mockResolvedValueOnce(previewOf(['2027-06-13']))
      .mockResolvedValueOnce(previewOf(['2027-05-09'], [{
        local_date: '2028-05-14',
        message: 'More than 52 plans fall before 2028-06-30.',
        problem: { code: 'too_many_dates', max: 52, local_date: '2028-05-14', end_date: '2028-06-30' },
      }]));
    renderPage();
    await chooseTemplate();
    await user.click(screen.getByRole('button', { name: 'Review plans' }));
    await screen.findByText('2 plans to create');

    await user.click(screen.getAllByRole('button', { name: 'Skip' })[0]!);
    await screen.findByText('1 plan to create');
    expect(lastRequest().edits).toEqual([{ local_date: '2027-05-09', skip: true }]);

    await user.click(screen.getByRole('button', { name: 'Review plans' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('More than 52 plans fall before');
    expect(screen.queryByRole('button', { name: 'Skip this date' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Create 1 draft plan' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a review error and creates nothing', async () => {
    const user = userEvent.setup();
    vi.mocked(api.previewPlanGeneration).mockRejectedValue(new Error('Network down'));
    renderPage();
    await chooseTemplate();
    await user.click(screen.getByRole('button', { name: 'Review plans' }));
    await waitFor(() => expect(screen.getByText(/Network down|went wrong/i)).toBeTruthy());
    expect(api.generatePlans).not.toHaveBeenCalled();
  });

  it('shows the review and the created plans in the organization’s timezone, not the browser’s', async () => {
    const user = userEvent.setup();
    // 17:00 UTC on 9 May is 07:00 on 10 May in Kiritimati (UTC+14).
    vi.mocked(api.previewPlanGeneration).mockResolvedValue({ ...previewOf(['2027-05-09']), timezone: 'Pacific/Kiritimati' });
    vi.mocked(api.generatePlans).mockResolvedValue({
      batch_id: 'batch-1',
      plan_ids: ['plan-1'],
      replayed: false,
      plans: [{ id: 'plan-1', title: 'Communion Sunday', service_date: '2027-05-09T17:00:00.000Z' }],
    } as unknown as PlanGenerationResult);
    renderPage();
    await chooseTemplate();
    await user.click(screen.getByRole('button', { name: 'Review plans' }));
    await screen.findByText('1 plan to create');
    expect(screen.getByText(/May 10.*7:00\sAM/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Create 1 draft plan' }));
    const link = (await screen.findByText('Communion Sunday', { selector: 'span' })).closest('a')!;
    expect(link.textContent).toMatch(/May 10.*7:00\sAM/);
    // The date tile reads the same day.
    expect(link.querySelector('[aria-hidden="true"]')!.textContent).toContain('10');
  });
});
