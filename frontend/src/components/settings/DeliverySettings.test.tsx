import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryListItem, DeliveryTransportStatus } from '@service-center/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../providers/AuthProvider';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { DeliverySettings } from './DeliverySettings';

vi.mock('../../lib/api', () => ({
  api: {
    deliveryStatus: vi.fn(),
    listDeliveries: vi.fn(),
  },
}));
vi.mock('../../providers/AuthProvider', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const renderSettings = (workerConfigured: boolean, deliveries: DeliveryListItem[] = []) => {
  vi.mocked(useAuth).mockReturnValue({ organizationId: 'org-1' } as unknown as ReturnType<typeof useAuth>);
  const status: DeliveryTransportStatus = {
    email: 'resend',
    push: 'expo',
    worker_configured: workerConfigured,
    pending: 0,
    needs_attention: 0,
  };
  vi.mocked(api.deliveryStatus).mockResolvedValue(status);
  vi.mocked(api.listDeliveries).mockResolvedValue({ data: deliveries, next_before: null });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageProvider>
        <DeliverySettings />
      </LanguageProvider>
    </QueryClientProvider>,
  );
};

describe('delivery settings worker warning', () => {
  it('lists the paused work and the immediate mention emails when no worker is configured', async () => {
    renderSettings(false);

    const warning = await screen.findByRole('status');
    expect(warning.textContent).toContain('No scheduled delivery worker is configured');
    const paused = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(paused).toEqual(['Reminders', 'Scheduled releases', 'Retries of failed sends']);
    expect(warning.textContent).toContain('@mention emails go out immediately instead of after about 10 minutes.');
  });

  it('shows no warning when the worker is configured', async () => {
    renderSettings(true);

    expect(await screen.findByText('Sent through Resend')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/No scheduled delivery worker/)).toBeNull();
  });
});

const delivery = (overrides: Partial<DeliveryListItem>): DeliveryListItem => ({
  id: 'd-1',
  recipient_id: 'u-1',
  recipient_person_id: 'p-1',
  recipient_name: 'Morgan Patel',
  channel: 'email',
  status: 'failed',
  attempts: 1,
  error_code: null,
  accepted_at: null,
  delivered_at: null,
  completed_at: null,
  next_attempt_at: null,
  retryable: true,
  template: 'assignment_request',
  plan_id: 'plan-1',
  plan_title: 'Sunday Morning',
  created_at: '2026-11-21T12:00:00.000Z',
  ...overrides,
});

describe('delivery settings list context', () => {
  it('names the kind of delivery when it has no plan, and a deleted plan only when its plan is gone', async () => {
    renderSettings(true, [
      delivery({ id: 'chat', template: 'conversation_message', plan_id: null, plan_title: null }),
      delivery({ id: 'gone', plan_id: 'plan-2', plan_title: null }),
      delivery({ id: 'plan' }),
    ]);

    expect(await screen.findByText(/^Team chat ·/)).toBeTruthy();
    expect(screen.getByText(/^Deleted plan ·/)).toBeTruthy();
    expect(screen.getByText(/^Sunday Morning ·/)).toBeTruthy();
  });
});
