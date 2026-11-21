import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlanDetail, PlanItemDetail, SongListItem } from '@service-center/shared';
import { api } from '../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { EditItemModal } from './EditItemModal';

vi.mock('../../lib/api', () => ({
  api: { getSong: vi.fn(), listSongs: vi.fn(), listPeople: vi.fn(), getArrangementMaterials: vi.fn(), updatePlanItem: vi.fn() },
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => ({ organizationId: 'org-1', user: null }) }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const STAMP = '2026-01-01T00:00:00Z';

const song = (id: string, title: string, author: string): SongListItem => ({
  archived_at: null,
  revision: 1,
  id,
  organization_id: 'org-1',
  title,
  author,
  ccli_number: null,
  copyright: null,
  administration: null,
  default_key: 'D',
  default_bpm: 72,
  meter: null,
  themes: [],
  song_types: [],
  style: null,
  speed: null,
  notes: null,
  created_by: null,
  created_at: STAMP,
  updated_at: STAMP,
  arrangements: [],
  last_scheduled_at: null,
  usage_count: 0,
  in_plan: false,
});

const item: PlanItemDetail = {
  id: 'i-1',
  plan_id: 'plan-1',
  item_type: 'song',
  title: 'Goodness of God',
  song_id: 's-1',
  arrangement_id: null,
  key_override: null,
  length_seconds: 0,
  description: null,
  sort_order: 0,
  sequence_override: null,
  leader_person_id: null,
  leader_position_id: null,
  service_segment: 'service',
  created_at: STAMP,
  updated_at: STAMP,
  song: { id: 's-1', title: 'Goodness of God', author: 'Bethel', copyright: null, default_key: 'Ab', default_bpm: 63 },
  arrangement: null,
};

const plan: PlanDetail = {
  id: 'plan-1',
  organization_id: 'org-1',
  service_type_id: 'sunday',
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
  service_type: { id: 'sunday', name: 'Sunday Service', recurrence: 'weekly' },
  times: [],
  counts: { items: 1, songs: 1, confirmed: 0, unconfirmed: 0, declined: 0, prepared: 0 },
  items: [item],
  assignments: [],
  plan_positions: [],
  position_needs: [],
  total_length_seconds: 0,
};

it('changes the song from the server-searched list, showing author and key, without submitting on Enter', async () => {
  const user = userEvent.setup();
  vi.mocked(api.getSong).mockImplementation(async (id) => ({ ...song(id, id === 's-1' ? 'Goodness of God' : 'Chúa Là Tình Yêu', 'Bethel') }));
  vi.mocked(api.listPeople).mockResolvedValue([]);
  vi.mocked(api.listSongs).mockImplementation(async (query) => {
    const rows = query?.q ? [song('s-2', 'Chúa Là Tình Yêu', 'Hồng Ân')] : [song('s-1', 'Goodness of God', 'Bethel'), song('s-2', 'Chúa Là Tình Yêu', 'Hồng Ân')];
    return { data: rows, page: 1, per_page: 10, total: rows.length };
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageProvider>
        <EditItemModal plan={plan} item={item} teams={[]} onClose={vi.fn()} />
      </LanguageProvider>
    </QueryClientProvider>,
  );

  expect(api.listSongs).not.toHaveBeenCalled();
  await user.click(await screen.findByRole('button', { name: 'Change song' }));
  const search = await screen.findByRole('searchbox', { name: 'Find a song' });
  // Enter before the search settles picks nothing (and never submits the form).
  await user.type(search, 'chua{Enter}');
  expect(screen.getByRole('searchbox', { name: 'Find a song' })).toBeTruthy();
  await waitFor(() => expect(vi.mocked(api.listSongs).mock.calls.at(-1)?.[0]).toMatchObject({ q: 'chua', sort: 'title', plan_id: 'plan-1', per_page: 10 }));
  await waitFor(() => expect(screen.queryByText('Goodness of God', { selector: 'li span' })).toBeNull());
  expect(screen.getByText('Chúa Là Tình Yêu').closest('li')!.textContent).toContain('Hồng Ân');
  expect(screen.getByText('Chúa Là Tình Yêu').closest('li')!.textContent).toContain('D · 72 bpm');
  expect(api.updatePlanItem).not.toHaveBeenCalled();

  expect(screen.getByRole('button', { name: 'Use Chúa Là Tình Yêu' })).toBeTruthy();
  await user.keyboard('{Enter}');
  expect(screen.queryByRole('searchbox', { name: 'Find a song' })).toBeNull();
  expect(await screen.findByText('Chúa Là Tình Yêu')).toBeTruthy();
});
