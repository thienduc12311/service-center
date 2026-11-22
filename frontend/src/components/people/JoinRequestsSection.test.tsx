import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '@service-center/shared';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { api } from '../../lib/api';
import { JoinRequestsSection } from './JoinRequestsSection';

vi.mock('../../lib/api', () => ({ api: { churchJoinRequests: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ organizationId: 'org-1', user: null }),
}));

afterEach(cleanup);

const renderSection = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageProvider>
        <MemoryRouter>
          <JoinRequestsSection onInvited={vi.fn()} />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );

it('shows a failed load with Try again and never the empty state (W10-WEB-D1)', async () => {
  const user = userEvent.setup();
  vi.mocked(api.churchJoinRequests)
    .mockRejectedValueOnce(new ApiError(503, 'Service unavailable'))
    .mockResolvedValueOnce({ pending: [], recent: [] });
  renderSection();

  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('No one is waiting to join.')).toBeNull();
  expect(screen.queryByText('0')).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Try again' }));

  expect(await screen.findByText('No one is waiting to join.')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(api.churchJoinRequests).toHaveBeenCalledTimes(2);
});
