import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@service-center/shared';
import { api } from '../lib/api';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { CalendarPage } from './CalendarPage';

vi.mock('../lib/api', () => ({
  api: {
    calendar: vi.fn(),
    calendarLayers: vi.fn(),
    listTeams: vi.fn(),
    listServiceTypes: vi.fn(),
    scopedCalendarFeeds: vi.fn(),
  },
}));
vi.mock('../providers/AuthProvider', () => ({
  useAuth: () => ({ organizationId: 'org-1', canAnywhere: () => false, can: () => false }),
}));
vi.mock('../lib/supabase', () => ({ supabase: {} }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const event = (n: number, day: number): CalendarEvent => ({
  id: `time-${n}`,
  plan_id: `plan-${n}`,
  title: `Service ${n}`,
  kind: 'service',
  starts_at: new Date(2027, 2, day, 8 + n).toISOString(),
  ends_at: new Date(2027, 2, day, 9 + n).toISOString(),
  status: 'published',
  location: null,
  service_type: null,
});

/** Shows where the page put the month and team, so the URL state can be checked. */
const LocationProbe = () => <output data-testid="location">{useLocation().search}</output>;

const renderCalendar = (events: CalendarEvent[], search = '?month=2027-03') => {
  vi.mocked(api.calendar).mockResolvedValue(events);
  vi.mocked(api.calendarLayers).mockResolvedValue([]);
  vi.mocked(api.listTeams).mockResolvedValue([]);
  vi.mocked(api.listServiceTypes).mockResolvedValue([]);
  vi.mocked(api.scopedCalendarFeeds).mockResolvedValue([]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[`/calendar${search}`]}>
          <Routes>
            <Route path="/calendar" element={<><CalendarPage /><LocationProbe /></>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
};

describe('web calendar', () => {
  it('opens a busy day in full from its "+N more" button', async () => {
    const busy = [1, 2, 3, 4, 5].map((n) => event(n, 14));
    const user = renderCalendar([...busy, event(6, 20)]);

    expect(await screen.findByText('Service 1')).toBeTruthy();
    expect(screen.queryByText('Service 4')).toBeNull();
    const more = screen.getByRole('button', { name: /Show all of .* \(2 more\)/ });
    expect(more.textContent).toBe('+2 more');

    await user.click(more);
    const dialog = await screen.findByRole('dialog');
    for (const n of [1, 2, 3, 4, 5]) expect(within(dialog).getByText(`Service ${n}`)).toBeTruthy();
    expect(within(dialog).queryByText('Service 6')).toBeNull();
    expect(within(dialog).getByRole('link', { name: /Service 4/ }).getAttribute('href')).toBe('/plans/plan-4');

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reads the month from the URL and keeps it there when paging', async () => {
    const user = renderCalendar([event(1, 14)]);
    expect(await screen.findByText('Service 1')).toBeTruthy();
    expect(vi.mocked(api.calendar).mock.calls[0]?.[0].from.startsWith('2027-02')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByTestId('location').textContent).toBe('?month=2027-04');
  });

  it('groups the agenda under one heading per day', async () => {
    const user = renderCalendar([event(1, 14), event(2, 14), event(3, 20)]);
    await screen.findByText('Service 1');
    await user.click(screen.getByRole('radio', { name: 'Agenda' }));

    const first = screen.getByRole('region', { name: /March 14, 2027/ });
    const second = screen.getByRole('region', { name: /March 20, 2027/ });
    expect(within(first).getAllByRole('link').map((link) => link.textContent)).toEqual([
      expect.stringContaining('Service 1'),
      expect.stringContaining('Service 2'),
    ]);
    expect(within(second).getAllByRole('link')).toHaveLength(1);
    expect(within(second).getByText('Service 3')).toBeTruthy();
  });
});
