import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { api } from '../../lib/api';
import { AddItemModal } from './AddItemModal';

vi.mock('../../lib/api', () => ({ api: { addPlanItem: vi.fn(), getPlan: vi.fn(), reorderPlanItems: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => ({ organizationId: null }) }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('adds a free-form entry with its own title, duration and notes', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider>
        <AddItemModal open planId="plan-1" onClose={onClose} />
      </LanguageProvider>
    </QueryClientProvider>,
  );

  const freeForm = await screen.findByRole('button', { name: 'Free-form item' });
  await user.click(freeForm);
  expect(freeForm.getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('textbox', { name: 'Find a song' })).toBeNull();

  const title = screen.getByRole('textbox', { name: 'Title' });
  const length = screen.getByRole('textbox', { name: 'Length' });
  const add = screen.getByRole('button', { name: 'Add' });
  await user.type(title, '  ');
  await user.click(add);
  expect((await screen.findByRole('alert')).textContent).toContain('Give the item a title.');

  await user.clear(title);
  await user.type(title, '  Welcome and announcements  ');
  await user.type(length, 'two minutes');
  await user.click(add);
  expect(screen.getByRole('alert').textContent).toContain('Enter the length as minutes:seconds');
  expect(api.addPlanItem).not.toHaveBeenCalled();

  await user.clear(length);
  await user.type(length, '2:30');
  await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'Announce next week’s rehearsal.');
  await user.click(add);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(api.addPlanItem).toHaveBeenCalledExactlyOnceWith('plan-1', {
    item_type: 'item',
    title: 'Welcome and announcements',
    length_seconds: 150,
    description: 'Announce next week’s rehearsal.',
    song_id: null,
    arrangement_id: null,
    key_override: null,
    idempotency_key: expect.any(String),
  });
});

it('puts a header at the chosen insert point and reports the new item', async () => {
  const user = userEvent.setup();
  const onAdded = vi.fn();
  const row = (id: string) => ({ id });
  vi.mocked(api.addPlanItem).mockResolvedValue({ id: 'new-h' } as Awaited<ReturnType<typeof api.addPlanItem>>);
  vi.mocked(api.getPlan).mockResolvedValue({ content_revision: 7, items: [row('a'), row('b'), row('new-h')] } as Awaited<ReturnType<typeof api.getPlan>>);
  vi.mocked(api.reorderPlanItems).mockResolvedValue([]);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider>
        <AddItemModal open planId="plan-1" insertPoint={{ kind: 'after', itemId: 'a' }} onAdded={onAdded} onClose={vi.fn()} />
      </LanguageProvider>
    </QueryClientProvider>,
  );

  // Songs are added from the song browser; this form is for headers and items.
  expect(screen.queryByRole('button', { name: 'Song' })).toBeNull();
  await user.click(await screen.findByRole('button', { name: 'Header' }));
  await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Worship');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(onAdded).toHaveBeenCalledWith('new-h'));
  expect(api.addPlanItem).toHaveBeenCalledWith('plan-1', expect.objectContaining({ item_type: 'header', title: 'Worship' }));
  expect(api.reorderPlanItems).toHaveBeenCalledExactlyOnceWith('plan-1', ['a', 'new-h', 'b'], 7);
});
