import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccessCapability, AccessTarget } from '@service-center/shared';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { TeamsPage } from './TeamsPage';

vi.mock('../lib/api', () => ({
  api: { listTeams: vi.fn(), listPeople: vi.fn(), deleteTeam: vi.fn() },
}));
vi.mock('../providers/AuthProvider', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

type TestRole = 'owner' | 'admin' | 'scheduler' | 'member';
type CanFn = (capability: AccessCapability, target?: AccessTarget) => boolean;

const renderTeams = (role: TestRole, can: CanFn = () => true, serviceTypeId: string | null = null) => {
  vi.mocked(useAuth).mockReturnValue({
    role,
    organizationId: 'org-1',
    session: null,
    user: null,
    access: null,
    can,
    canAnywhere: () => true,
    canManage: true,
    isAdmin: true,
    loading: false,
    switchOrganization: vi.fn(),
    refreshUser: vi.fn(),
    signOut: vi.fn(),
  });
  vi.mocked(api.listTeams).mockResolvedValue([{
    id: 'team-1',
    organization_id: 'org-1',
    service_type_id: serviceTypeId,
    name: 'Production',
    description: null,
    color: '#6366f1',
    sort_order: 0,
    default_visibility: 'released',
    default_response_owner_id: null,
    requires_eligibility: false,
    eligibility_kind: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    positions: [],
    members: [],
  }]);
  vi.mocked(api.listPeople).mockResolvedValue([]);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LanguageProvider>
          <TeamsPage />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
};

describe('team deletion', () => {
  it('lets an owner cancel, then confirm deletion and refresh the teams list', async () => {
    const user = renderTeams('owner');
    vi.mocked(api.deleteTeam).mockImplementation(async () => {
      vi.mocked(api.listTeams).mockResolvedValue([]);
    });

    const more = await screen.findByRole('button', { name: 'More' });
    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: 'Delete team' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Production?' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    await user.click(cancel);
    expect(api.deleteTeam).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(more);

    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: 'Delete team' }));
    await user.click(screen.getByRole('button', { name: 'Delete team' }));
    await screen.findByText('No teams yet');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.deleteTeam).toHaveBeenCalledExactlyOnceWith('team-1');
  });

  it.each<[string, TestRole]>([['admin', 'admin'], ['legacy scheduler', 'scheduler']])(
    'shows deletion to an org-wide %s',
    async (_label, role) => {
      const user = renderTeams(role);
      await user.click(await screen.findByRole('button', { name: 'More' }));
      expect(screen.getByRole('menuitem', { name: 'Delete team' })).toBeTruthy();
    },
  );

  it('shows deletion to a teams.manage grantee scoped to the team service type', async () => {
    const user = renderTeams('member', (cap, target) => cap === 'teams.manage' && target?.serviceTypeId === 'st-1', 'st-1');
    await user.click(await screen.findByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Delete team' })).toBeTruthy();
  });

  it('hides deletion for a grantee scoped to a different service type', async () => {
    renderTeams('member', (cap, target) => cap === 'teams.manage' && target?.serviceTypeId === 'st-other', 'st-1');
    await screen.findByText('Production');
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('hides deletion from a team leader whose grant is only team-scoped', async () => {
    const user = renderTeams('member', (cap, target) => cap === 'teams.manage' && target?.teamId === 'team-1' && target.serviceTypeId == null);
    await user.click(await screen.findByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Delete team' })).toBeNull();
  });

  it('shows no actions to a plain member', async () => {
    renderTeams('member', () => false);
    await screen.findByText('Production');
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });
});
