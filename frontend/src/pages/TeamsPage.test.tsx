import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccessCapability, AccessTarget, EffectiveAccess, RosterPerson, TeamPositionRow, TeamWithPositions } from '@service-center/shared';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { TeamsPage } from './TeamsPage';

vi.mock('../lib/api', () => ({
  api: { listTeams: vi.fn(), listPeople: vi.fn(), deleteTeam: vi.fn(), addTeamMember: vi.fn() },
}));
vi.mock('../providers/AuthProvider', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

type TestRole = 'owner' | 'admin' | 'scheduler' | 'member';

interface TeamOptions {
  serviceTypeId?: string | null;
  positions?: TeamPositionRow[];
  members?: TeamWithPositions['members'];
}

const team = (id: string, name: string, options: TeamOptions = {}): TeamWithPositions => ({
  id,
  organization_id: 'org-1',
  service_type_id: options.serviceTypeId ?? null,
  name,
  description: null,
  color: '#6366f1',
  sort_order: 0,
  default_visibility: 'released',
  default_response_owner_id: null,
  requires_eligibility: false,
  eligibility_kind: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  positions: options.positions ?? [],
  members: options.members ?? [],
});

const position = (id: string, teamId: string, name: string): TeamPositionRow => ({
  id,
  team_id: teamId,
  name,
  sort_order: 0,
  plan_id: null,
  created_by: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
});

const member = (personId: string, name: string, positionId: string | null = null): TeamWithPositions['members'][number] => ({
  person_id: personId,
  user_id: null,
  position_id: positionId,
  membership_id: `m-${personId}`,
  profile: { id: personId, full_name: name, email: null, avatar_url: null, phone: null, role: 'member', date_of_birth: null },
});

const rosterPerson = (personId: string, name: string, archived = false): RosterPerson => ({
  id: personId,
  person_id: personId,
  profile_id: null,
  has_login: false,
  full_name: name,
  email: `${name.split(' ')[0]!.toLowerCase()}@example.org`,
  phone: null,
  avatar_url: null,
  role: null,
  status: 'no_account',
  campus: null,
  invite_pending: false,
  archived,
});
type CanFn = (capability: AccessCapability, target?: AccessTarget) => boolean;

/** Roster and teams to load instead of the single empty "Production" team. */
interface TeamsFixture {
  teams?: TeamWithPositions[];
  people?: RosterPerson[];
  /** Effective access; roster editing (add/remove members) reads it. */
  access?: EffectiveAccess | null;
}

/** An owner's organization-wide access, enough to edit any team's roster. */
const OWNER_ACCESS: EffectiveAccess = {
  organization_id: 'org-1',
  user_id: 'user-1',
  role: 'owner',
  access_mode: 'scoped',
  can_administer_access: true,
  entries: [{ capability: 'teams.manage', scope_type: 'organization', scope_id: null, source: 'role:owner', grant_id: null }],
};

const renderTeams = (role: TestRole, can: CanFn = () => true, serviceTypeId: string | null = null, fixture: TeamsFixture = {}) => {
  vi.mocked(useAuth).mockReturnValue({
    role,
    organizationId: 'org-1',
    session: null,
    user: null,
    access: fixture.access ?? null,
    can,
    canAnywhere: () => true,
    canManage: true,
    isAdmin: true,
    loading: false,
    switchOrganization: vi.fn(),
    refreshUser: vi.fn(),
    signOut: vi.fn(),
  });
  vi.mocked(api.listTeams).mockResolvedValue(fixture.teams ?? [team('team-1', 'Production', { serviceTypeId })]);
  vi.mocked(api.listPeople).mockResolvedValue(fixture.people ?? []);
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

describe('team cards and search', () => {
  const band = team('team-band', 'Worship Band', {
    positions: [position('pos-bass', 'team-band', 'Bass')],
    members: [member('p-an', 'An Nguyen', 'pos-bass'), member('p-binh', 'Bình Trần')],
  });
  const production = team('team-prod', 'Production', { members: [member('p-chi', 'Chi Lê')] });

  it('starts with every card collapsed to its summary and opens one at a time', async () => {
    const user = renderTeams('owner', () => true, null, { teams: [band, production] });
    const bandToggle = await screen.findByRole('button', { name: /Worship Band/, expanded: false });
    expect(bandToggle.textContent).toContain('2 people · 1 position');
    expect(screen.queryByText('An Nguyen')).toBeNull();

    await user.click(bandToggle);
    expect(screen.getByText('An Nguyen')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Production/, expanded: false })).toBeTruthy();
    expect(screen.queryByText('Chi Lê')).toBeNull();
  });

  it('searches team and member names, ignoring accents, and highlights matching members', async () => {
    const user = renderTeams('owner', () => true, null, { teams: [band, production] });
    await screen.findByText('Worship Band');
    await user.type(screen.getByRole('searchbox', { name: 'Search teams and members' }), 'binh');

    await waitFor(() => expect(screen.queryByText('Production')).toBeNull());
    const match = screen.getByText('Bình Trần').closest('li');
    expect(match?.getAttribute('data-match')).toBe('true');
    expect(screen.getByText('An Nguyen').closest('li')?.getAttribute('data-match')).toBeNull();
    expect(screen.getByText(/1 matching member/)).toBeTruthy();
  });
});

