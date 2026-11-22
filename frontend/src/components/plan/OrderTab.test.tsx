import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, computePlanSchedule, type PlanDetail, type PlanItemDetail, type PlanItemRow } from '@service-center/shared';
import { api } from '../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { OrderTab, type OrderTabProps } from './OrderTab';
import type { OrderInsertPoint } from './insertPoint';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', () => ({ api: { addPlanItem: vi.fn(), clearPlanItems: vi.fn() } }));
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => ({ organizationId: 'org-1' }) }));

afterEach(cleanup);

const STAMP = '2026-01-01T00:00:00Z';

const item = (id: string, title: string, sortOrder: number): PlanItemDetail => ({
  id,
  plan_id: 'plan-1',
  item_type: 'item',
  title,
  song_id: null,
  arrangement_id: null,
  key_override: null,
  length_seconds: 60,
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

const items = [item('i-1', 'Welcome', 0), item('i-2', 'Sermon', 1)];
const plan: PlanDetail = {
  id: 'plan-1',
  organization_id: 'org-1',
  service_type_id: null,
  title: 'Sunday',
  service_date: '2026-11-22T10:00:00Z',
  location: null,
  status: 'draft',
  notes: null,
  content_revision: 1,
  staffing_revision: 1,
  created_by: null,
  created_at: STAMP,
  updated_at: STAMP,
  service_type: null,
  times: [],
  counts: { items: 2, songs: 0, confirmed: 0, unconfirmed: 0, declined: 0, prepared: 0 },
  items,
  assignments: [],
  plan_positions: [],
  position_needs: [],
  total_length_seconds: 120,
};

const threeItems = [item('i-1', 'Welcome', 0), item('i-2', 'Sermon', 1), item('i-3', 'Benediction', 2)];
const planOfThree: PlanDetail = { ...plan, items: threeItems, counts: { ...plan.counts, items: 3 } };

const addedRow = (title: string, itemType: PlanItemRow['item_type'], length: number): PlanItemRow & { content_revision: number } => ({
  ...item('new', title, 2),
  item_type: itemType,
  length_seconds: length,
  content_revision: 2,
});

const renderOrder = (overrides: Partial<OrderTabProps> = {}) => {
  const props: OrderTabProps = {
    plan,
    canManage: true,
    schedule: computePlanSchedule({ items: overrides.plan?.items ?? items, time: null }),
    timeZone: 'UTC',
    serviceTimes: [],
    selectedTimeId: null,
    onSelectTime: vi.fn(),
    positionNames: new Map(),
    busy: false,
    onAddSongs: vi.fn(),
    onAddOther: vi.fn(),
    insertPoint: null,
    onEditItem: vi.fn(),
    onMoveItem: vi.fn(),
    onReorderItems: vi.fn(),
    onRemoveItem: vi.fn(),
    onPrint: vi.fn(),
    onDiscussItem: vi.fn(),
    itemNoteCounts: new Map(),
    ...overrides,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter>
          <OrderTab {...props} />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return { props, user: userEvent.setup() };
};

/** jsdom has no layout: give each order row a 48px slot so drag collisions resolve. */
const layOutRows = () => {
  const original = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const row = this.closest('ol > li');
    if (!row) return original.call(this);
    const index = Array.from(row.parentElement!.children).indexOf(row);
    return { x: 0, y: index * 48, top: index * 48, left: 0, right: 600, bottom: index * 48 + 48, width: 600, height: 48, toJSON: () => ({}) } as DOMRect;
  });
};

/** Lets dnd-kit attach its document listeners (it waits a tick) and measure. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  vi.mocked(api.addPlanItem).mockReset();
  vi.mocked(api.clearPlanItems).mockReset();
});

it('opens the song browser at the end from the header, or between items from the +', async () => {
  const { props, user } = renderOrder();
  await user.click(await screen.findByRole('button', { name: 'Add songs' }));
  expect(props.onAddSongs).toHaveBeenLastCalledWith({ kind: 'end' } satisfies OrderInsertPoint);

  await user.click(screen.getByRole('button', { name: 'Add here, after Welcome' }));
  expect(props.onAddSongs).toHaveBeenLastCalledWith({ kind: 'after', itemId: 'i-1' } satisfies OrderInsertPoint);
  await user.click(screen.getByRole('button', { name: 'Add here, at the start' }));
  expect(props.onAddSongs).toHaveBeenLastCalledWith({ kind: 'after', itemId: null } satisfies OrderInsertPoint);

  await user.click(screen.getByRole('button', { name: 'Header or item' }));
  expect(props.onAddOther).toHaveBeenLastCalledWith({ kind: 'end' } satisfies OrderInsertPoint);
});

it('marks where new songs go while the browser is open', async () => {
  renderOrder({ insertPoint: { kind: 'after', itemId: 'i-1' } });
  const marker = await screen.findByText('New songs go here');
  const rows = [...document.querySelectorAll('ol > li')].map((row) => row.textContent ?? '');
  const markerIndex = rows.findIndex((text) => text === marker.closest('li')!.textContent);
  expect(rows[markerIndex - 1]).toContain('Welcome');
  expect(rows[markerIndex + 1]).toContain('Sermon');
});

// ------------------------------------------------------------ drag and drop --

it('drags an item to a new position with the keyboard and saves the whole order once', async () => {
  layOutRows();
  const { props } = renderOrder({ plan: planOfThree });
  const handle = await screen.findByRole('button', { name: 'Drag to reorder Welcome' });
  handle.focus();

  fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
  await settle();
  fireEvent.keyDown(handle, { key: 'ArrowDown', code: 'ArrowDown' });
  await settle();
  fireEvent.keyDown(handle, { key: 'ArrowDown', code: 'ArrowDown' });
  await settle();
  fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
  await settle();

  await waitFor(() => expect(props.onReorderItems).toHaveBeenCalledTimes(1));
  expect(props.onReorderItems).toHaveBeenCalledWith(['i-2', 'i-3', 'i-1']);
  // The drag's arrow keys did not also move the row selection or an item.
  expect(props.onMoveItem).not.toHaveBeenCalled();
});

it('sends nothing when a drag is cancelled or dropped where it started', async () => {
  layOutRows();
  const { props } = renderOrder({ plan: planOfThree });
  const handle = await screen.findByRole('button', { name: 'Drag to reorder Sermon' });
  handle.focus();

  fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
  await settle();
  fireEvent.keyDown(handle, { key: 'ArrowDown', code: 'ArrowDown' });
  await settle();
  fireEvent.keyDown(handle, { key: 'Escape', code: 'Escape' });
  await settle();

  fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
  await settle();
  fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
  await settle();

  expect(props.onReorderItems).not.toHaveBeenCalled();
});

it('offers no drag handles, quick add or clear to someone who cannot edit the order', async () => {
  renderOrder({ canManage: false });
  await screen.findByText('Welcome');
  expect(screen.queryByRole('button', { name: /Drag to reorder/ })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Quick add' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Clear order' })).toBeNull();
});

it('disables dragging while an order change is saving', async () => {
  renderOrder({ busy: true });
  expect((await screen.findByRole('button', { name: 'Drag to reorder Welcome' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Clear order' }) as HTMLButtonElement).disabled).toBe(true);
});

// --------------------------------------------------------------- quick add --

it('adds an item with its length from one typed line and keeps focus for the next', async () => {
  vi.mocked(api.addPlanItem).mockResolvedValue(addedRow('Welcome', 'item', 180));
  const { user } = renderOrder();
  const field = await screen.findByRole('textbox', { name: 'Quick add' });
  expect(field.getAttribute('placeholder')).toEqual(expect.stringContaining('Welcome 3:00'));
  expect(screen.getByText(/Start with # to add a header/)).toBeTruthy();

  await user.type(field, 'Welcome 3:00{Enter}');
  await waitFor(() => expect((field as HTMLInputElement).value).toBe(''));
  expect(api.addPlanItem).toHaveBeenCalledWith('plan-1', {
    item_type: 'item',
    title: 'Welcome',
    length_seconds: 180,
    idempotency_key: expect.any(String),
  });
  expect(document.activeElement).toBe(field);
  expect(await screen.findByText('Added Welcome.')).toBeTruthy();
});

it('adds a header from a line starting with #', async () => {
  vi.mocked(api.addPlanItem).mockResolvedValue(addedRow('Worship', 'header', 0));
  const { user } = renderOrder();
  const field = await screen.findByRole('textbox', { name: 'Quick add' });
  await user.type(field, '# Worship{Enter}');
  await waitFor(() => expect(api.addPlanItem).toHaveBeenCalledWith('plan-1', {
    item_type: 'header',
    title: 'Worship',
    length_seconds: 0,
    idempotency_key: expect.any(String),
  }));
});

it('explains a line it cannot read and sends nothing', async () => {
  const { user } = renderOrder();
  const field = await screen.findByRole('textbox', { name: 'Quick add' });
  await user.type(field, 'Welcome 3:75{Enter}');
  expect((await screen.findByRole('alert')).textContent).toContain('Write the length as 3:00, 1:05:00, 5m or 90s.');
  expect(field.getAttribute('aria-invalid')).toEqual('true');
  expect((field as HTMLInputElement).value).toBe('Welcome 3:75');
  expect(api.addPlanItem).not.toHaveBeenCalled();
});

it('keeps the line and reuses its key when the add fails, so a retry is not a second item', async () => {
  vi.mocked(api.addPlanItem)
    .mockRejectedValueOnce(new ApiError(500, 'Down', 'server_error'))
    .mockResolvedValueOnce(addedRow('Prayer', 'item', 90));
  const { user } = renderOrder();
  const field = await screen.findByRole('textbox', { name: 'Quick add' });
  await user.type(field, 'Prayer 90s{Enter}');
  await waitFor(() => expect(api.addPlanItem).toHaveBeenCalledTimes(1));
  expect((field as HTMLInputElement).value).toBe('Prayer 90s');
  await user.type(field, '{Enter}');
  await waitFor(() => expect((field as HTMLInputElement).value).toBe(''));
  const [first, second] = vi.mocked(api.addPlanItem).mock.calls;
  expect(second![1].idempotency_key).toBe(first![1].idempotency_key);
});

// --------------------------------------------------------------- shortcuts --

it('selects rows with j/k and the arrows, announcing which one is selected', async () => {
  renderOrder({ plan: planOfThree });
  await screen.findByText('Welcome');
  fireEvent.keyDown(document.body, { key: 'j' });
  const welcome = screen.getByText('Welcome').closest('li')!;
  expect(welcome.getAttribute('aria-current')).toEqual('true');
  expect(document.activeElement).toBe(welcome);
  expect(screen.getByText('Welcome selected, 1 of 3')).toBeTruthy();

  fireEvent.keyDown(welcome, { key: 'ArrowDown' });
  const sermon = screen.getByText('Sermon').closest('li')!;
  expect(sermon.getAttribute('aria-current')).toEqual('true');
  expect(welcome.getAttribute('aria-current')).toBeNull();
  fireEvent.keyDown(sermon, { key: 'k' });
  expect(welcome.getAttribute('aria-current')).toEqual('true');

  fireEvent.keyDown(welcome, { key: 'Escape' });
  expect(welcome.getAttribute('aria-current')).toBeNull();
});

it('moves, edits and removes the selected item from the keyboard', async () => {
  const { props } = renderOrder({ plan: planOfThree });
  await screen.findByText('Welcome');
  fireEvent.keyDown(document.body, { key: 'j' });
  const row = screen.getByText('Welcome').closest('li')!;

  fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true });
  expect(props.onMoveItem).toHaveBeenCalledWith(0, 1);
  // Already first: moving up does nothing.
  fireEvent.keyDown(row, { key: 'ArrowUp', altKey: true });
  expect(props.onMoveItem).toHaveBeenCalledTimes(1);

  fireEvent.keyDown(row, { key: 'e' });
  fireEvent.keyDown(row, { key: 'Enter' });
  expect(props.onEditItem).toHaveBeenCalledTimes(2);
  expect(props.onEditItem).toHaveBeenLastCalledWith(threeItems[0]);

  fireEvent.keyDown(row, { key: 'Delete' });
  fireEvent.keyDown(row, { key: 'Backspace' });
  expect(props.onRemoveItem).toHaveBeenCalledTimes(2);
  expect(props.onRemoveItem).toHaveBeenLastCalledWith(threeItems[0]);
});

it('ignores shortcuts while typing in a field, and Enter on a button keeps its own meaning', async () => {
  const { props, user } = renderOrder({ plan: planOfThree });
  const field = await screen.findByRole('textbox', { name: 'Quick add' });
  await user.type(field, 'jk');
  expect(document.querySelector('[aria-current="true"]')).toBeNull();
  expect((field as HTMLInputElement).value).toBe('jk');

  fireEvent.keyDown(document.body, { key: 'j' });
  const editButton = screen.getByRole('button', { name: 'Edit Sermon' });
  fireEvent.keyDown(editButton, { key: 'Enter' });
  expect(props.onEditItem).not.toHaveBeenCalled();
});

it('focuses quick add with n and opens the shortcut help with ?', async () => {
  const { user } = renderOrder();
  const field = await screen.findByRole('textbox', { name: 'Quick add' });
  fireEvent.keyDown(document.body, { key: 'n' });
  expect(document.activeElement).toBe(field);
  // Typing n in the field types it.
  await user.keyboard('n');
  expect((field as HTMLInputElement).value).toBe('n');

  field.blur();
  fireEvent.keyDown(document.body, { key: '?', shiftKey: true });
  const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
  expect(within(dialog).getByText('Move the selected item down')).toBeTruthy();
  expect(within(dialog).getByText('Alt + ↓')).toBeTruthy();
  // With the dialog open the order's shortcuts are off.
  fireEvent.keyDown(document.body, { key: 'j' });
  expect(document.querySelector('[aria-current="true"]')).toBeNull();
});

it('does not move, edit or remove from the keyboard for someone who cannot edit', async () => {
  const { props } = renderOrder({ canManage: false });
  await screen.findByText('Welcome');
  fireEvent.keyDown(document.body, { key: 'j' });
  const row = screen.getByText('Welcome').closest('li')!;
  fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true });
  fireEvent.keyDown(row, { key: 'e' });
  fireEvent.keyDown(row, { key: 'Delete' });
  expect(props.onMoveItem).not.toHaveBeenCalled();
  expect(props.onEditItem).not.toHaveBeenCalled();
  expect(props.onRemoveItem).not.toHaveBeenCalled();
});

// ------------------------------------------------------------- clear order --

it('confirms clearing the order with the number of items, then clears with the revision on screen', async () => {
  vi.mocked(api.clearPlanItems).mockResolvedValue({ removed: 2, content_revision: 4 });
  const { user } = renderOrder();
  await user.click(await screen.findByRole('button', { name: 'Clear order' }));
  const dialog = await screen.findByRole('dialog', { name: 'Clear the order?' });
  expect(dialog.textContent).toContain('This removes all 2 items from “Sunday”, together with their notes, comments and file links.');

  await user.click(within(dialog).getByRole('button', { name: 'Clear order' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.clearPlanItems).toHaveBeenCalledWith('plan-1', 1);
});

it('cancelling the clear dialog removes nothing', async () => {
  const { user } = renderOrder();
  await user.click(await screen.findByRole('button', { name: 'Clear order' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.clearPlanItems).not.toHaveBeenCalled();
});

it('explains a refused clear while the plan runs live and keeps the dialog open', async () => {
  vi.mocked(api.clearPlanItems).mockRejectedValue(new ApiError(409, 'Live', 'live_run_active'));
  const { user } = renderOrder();
  await user.click(await screen.findByRole('button', { name: 'Clear order' }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Clear order' }));
  expect(await within(dialog).findByText(/This plan is running live/)).toBeTruthy();
});

it('offers no clear action for an empty order', async () => {
  renderOrder({ plan: { ...plan, items: [], counts: { ...plan.counts, items: 0 } } });
  await screen.findByRole('textbox', { name: 'Quick add' });
  expect(screen.queryByRole('button', { name: 'Clear order' })).toBeNull();
});
