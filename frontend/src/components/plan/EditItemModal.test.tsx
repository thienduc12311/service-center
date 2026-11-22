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

const TIMES: PlanDetail['times'] = [
  { id: 't-9', plan_id: 'plan-1', kind: 'service', name: '9am', starts_at: '2026-11-22T09:00:00Z', ends_at: '2026-11-22T10:00:00Z', created_at: STAMP, sort_order: 0, ics_sequence: 0 },
  { id: 't-11', plan_id: 'plan-1', kind: 'service', name: '11am', starts_at: '2026-11-22T11:00:00Z', ends_at: '2026-11-22T12:00:00Z', created_at: STAMP, sort_order: 1, ics_sequence: 0 },
  { id: 't-r', plan_id: 'plan-1', kind: 'rehearsal', name: 'Run-through', starts_at: '2026-11-21T18:00:00Z', ends_at: '2026-11-21T20:00:00Z', created_at: STAMP, sort_order: 2, ics_sequence: 0 },
] as PlanDetail['times'];

const renderModal = (target: PlanItemDetail, detail: PlanDetail = { ...plan, times: TIMES }) => {
  vi.mocked(api.getSong).mockResolvedValue(song('s-1', 'Goodness of God', 'Bethel'));
  vi.mocked(api.listPeople).mockResolvedValue([]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageProvider>
        <EditItemModal plan={detail} item={target} teams={[]} onClose={vi.fn()} timeZone="UTC" />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
};

it('limits an item to chosen service times (never rehearsals) and back to all', async () => {
  vi.mocked(api.updatePlanItem).mockResolvedValue({ ...item, content_revision: 2 });
  const user = renderModal(item);
  expect((await screen.findByRole('radio', { name: 'All service times' }) as HTMLInputElement).checked).toBe(true);
  await user.click(screen.getByRole('radio', { name: 'Only these service times' }));
  expect(screen.getByRole('checkbox', { name: /9am/ })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: /11am/ })).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: /Run-through/ })).toBeNull();

  // Nothing ticked: refused before saving.
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Choose at least one service time, or choose “All service times”.')).toBeTruthy();
  expect(api.updatePlanItem).not.toHaveBeenCalled();

  await user.click(screen.getByRole('checkbox', { name: /11am/ }));
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.updatePlanItem).toHaveBeenCalledWith('plan-1', 'i-1', { time_ids: ['t-11'], expected_revision: 1 }));
});

it('clears a limit with "All service times"', async () => {
  vi.mocked(api.updatePlanItem).mockResolvedValue({ ...item, content_revision: 2 });
  const user = renderModal({ ...item, item_times: [{ plan_time_id: 't-9' }] });
  expect((await screen.findByRole('checkbox', { name: /9am/ }) as HTMLInputElement).checked).toBe(true);
  await user.click(screen.getByRole('radio', { name: 'All service times' }));
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.updatePlanItem).toHaveBeenCalledWith('plan-1', 'i-1', { time_ids: [], expected_revision: 1 }));
});

it('says when the plan has no service times', async () => {
  renderModal(item, { ...plan, times: [] });
  expect(await screen.findByText('This plan has no service times yet, so the item is in every time.')).toBeTruthy();
});

it('writes details with the toolbar, previews them safely and saves them', async () => {
  vi.mocked(api.updatePlanItem).mockResolvedValue({ ...item, content_revision: 2 });
  const user = renderModal(item);
  const details = await screen.findByRole('textbox', { name: 'Details' });
  await user.click(screen.getByRole('button', { name: 'Heading' }));
  expect((details as HTMLTextAreaElement).value).toBe('## Heading');
  await user.clear(details);
  await user.click(details);
  // Pasted: typing would read "[" as a key descriptor.
  await user.paste('Start **soft** see [chart](https://example.com/c) <img src=x onerror=alert(1)>');

  await user.click(screen.getByRole('radio', { name: 'Preview' }));
  const preview = screen.getByRole('region', { name: 'Preview' });
  expect(preview.querySelector('span.font-semibold')?.textContent).toBe('soft');
  const link = preview.querySelector('a')!;
  expect(link.getAttribute('href')).toBe('https://example.com/c');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(preview.querySelector('img')).toBeNull();
  expect(preview.textContent).toContain('<img src=x onerror=alert(1)>');

  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(api.updatePlanItem).toHaveBeenCalledWith('plan-1', 'i-1', {
      details: 'Start **soft** see [chart](https://example.com/c) <img src=x onerror=alert(1)>',
      expected_revision: 1,
    }),
  );
});

it('shows an empty preview and refuses details over the limit', async () => {
  const user = renderModal(item);
  await user.click(await screen.findByRole('radio', { name: 'Preview' }));
  expect(screen.getByText('Nothing to preview yet.')).toBeTruthy();
  await user.click(screen.getByRole('radio', { name: 'Write' }));
  const details = screen.getByRole('textbox', { name: 'Details' });
  await user.click(details);
  await user.paste('x'.repeat(20_001));
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Details can be at most 20,000 characters.')).toBeTruthy();
  expect(api.updatePlanItem).not.toHaveBeenCalled();
});
