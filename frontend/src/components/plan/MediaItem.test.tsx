import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { computePlanSchedule, type MediaList, type MediaSummary, type PlanDetail, type PlanItemDetail } from '@service-center/shared';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { api } from '../../lib/api';
import { LinkMediaModal } from '../media/LinkMediaModal';
import { AddItemModal } from './AddItemModal';
import { OrderTab, type OrderTabProps } from './OrderTab';

vi.mock('../../lib/api', () => ({
  api: { addPlanItem: vi.fn(), getPlan: vi.fn(), reorderPlanItems: vi.fn(), mediaList: vi.fn(), fileDownload: vi.fn(), setPlanItemMedia: vi.fn() },
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ organizationId: 'org-1', session: { user: { id: 'user-1' } }, role: 'admin', access: null }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const STAMP = '2026-01-01T00:00:00Z';
const MEDIA_ID = '00000000-0000-4000-8000-0000000000aa';

const summary = (id: string, title: string, duration: number | null, thumbnail: string | null = null): MediaSummary => ({
  id, title, creator: null, duration_seconds: duration, themes: [], tags: [], notes: null, thumbnail_file_id: thumbnail,
  archive_on: null, archived_at: null, is_archived: false, revision: 1, created_at: STAMP, updated_at: STAMP,
  usage_count: 0, last_used_on: null,
});

const mediaList = (media: MediaSummary[]): MediaList => ({ media, can_create: true, total: media.length, truncated: false } as MediaList);

const wrap = (node: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageProvider>
        <MemoryRouter>{node}</MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );

it('adds a media item from the media library, its title and length taken from the media', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  vi.mocked(api.mediaList).mockResolvedValue(mediaList([summary(MEDIA_ID, 'Countdown video', 300), summary('m-2', 'Bumper', 30)]));
  vi.mocked(api.addPlanItem).mockResolvedValue({ id: 'new' } as Awaited<ReturnType<typeof api.addPlanItem>>);
  wrap(<AddItemModal open planId="plan-1" onClose={onClose} />);

  await user.click(await screen.findByRole('button', { name: 'Media' }));
  // Nothing to add until media is chosen: the title and length wait for it.
  expect(screen.getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true);
  expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();

  const row = (await screen.findByText('Countdown video')).closest('li')!;
  await user.click(within(row).getByRole('button', { name: 'Choose' }));
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveProperty('value', 'Countdown video');
  expect(screen.getByRole('textbox', { name: 'Length' })).toHaveProperty('value', '5:00');

  await user.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(api.addPlanItem).toHaveBeenCalledExactlyOnceWith('plan-1', {
    item_type: 'media',
    title: 'Countdown video',
    media_id: MEDIA_ID,
    length_seconds: 300,
    description: null,
    idempotency_key: expect.any(String),
  });
});

it('lets the planner change the chosen media and points to the library when there is none', async () => {
  const user = userEvent.setup();
  vi.mocked(api.mediaList).mockResolvedValueOnce(mediaList([summary(MEDIA_ID, 'Countdown video', 300)]));
  wrap(<AddItemModal open planId="plan-1" onClose={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Media' }));
  await user.click(await screen.findByRole('button', { name: 'Choose' }));
  vi.mocked(api.mediaList).mockResolvedValue(mediaList([]));
  await user.click(screen.getByRole('button', { name: 'Change' }));
  await user.type(screen.getByRole('searchbox', { name: 'Find media' }), 'nothing');
  expect(await screen.findByRole('link', { name: 'Open the media library' })).toBeTruthy();
  expect(api.addPlanItem).not.toHaveBeenCalled();
});

const mediaItem: PlanItemDetail = {
  id: 'i-m', plan_id: 'plan-1', item_type: 'media', title: 'Welcome loop', song_id: null, arrangement_id: null, key_override: null,
  length_seconds: 120, description: null, sort_order: 0, sequence_override: null, leader_person_id: null, leader_position_id: null,
  service_segment: 'service', media_id: MEDIA_ID, created_at: STAMP, updated_at: STAMP, song: null, arrangement: null,
  media: { id: MEDIA_ID, title: 'Countdown video', creator: null, duration_seconds: 300, archived: false, thumbnail_file_id: 'thumb-1' },
};
const plan = {
  id: 'plan-1', organization_id: 'org-1', service_type_id: null, title: 'Sunday', service_date: '2026-11-22T10:00:00Z', location: null,
  status: 'draft', notes: null, content_revision: 4, staffing_revision: 1, created_by: null, created_at: STAMP, updated_at: STAMP,
  service_type: null, times: [], counts: { items: 1, songs: 0, confirmed: 0, unconfirmed: 0, declined: 0, prepared: 0 },
  items: [mediaItem], assignments: [], plan_positions: [], position_needs: [], total_length_seconds: 120,
} as PlanDetail;

it('shows a media row with its thumbnail and a way to change its media', async () => {
  vi.mocked(api.fileDownload).mockResolvedValue({ url: 'https://files.example/thumb.png' } as Awaited<ReturnType<typeof api.fileDownload>>);
  vi.mocked(api.mediaList).mockResolvedValue(mediaList([summary(MEDIA_ID, 'Countdown video', 300)]));
  const props: OrderTabProps = {
    plan, canManage: true, schedule: computePlanSchedule({ items: plan.items, time: null }), timeZone: 'UTC', serviceTimes: [],
    selectedTimeId: null, onSelectTime: vi.fn(), positionNames: new Map(), busy: false, onAddSongs: vi.fn(), onAddOther: vi.fn(),
    insertPoint: null, onEditItem: vi.fn(), onMoveItem: vi.fn(), onReorderItems: vi.fn(), onRemoveItem: vi.fn(), onPrint: vi.fn(), onDiscussItem: vi.fn(),
    itemNoteCounts: new Map(),
  };
  const user = userEvent.setup();
  wrap(<OrderTab {...props} />);

  await waitFor(() =>
    expect(screen.getByRole('img', { name: 'Media item: Countdown video' }).getAttribute('src')).toBe('https://files.example/thumb.png'),
  );
  expect(api.fileDownload).toHaveBeenCalledWith('thumb-1', { disposition: 'inline' });
  expect(screen.getByText('Welcome loop')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Media for Welcome loop' }));
  const dialog = await screen.findByRole('dialog');
  // A media item always names its media: it can be changed, not removed.
  expect(within(dialog).queryByRole('button', { name: 'Remove link' })).toBeNull();
  expect(await within(dialog).findByRole('button', { name: 'Current' })).toHaveProperty('disabled', true);
});

it('never downloads a thumbnail a media item does not have', async () => {
  vi.mocked(api.mediaList).mockResolvedValue(mediaList([]));
  wrap(
    <LinkMediaModal plan={plan} item={{ ...mediaItem, media: { ...mediaItem.media!, thumbnail_file_id: null } }} onClose={vi.fn()} />,
  );
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(await screen.findByRole('link', { name: 'Open the media library' })).toBeTruthy();
  expect(api.fileDownload).not.toHaveBeenCalled();
});
