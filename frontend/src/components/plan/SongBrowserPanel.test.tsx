import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ApiError,
  type ArrangementRow,
  type Paginated,
  type PlanDetail,
  type PlanItemDetail,
  type PlanItemRow,
  type SongListItem,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { SongBrowserPanel } from './SongBrowserPanel';
import { INSERT_AT_END, type OrderInsertPoint } from './insertPoint';

vi.mock('../../lib/api', () => ({
  api: { listSongs: vi.fn(), addPlanItem: vi.fn(), getPlan: vi.fn(), reorderPlanItems: vi.fn(), deletePlanItem: vi.fn() },
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => ({ organizationId: 'org-1' }) }));

const NOW = new Date('2026-11-21T12:00:00Z');
const STAMP = '2026-01-01T00:00:00Z';

const arrangement = (id: string, songId: string, name: string, key: string, bpm: number, isDefault: boolean): ArrangementRow => ({
  archived_at: null,
  revision: 1,
  id,
  song_id: songId,
  name,
  song_key: key,
  capo: null,
  bpm,
  meter: null,
  length_seconds: 240,
  sequence: ['V1', 'C'],
  chord_chart: null,
  chord_chart_format: 'chordpro',
  chart_columns: 1,
  chart_font: null,
  chart_font_size: null,
  chart_chord_color: null,
  is_default: isDefault,
  created_at: STAMP,
  updated_at: STAMP,
});

const song = (id: string, title: string, overrides: Partial<SongListItem> = {}): SongListItem => ({
  archived_at: null,
  revision: 1,
  id,
  organization_id: 'org-1',
  title,
  author: 'Bethel',
  ccli_number: null,
  copyright: null,
  administration: null,
  default_key: 'Ab',
  default_bpm: 63,
  meter: null,
  themes: [],
  song_types: [],
  style: null,
  speed: null,
  notes: null,
  created_by: null,
  created_at: STAMP,
  updated_at: STAMP,
  arrangements: [arrangement(`${id}-main`, id, 'Main', 'Ab', 63, true), arrangement(`${id}-acoustic`, id, 'Acoustic', 'G', 60, false)],
  last_scheduled_at: '2026-09-01T10:00:00Z',
  usage_count: 5,
  in_plan: false,
  ...overrides,
});

const item = (id: string, title: string, sortOrder: number): PlanItemDetail => ({
  id,
  plan_id: 'plan-1',
  item_type: 'item',
  title,
  song_id: null,
  arrangement_id: null,
  key_override: null,
  length_seconds: 0,
  description: null,
  sort_order: sortOrder,
  sequence_override: null,
  leader_person_id: null,
  leader_position_id: null,
  service_segment: 'service',
  created_at: STAMP,
  updated_at: STAMP,
  song: null,
  arrangement: null,
});

const plan = (items: PlanItemDetail[], revision = 3): PlanDetail => ({
  id: 'plan-1',
  organization_id: 'org-1',
  service_type_id: 'sunday',
  title: 'Sunday',
  service_date: '2026-11-22T10:00:00Z',
  location: null,
  status: 'draft',
  notes: null,
  content_revision: revision,
  staffing_revision: 1,
  created_by: null,
  created_at: STAMP,
  updated_at: STAMP,
  service_type: { id: 'sunday', name: 'Sunday Service', recurrence: 'weekly' },
  times: [],
  counts: { items: items.length, songs: 0, confirmed: 0, unconfirmed: 0, declined: 0, prepared: 0 },
  items,
  assignments: [],
  plan_positions: [],
  position_needs: [],
  total_length_seconds: 0,
});

const created = (id: string, revision: number): PlanItemRow & { content_revision: number } => ({ ...item(id, 'Added', 9), content_revision: revision });

const page = (rows: SongListItem[], total = rows.length): Paginated<SongListItem> => ({ data: rows, page: 1, per_page: 20, total });

interface HarnessProps {
  initialPoint: OrderInsertPoint;
  detail: PlanDetail;
}

/** The panel with its insert point owned by a parent, as on the plan page. */
const Harness = ({ initialPoint, detail }: HarnessProps) => {
  const [point, setPoint] = useState(initialPoint);
  return (
    <>
      <span data-testid="point">{JSON.stringify(point)}</span>
      <SongBrowserPanel plan={detail} insertPoint={point} onInsertPointChange={setPoint} onAddOther={vi.fn()} onClose={vi.fn()} now={NOW} />
    </>
  );
};

