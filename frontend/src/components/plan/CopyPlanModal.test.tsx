import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, nextOccurrence, type PlanDetail } from '@service-center/shared';
import { api } from '../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { CopyPlanModal } from './CopyPlanModal';
import { PlanWorkspaceHeader } from './PlanWorkspaceHeader';
import { classifyCopyPlanError, defaultCopyDate, fromDateTimeLocal, toDateTimeLocal } from './copyPlan';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('../../lib/api', () => ({ api: { duplicatePlan: vi.fn(), listPeople: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => ({ organizationId: 'org-1', can: () => false }) }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const NOW = '2026-11-21T00:00:00Z';
const SOURCE_DATE = '2027-03-07T17:00:00Z';

const plan: PlanDetail = {
  id: 'plan-1',
  organization_id: 'org-1',
  service_type_id: 'sunday',
  title: 'Sunday Morning',
  service_date: SOURCE_DATE,
  location: 'Main hall',
  status: 'published',
  notes: null,
  content_revision: 1,
  staffing_revision: 1,
  created_by: null,
  created_at: NOW,
  updated_at: NOW,
  service_type: { id: 'sunday', name: 'Sunday Service', recurrence: 'weekly' },
  times: [
    { id: 't-1', plan_id: 'plan-1', kind: 'service', name: 'Service', starts_at: SOURCE_DATE, ends_at: '2027-03-07T18:30:00Z', sort_order: 0, created_at: NOW },
  ] as PlanDetail['times'],
  counts: { items: 2, songs: 1, confirmed: 1, unconfirmed: 0, declined: 0, prepared: 0 },
  items: [{ id: 'i-1' }, { id: 'i-2' }] as PlanDetail['items'],
  assignments: [{ id: 'a-1' }, { id: 'a-2' }, { id: 'a-3' }] as PlanDetail['assignments'],
  plan_positions: [],
  position_needs: [],
  total_length_seconds: 0,
};

const renderModal = (onClose = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <LanguageProvider>
        <CopyPlanModal plan={plan} onClose={onClose} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return onClose;
};

const created = { ...plan, id: 'plan-copy' };

describe('CopyPlanModal', () => {
  beforeEach(() => {
    vi.mocked(api.listPeople).mockResolvedValue([]);
  });

  it('defaults to the next date and the same title, copies once and opens the new plan', async () => {
    const user = userEvent.setup();
    let resolve: (value: PlanDetail) => void = () => undefined;
    vi.mocked(api.duplicatePlan).mockReturnValue(new Promise<PlanDetail>((done) => { resolve = done; }));
    const onClose = renderModal();

    const date = screen.getByLabelText('New date') as HTMLInputElement;
    expect(date.value).toBe(toDateTimeLocal(nextOccurrence(SOURCE_DATE, 'weekly')));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Sunday Morning');
    const people = screen.getByRole('checkbox', { name: 'Copy scheduled people' }) as HTMLInputElement;
    expect(people.checked).toBe(false);
    expect(screen.getByText('Order of service (2 items)')).toBeTruthy();
    expect(screen.getByText('1 time, moved to the new date')).toBeTruthy();
    expect(screen.queryByText(/scheduled people, as new requests/)).toBeNull();

    const submit = screen.getByRole('button', { name: 'Copy plan' });
    await user.click(submit);
    // In flight: the button is disabled, so a second click sends nothing.
    await waitFor(() => expect(submit).toHaveProperty('disabled', true));
    await user.click(submit);
    expect(api.duplicatePlan).toHaveBeenCalledTimes(1);
    const [sourceId, body] = vi.mocked(api.duplicatePlan).mock.calls[0]!;
    expect(sourceId).toBe('plan-1');
    expect(body).toMatchObject({
      service_date: nextOccurrence(SOURCE_DATE, 'weekly').toISOString(),
      title: 'Sunday Morning',
      copy_assignments: false,
      conflict_override_reason: null,
    });
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);

    resolve(created);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/plans/plan-copy'));
    expect(onClose).toHaveBeenCalled();
  });

  it('copies the scheduled people when asked, and says how', async () => {
    const user = userEvent.setup();
    vi.mocked(api.duplicatePlan).mockResolvedValue(created);
    renderModal();

    await user.click(screen.getByRole('checkbox', { name: 'Copy scheduled people' }));
    expect(screen.getByText('3 scheduled people, as new requests')).toBeTruthy();
    expect(screen.getByText(/Nobody is told now: the copy is a draft/)).toBeTruthy();
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Easter Sunday');
    await user.click(screen.getByRole('button', { name: 'Copy plan' }));
    expect(vi.mocked(api.duplicatePlan).mock.calls[0]?.[1]).toMatchObject({ copy_assignments: true, title: 'Easter Sunday' });
  });

  it('needs a title and a date', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.clear(screen.getByLabelText('Title'));
    expect(screen.getByText('Give the copy a title.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy plan' })).toHaveProperty('disabled', true);
    await user.type(screen.getByLabelText('Title'), 'Again');
    await user.clear(screen.getByLabelText('New date'));
    expect(screen.getByText('Choose a date for the copy.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy plan' })).toHaveProperty('disabled', true);
    expect(api.duplicatePlan).not.toHaveBeenCalled();
  });

  it('explains a permission failure', async () => {
    const user = userEvent.setup();
    vi.mocked(api.duplicatePlan).mockRejectedValue(new ApiError(404, 'Plan not found'));
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Copy plan' }));
    expect(await screen.findByText(/You can’t copy this plan/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('retries a network failure with the same idempotency key', async () => {
    const user = userEvent.setup();
    vi.mocked(api.duplicatePlan).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(created);
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Copy plan' }));
    expect(await screen.findByText('Trying again is safe: it never makes a second copy.')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Copy plan' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/plans/plan-copy'));
    const [first, second] = vi.mocked(api.duplicatePlan).mock.calls;
    expect(second?.[1].idempotency_key).toBe(first?.[1].idempotency_key);
  });

  it('shows scheduling conflicts and, without the override permission, says what to do', async () => {
    const user = userEvent.setup();
    vi.mocked(api.duplicatePlan).mockRejectedValue(new ApiError(409, 'Conflicts', 'scheduling_conflict', []));
    renderModal();

    await user.click(screen.getByRole('checkbox', { name: 'Copy scheduled people' }));
    await user.click(screen.getByRole('button', { name: 'Copy plan' }));
    expect(await screen.findByText(/Copy without the scheduled people/)).toBeTruthy();
  });

  it('starts a fresh attempt when the server says the key was used for other details', async () => {
    const user = userEvent.setup();
    vi.mocked(api.duplicatePlan)
      .mockRejectedValueOnce(new ApiError(409, 'Reused', 'idempotency_key_reused'))
      .mockResolvedValueOnce(created);
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Copy plan' }));
    expect(await screen.findByText(/That copy was started with different details/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Copy plan' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/plans/plan-copy'));
    const [first, second] = vi.mocked(api.duplicatePlan).mock.calls;
    expect(second?.[1].idempotency_key).not.toBe(first?.[1].idempotency_key);
  });
});

describe('Copy plan in the plan header', () => {
  const renderHeader = (canManage: boolean) =>
    render(
      <MemoryRouter>
        <LanguageProvider>
          <PlanWorkspaceHeader
            plan={plan}
            organizationName="Grace"
            canManage={canManage}
            canNotify
            previousPlanId={null}
            nextPlanId={null}
            creatingNextPlan={false}
            onCreateNextPlan={vi.fn()}
            onExportSongBook={vi.fn()}
            onTogglePublished={vi.fn()}
            onNotify={vi.fn()}
            onDelete={vi.fn()}
            onCopy={vi.fn()}
          />
        </LanguageProvider>
      </MemoryRouter>,
    );

  it('is offered to someone who can edit the plan', async () => {
    const user = userEvent.setup();
    renderHeader(true);
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menuitem', { name: 'Copy plan' })).toBeTruthy();
  });

  it('is hidden from someone who cannot', async () => {
    const user = userEvent.setup();
    renderHeader(false);
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Copy plan' })).toBeNull();
  });
});

describe('copy plan helpers', () => {
  it('defaults to the next date in the rhythm (same wall-clock time), never in the past', () => {
    const now = new Date(2026, 10, 21, 9, 0);
    const local = (month: number, day: number): string => new Date(2026, month, day, 10, 0).toISOString();
    expect(defaultCopyDate(local(10, 22), 'weekly', now).toISOString()).toBe(local(10, 29));
    expect(defaultCopyDate(local(10, 22), 'biweekly', now).toISOString()).toBe(local(11, 6));
    expect(defaultCopyDate(local(10, 22), 'monthly', now).toISOString()).toBe(local(11, 22));
    // An old plan steps forward to the first date after now (across any DST change).
    expect(defaultCopyDate(local(9, 4), 'weekly', now).toISOString()).toBe(local(10, 22));
  });

  it('reads and writes datetime-local values', () => {
    const value = new Date(2027, 2, 14, 9, 5);
    expect(toDateTimeLocal(value)).toBe('2027-03-14T09:05');
    expect(fromDateTimeLocal('2027-03-14T09:05')).toBe(value.toISOString());
    expect(fromDateTimeLocal('')).toBeNull();
    expect(fromDateTimeLocal('not a date')).toBeNull();
  });

  it('sorts copy failures', () => {
    expect(classifyCopyPlanError(new ApiError(403, 'No'))).toBe('permission');
    expect(classifyCopyPlanError(new ApiError(404, 'Plan not found'))).toBe('permission');
    expect(classifyCopyPlanError(new ApiError(409, 'Conflicts', 'scheduling_conflict'))).toBe('conflict');
    expect(classifyCopyPlanError(new ApiError(409, 'Reused', 'idempotency_key_reused'))).toBe('reused');
    expect(classifyCopyPlanError(new TypeError('Failed to fetch'))).toBe('other');
  });
});
