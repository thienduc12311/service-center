import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_UNDO_MS, type NotificationFeed, type NotificationFeedItem } from '@service-center/shared';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { NotificationsPage } from './NotificationsPage';

vi.mock('../lib/api', () => ({
  api: {
    listNotifications: vi.fn(),
    unreadNotificationCount: vi.fn(),
    markNotificationsRead: vi.fn(),
    deleteNotification: vi.fn(),
    clearReadNotifications: vi.fn(),
  },
}));
vi.mock('../providers/AuthProvider', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

const notification = (id: string, title: string, readAt: string | null): NotificationFeedItem =>
  ({
    id,
    organization_id: 'org-1',
    user_id: 'user-1',
    type: 'assignment_scheduled',
    title,
    body: null,
    plan_id: null,
    assignment_id: null,
    read_at: readAt,
    created_by: null,
    created_at: '2026-11-01T10:00:00Z',
    operational_message_id: null,
    conversation_id: null,
    plan: null,
  }) as unknown as NotificationFeedItem;

const renderPage = () => {
  vi.mocked(useAuth).mockReturnValue({ organizationId: 'org-1' } as unknown as ReturnType<typeof useAuth>);
  const feed: NotificationFeed = {
    items: [notification('n-1', 'Unread one', null), notification('n-2', 'Read one', '2026-11-02T10:00:00Z')],
    unread: 1,
    next_cursor: null,
  };
  vi.mocked(api.listNotifications).mockResolvedValue(feed);
  vi.mocked(api.unreadNotificationCount).mockResolvedValue({ unread: 1, account_unread: 1 });
  vi.mocked(api.deleteNotification).mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LanguageProvider>
          <NotificationsPage />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('notification clean-up on web', () => {
  it('hides a deleted notification at once and restores it on Undo without deleting', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.click(await screen.findByRole('button', { name: 'Delete notification: Unread one' }));
    expect(screen.queryByText('Unread one')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Notification deleted');

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Unread one')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(NOTIFICATION_UNDO_MS + 100);
    });
    expect(api.deleteNotification).not.toHaveBeenCalled();
  });

  it('deletes on the server once the undo window passes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.click(await screen.findByRole('button', { name: 'Delete notification: Read one' }));
    expect(api.deleteNotification).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(NOTIFICATION_UNDO_MS);
    });
    await waitFor(() => expect(api.deleteNotification).toHaveBeenCalledExactlyOnceWith('n-2'));
  });

  it('keeps keyboard focus on the list after deleting and after Undo', async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete notification: Unread one' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete notification: Read one' })),
    );

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete notification: Unread one' })),
    );
  });

  it('moves focus to Undo when the last visible notification is deleted', async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete notification: Unread one' }));
    await user.click(screen.getByRole('button', { name: 'Delete notification: Read one' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo' })));
  });

  it('commits a pending delete when the page is left', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete notification: Read one' }));
    cleanup();
    await waitFor(() => expect(api.deleteNotification).toHaveBeenCalledExactlyOnceWith('n-2'));
  });

  it('clears read notifications only after confirming', async () => {
    renderPage();
    const user = userEvent.setup();
    vi.mocked(api.clearReadNotifications).mockResolvedValue({ deleted: 1, unread: 1, account_unread: 1 });

    await user.click(await screen.findByRole('button', { name: 'Clear all read' }));
    const dialog = await screen.findByRole('dialog', { name: 'Clear read notifications?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.clearReadNotifications).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Clear all read' }));
    await user.click(screen.getByRole('button', { name: 'Clear read' }));
    await waitFor(() => expect(api.clearReadNotifications).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