const renderPanel = (initialPoint: OrderInsertPoint = INSERT_AT_END, detail: PlanDetail = plan([item('i-1', 'Welcome', 0), item('i-2', 'Sermon', 1)])) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageProvider>
        <Harness initialPoint={initialPoint} detail={detail} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
};

beforeEach(() => {
  vi.mocked(api.listSongs).mockResolvedValue(
    page([song('s-1', 'Goodness of God'), song('s-2', 'Build My Life', { in_plan: true, default_key: 'Bb' }), song('s-3', 'Chúa Là Tình Yêu', { last_scheduled_at: '2026-11-15T10:00:00Z' })], 43),
  );
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('opens on the suggested rotation and marks songs already in the plan or sung recently', async () => {
  renderPanel();
  expect(await screen.findByText('Goodness of God')).toBeTruthy();
  expect(vi.mocked(api.listSongs).mock.calls[0]?.[0]).toMatchObject({
    sort: 'most_used',
    service_type_id: 'sunday',
    scheduled_from: '2026-08-29T12:00:00.000Z',
    plan_id: 'plan-1',
    page: 1,
    per_page: 20,
  });
  expect(screen.getByText('Showing 3 of 43')).toBeTruthy();

  const inPlan = screen.getByText('Build My Life').closest('li')!;
  expect(within(inPlan).getByText('In this plan')).toBeTruthy();
  expect(within(inPlan).getByRole('button', { name: 'Add Build My Life again' })).toBeTruthy();
  const recent = screen.getByText('Chúa Là Tình Yêu').closest('li')!;
  expect(within(recent).getByText('Used recently')).toBeTruthy();
  const plain = screen.getByText('Goodness of God').closest('li')!;
  expect(plain.textContent).toContain('Ab · 63 bpm');
  expect(plain.textContent).toContain('used 5× · last used 2 months ago');
});

it('adds with the default arrangement and key, stays open, flips the row and offers Undo', async () => {
  vi.mocked(api.addPlanItem).mockResolvedValue(created('new-1', 4));
  vi.mocked(api.deletePlanItem).mockResolvedValue(undefined);
  const user = renderPanel();

  await user.click(await screen.findByRole('button', { name: 'Add Goodness of God' }));
  expect(await screen.findByRole('button', { name: 'Add Goodness of God again' })).toBeTruthy();
  expect(api.addPlanItem).toHaveBeenCalledExactlyOnceWith('plan-1', expect.objectContaining({
    item_type: 'song',
    title: 'Goodness of God',
    song_id: 's-1',
    arrangement_id: 's-1-main',
    key_override: 'Ab',
    length_seconds: 240,
    idempotency_key: expect.any(String),
  }));
  // Appending needs no reorder.
  expect(api.reorderPlanItems).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: /Add songs/ })).toBeTruthy();
  expect(screen.getByText('1 added')).toBeTruthy();

  const toast = screen.getByRole('status');
  expect(toast.textContent).toContain('Added “Goodness of God”');
  await user.click(within(toast).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(api.deletePlanItem).toHaveBeenCalledExactlyOnceWith('plan-1', 'new-1'));
  expect(await screen.findByRole('button', { name: 'Add Goodness of God' })).toBeTruthy();
});

it('puts songs at the chosen insert point, each after the one before, and undo steps the point back', async () => {
  vi.mocked(api.addPlanItem).mockResolvedValueOnce(created('new-1', 4)).mockResolvedValueOnce(created('new-2', 6));
  vi.mocked(api.getPlan)
    .mockResolvedValueOnce(plan([item('i-1', 'Welcome', 0), item('i-2', 'Sermon', 1), item('new-1', 'Goodness of God', 2)], 4))
    .mockResolvedValueOnce(plan([item('i-1', 'Welcome', 0), item('new-1', 'Goodness of God', 1), item('i-2', 'Sermon', 2), item('new-2', 'Chúa Là Tình Yêu', 3)], 6));
  vi.mocked(api.reorderPlanItems).mockResolvedValue([]);
  vi.mocked(api.deletePlanItem).mockResolvedValue(undefined);
  const user = renderPanel({ kind: 'after', itemId: 'i-1' });
  expect(await screen.findByText('Adding after “Welcome”')).toBeTruthy();

  await user.click(await screen.findByRole('button', { name: 'Add Goodness of God' }));
  await waitFor(() => expect(api.reorderPlanItems).toHaveBeenCalledWith('plan-1', ['i-1', 'new-1', 'i-2'], 4));
  await waitFor(() => expect(screen.getByTestId('point').textContent).toBe('{"kind":"after","itemId":"new-1"}'));

  await user.click(screen.getByRole('button', { name: 'Add Chúa Là Tình Yêu' }));
  await waitFor(() => expect(api.reorderPlanItems).toHaveBeenLastCalledWith('plan-1', ['i-1', 'new-1', 'new-2', 'i-2'], 6));
  await waitFor(() => expect(screen.getByTestId('point').textContent).toBe('{"kind":"after","itemId":"new-2"}'));

  await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(api.deletePlanItem).toHaveBeenCalledWith('plan-1', 'new-2'));
  await waitFor(() => expect(screen.getByTestId('point').textContent).toBe('{"kind":"after","itemId":"new-1"}'));
});

