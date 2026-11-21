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
