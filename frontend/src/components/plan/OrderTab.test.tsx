import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { computePlanSchedule, type PlanDetail, type PlanItemDetail } from '@service-center/shared';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { OrderTab, type OrderTabProps } from './OrderTab';
import type { OrderInsertPoint } from './insertPoint';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', () => ({ api: {} }));
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

const renderOrder = (overrides: Partial<OrderTabProps> = {}) => {
  const props: OrderTabProps = {
    plan,
    canManage: true,
    schedule: computePlanSchedule({ items, time: null }),
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
    onRemoveItem: vi.fn(),
    onPrint: vi.fn(),
    onDiscussItem: vi.fn(),
    itemNoteCounts: new Map(),
    ...overrides,
  };
  render(
    <LanguageProvider>
      <MemoryRouter>
        <OrderTab {...props} />
      </MemoryRouter>
    </LanguageProvider>,
  );
  return { props, user: userEvent.setup() };
};

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