it('recomputes the order once when someone else changed it, and never adds twice', async () => {
  vi.mocked(api.addPlanItem).mockResolvedValue(created('new-1', 4));
  vi.mocked(api.getPlan)
    .mockResolvedValueOnce(plan([item('i-1', 'Welcome', 0), item('i-2', 'Sermon', 1), item('new-1', 'Song', 2)], 4))
    .mockResolvedValueOnce(plan([item('i-0', 'Prelude', 0), item('i-1', 'Welcome', 1), item('i-2', 'Sermon', 2), item('new-1', 'Song', 3)], 5));
  vi.mocked(api.reorderPlanItems)
    .mockRejectedValueOnce(new ApiError(409, 'Stale', 'plan_revision_stale'))
    .mockResolvedValueOnce([]);
  const user = renderPanel({ kind: 'after', itemId: 'i-1' });

  await user.click(await screen.findByRole('button', { name: 'Add Goodness of God' }));
  await waitFor(() => expect(api.reorderPlanItems).toHaveBeenLastCalledWith('plan-1', ['i-0', 'i-1', 'new-1', 'i-2'], 5));
  expect(api.addPlanItem).toHaveBeenCalledOnce();
  expect(screen.queryByText(/was added at the end/)).toBeNull();
});

it('adds the highlighted song with Enter after moving with the arrow keys', async () => {
  vi.mocked(api.addPlanItem).mockResolvedValue(created('new-1', 4));
  const user = renderPanel();
  await screen.findByText('Goodness of God');
  const search = screen.getByRole('searchbox', { name: 'Search songs' });
  expect(document.activeElement).toBe(search);

  await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}');
  await waitFor(() => expect(api.addPlanItem).toHaveBeenCalledWith('plan-1', expect.objectContaining({ song_id: 's-2' })));
});

it('adds the arrangement picked in the expanded row, in its key', async () => {
  vi.mocked(api.addPlanItem).mockResolvedValue(created('new-1', 4));
  const user = renderPanel();
  await user.click(await screen.findByRole('button', { name: 'Show arrangements of Goodness of God' }));
  await user.click(screen.getByRole('radio', { name: /Acoustic/ }));
  expect(screen.getByText('Goodness of God').closest('li')!.textContent).toContain('G · 60 bpm');
  await user.click(screen.getByRole('button', { name: 'Add Goodness of God' }));
  await waitFor(() =>
    expect(api.addPlanItem).toHaveBeenCalledWith('plan-1', expect.objectContaining({ arrangement_id: 's-1-acoustic', key_override: 'G' })),
  );
});

it('sends the search and filter chips to the server', async () => {
  const user = renderPanel();
  await screen.findByText('Goodness of God');
  await user.type(screen.getByRole('searchbox', { name: 'Search songs' }), 'chua');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Key' }), 'G');
  await user.click(screen.getByRole('checkbox', { name: 'Hide songs used in the last 3 weeks' }));
  await waitFor(() =>
    expect(vi.mocked(api.listSongs).mock.calls.at(-1)?.[0]).toMatchObject({
      q: 'chua',
      key: 'G',
      sort: 'most_used',
      not_scheduled_since: '2026-10-31T12:00:00.000Z',
    }),
  );
  expect(vi.mocked(api.listSongs).mock.calls.at(-1)?.[0]).not.toHaveProperty('scheduled_from');
});
