import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlanPublishPreview } from '@service-center/shared';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { api } from '../../lib/api';
import { PublishPlanModal } from './PublishPlanModal';

vi.mock('../../lib/api', () => ({ api: { planPublishPreview: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => ({ organizationId: null }) }));

afterEach(cleanup);

const renderModal = (preview: PlanPublishPreview, onPublish = vi.fn()) => {
  vi.mocked(api.planPublishPreview).mockResolvedValue(preview);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider>
        <PublishPlanModal open planId="plan-1" publishing={false} error={null} onClose={vi.fn()} onPublish={onPublish} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return onPublish;
};

it('says who will be emailed and who has no address, with "Notify people" ticked', async () => {
  const user = userEvent.setup();
  const onPublish = renderModal({ will_notify: 3, no_email: ['Alex Kim'] });

  expect(await screen.findByText('Publishing will email 3 people.')).toBeTruthy();
  expect(screen.getByText('No email address on file, so not emailed: Alex Kim.')).toBeTruthy();
  const notify = screen.getByRole('checkbox', { name: /Notify people/ }) as HTMLInputElement;
  expect(notify.checked).toBe(true);

  await user.click(screen.getByRole('button', { name: 'Publish' }));
  expect(onPublish).toHaveBeenCalledExactlyOnceWith(true);
});

it('can publish quietly', async () => {
  const user = userEvent.setup();
  const onPublish = renderModal({ will_notify: 0, no_email: [] });

  expect(await screen.findByText("Nobody is waiting to be asked, so publishing won't email anyone.")).toBeTruthy();
  await user.click(screen.getByRole('checkbox', { name: /Notify people/ }));
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  expect(onPublish).toHaveBeenCalledExactlyOnceWith(false);
});

it('says nobody will be emailed once "Notify people" is unticked', async () => {
  const user = userEvent.setup();
  renderModal({ will_notify: 2, no_email: ['Alex Kim'] });

  expect(await screen.findByText('Publishing will email 2 people.')).toBeTruthy();
  await user.click(screen.getByRole('checkbox', { name: /Notify people/ }));
  expect(screen.getByText('Publishing quietly: nobody will be emailed or asked in the app.')).toBeTruthy();
  expect(screen.queryByText('Publishing will email 2 people.')).toBeNull();
  expect(screen.queryByText(/No email address on file/)).toBeNull();
});

it('ticks "Notify people" again when the dialog reopens after a Cancel (W10-WEB-D3)', async () => {
  const user = userEvent.setup();
  vi.mocked(api.planPublishPreview).mockResolvedValue({ will_notify: 2, no_email: [] });
  const onPublish = vi.fn();
  const client = new QueryClient();
  const modal = (open: boolean) => (
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <PublishPlanModal open={open} planId="plan-1" publishing={false} error={null} onClose={vi.fn()} onPublish={onPublish} />
      </LanguageProvider>
    </QueryClientProvider>
  );
  const { rerender } = render(modal(true));

  await screen.findByText('Publishing will email 2 people.');
  await user.click(screen.getByRole('checkbox', { name: /Notify people/ }));
  expect((screen.getByRole('checkbox', { name: /Notify people/ }) as HTMLInputElement).checked).toBe(false);

  rerender(modal(false));
  rerender(modal(true));

  const notify = (await screen.findByRole('checkbox', { name: /Notify people/ })) as HTMLInputElement;
  expect(notify.checked).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Publish' }));
  expect(onPublish).toHaveBeenCalledExactlyOnceWith(true);
});
