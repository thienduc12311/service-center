import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { RosterPerson } from '@service-center/shared';
import { api } from '../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { ScheduleHelp } from './ScheduleHelp';

const person = (overrides: Partial<RosterPerson> & Pick<RosterPerson, 'id' | 'full_name'>): RosterPerson => ({
  person_id: `person-${overrides.id}`,
  profile_id: `profile-${overrides.id}`,
  has_login: true,
  email: `${overrides.id}@example.org`,
  phone: null,
  avatar_url: null,
  role: 'member',
  status: 'active',
  campus: null,
  invite_pending: false,
  archived: false,
  ...overrides,
});

const roster: RosterPerson[] = [
  person({ id: 'me', full_name: 'Me Myself' }),
  person({ id: 'chau', full_name: 'Trần Châu' }),
  person({ id: 'binh', full_name: 'Đặng Bình' }),
  person({ id: 'nologin', full_name: 'Châu No Login', has_login: false, profile_id: null }),
  person({ id: 'archived', full_name: 'Châu Archived', archived: true }),
];

vi.mock('../../lib/api', () => ({ api: { grantDelegation: vi.fn(), revokeDelegation: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ organizationId: null, user: { profile: { id: 'profile-me' } } }),
}));
vi.mock('../../hooks/queries', () => ({
  useDelegations: () => ({ data: [], isLoading: false, error: null }),
  usePeople: () => ({ data: roster }),
  useInvalidateOrg: () => () => Promise.resolve(),
}));

afterEach(cleanup);

it('picks a helper by searching, offering only other active members with a login', async () => {
  const user = userEvent.setup();
  vi.mocked(api.grantDelegation).mockResolvedValue({
    id: 'delegation-1',
    direction: 'given',
    target_person_id: 'person-me',
    target_name: 'Me Myself',
    delegate_person_id: 'person-chau',
    delegate_name: 'Trần Châu',
    can_respond: true,
    can_view_schedule: true,
    can_manage_availability: true,
    can_signup: false,
    expires_at: null,
    revoked_at: null,
    created_at: '2026-11-21T00:00:00Z',
    active: true,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider>
        <ScheduleHelp />
      </LanguageProvider>
    </QueryClientProvider>,
  );

  const who = await screen.findByRole('combobox', { name: 'Who can help' });
  expect(screen.getByRole('button', { name: 'Allow' })).toHaveProperty('disabled', true);

  await user.click(who);
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    expect.stringContaining('Trần Châu'),
    expect.stringContaining('Đặng Bình'),
  ]);

  await user.type(who, 'chau');
  expect(screen.getAllByRole('option')).toHaveLength(1);
  await user.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'Change Who can help, currently Trần Châu' })).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Allow' }));
  await waitFor(() => expect(api.grantDelegation).toHaveBeenCalledOnce());
  expect(vi.mocked(api.grantDelegation).mock.calls[0]?.[0]).toMatchObject({ delegate_person_id: 'person-chau' });
});