describe('add team members', () => {
  const band = team('team-band', 'Worship Band', {
    positions: [position('pos-bass', 'team-band', 'Bass'), position('pos-keys', 'team-band', 'Keys')],
    members: [member('p-an', 'An Nguyen', 'pos-bass')],
  });
  const people = [
    rosterPerson('p-an', 'An Nguyen'),
    rosterPerson('p-mai', 'Mai Tran'),
    rosterPerson('p-minh', 'Minh Pham'),
    rosterPerson('p-old', 'Mai Archived', true),
  ];

  const openAddMember = async () => {
    const user = renderTeams('owner', () => true, null, { teams: [band], people, access: OWNER_ACCESS });
    await user.click(await screen.findByRole('button', { name: /Worship Band/, expanded: false }));
    await user.click(screen.getByRole('button', { name: '+ Add person' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add to Worship Band' });
    return { user, dialog };
  };

  it('queues searched people as chips and adds them only when Add is pressed, with the chosen position', async () => {
    vi.mocked(api.addTeamMember).mockResolvedValue(undefined);
    const { user, dialog } = await openAddMember();
    const add = within(dialog).getByRole('button', { name: 'Add 0 people' });
    expect(add.hasAttribute('disabled')).toBe(true);

    const picker = within(dialog).getByRole('combobox', { name: 'Find people' });
    await user.type(picker, 'mai');
    const options = await within(dialog).findAllByRole('option');
    // Archived people are not offered.
    expect(options.map((option) => option.textContent)).toEqual([expect.stringContaining('Mai Tran')]);
    await user.click(options[0]!);

    await user.type(picker, 'minh');
    await user.click(await within(dialog).findByRole('option', { name: /Minh Pham/ }));

    const queued = within(dialog).getByRole('list', { name: 'People to add' });
    expect(within(queued).getByText('Mai Tran')).toBeTruthy();
    expect(within(queued).getByText('Minh Pham')).toBeTruthy();

    await user.click(within(dialog).getByRole('radio', { name: 'Keys' }));
    expect(api.addTeamMember).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Add 2 as Keys' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(vi.mocked(api.addTeamMember).mock.calls).toEqual([
      ['team-band', { person_id: 'p-mai', position_id: 'pos-keys' }],
      ['team-band', { person_id: 'p-minh', position_id: 'pos-keys' }],
    ]);
  });

  it('never offers current members, and a queued person can be taken back out', async () => {
    const { user, dialog } = await openAddMember();
    const picker = within(dialog).getByRole('combobox', { name: 'Find people' });
    await user.type(picker, 'an nguyen');
    expect(await within(dialog).findByText('No members match.')).toBeTruthy();

    await user.clear(picker);
    await user.type(picker, 'mai tran');
    await user.click(await within(dialog).findByRole('option', { name: /Mai Tran/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Don’t add Mai Tran' }));
    expect(within(dialog).queryByRole('list', { name: 'People to add' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Add 0 people' }).hasAttribute('disabled')).toBe(true);
  });
});
