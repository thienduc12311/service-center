import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  AssignmentDetail,
  PlanDetail,
  RosterPerson,
  RosterPersonPage,
  TeamPositionRow,
  TeamWithPositions,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { SchedulePeopleModal } from './SchedulePeopleModal';

vi.mock('../../lib/api', () => ({
  api: {
    listTeams: vi.fn(),
    getPlan: vi.fn(),
    listPeoplePage: vi.fn(),
    checkAssignmentConflicts: vi.fn(),
    preferenceWarnings: vi.fn(),
    deliveryReadiness: vi.fn(),
    createAssignments: vi.fn(),
    createPlanPosition: vi.fn(),
  },
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => ({ organizationId: 'org-1', can: () => true }) }));

const NOW = '2026-11-01T00:00:00Z';

const person = (id: string, name: string, hasLogin = true): RosterPerson => ({
  id,
  person_id: id,
  profile_id: null,
  has_login: hasLogin,
  full_name: name,
  email: null,
  phone: null,
  avatar_url: null,
  role: null,
  status: hasLogin ? 'active' : 'no_account',
  campus: null,
  invite_pending: false,
  archived: false,
});

const position = (id: string, name: string, planId: string | null = null): TeamPositionRow => ({
  id,
  team_id: 'band',
  name,
  sort_order: 0,
  plan_id: planId,
  created_by: null,
  created_at: NOW,
  updated_at: NOW,
});

const band: TeamWithPositions = {
  id: 'band',
  organization_id: 'org-1',
  service_type_id: null,
  name: 'Band',
  description: null,
  color: '#6366f1',
  sort_order: 0,
  default_visibility: 'released',
  default_response_owner_id: null,
  requires_eligibility: false,
  eligibility_kind: null,
  created_at: NOW,
  updated_at: NOW,
  positions: [position('keys', 'Keys'), position('drums', 'Drums')],
  members: ['p-1', 'p-2'].map((personId) => ({ person_id: personId, user_id: null, position_id: null, membership_id: `m-${personId}`, profile: null })),
};

const assignment = (personId: string): AssignmentDetail => ({
  id: `a-${personId}`,
  plan_id: 'plan-1',
  person_id: personId,
  user_id: null,
  team_id: 'band',
  position_id: 'drums',
  status: 'confirmed',
  notes: null,
  notified_at: null,
  responded_at: null,
  created_by: null,
  visibility: 'released',
  released_at: null,
  released_by: null,
  response_owner_id: null,
  attendance_mode: 'all',
  request_revision: 1,
  created_at: NOW,
  updated_at: NOW,
  person: null,
  response_owner: null,
  team: { id: 'band', name: 'Band', color: '#6366f1' },
  position: { id: 'drums', name: 'Drums' },
  attendance_times: [],
  time_responses: [],
  attendance: [],
});

const plan: PlanDetail = {
  id: 'plan-1',
  organization_id: 'org-1',
  service_type_id: null,
  title: 'Sunday',
  service_date: '2026-11-22T10:00:00Z',
  location: null,
  status: 'draft',
  notes: null,
  content_revision: 1,
  staffing_revision: 1,
  created_by: null,
  created_at: NOW,
  updated_at: NOW,
  service_type: null,
  times: [],
  counts: { items: 0, songs: 0, confirmed: 1, unconfirmed: 0, declined: 0, prepared: 0 },
  items: [],
  assignments: [assignment('p-2')],
  plan_positions: [position('extra', 'Extra vocals', 'plan-1')],
  position_needs: [],
  total_length_seconds: 0,
};

const members = [person('p-1', 'An Nguyen'), person('p-2', 'Mai Tran', false)];
const everyone = [...members, person('p-3', 'Vy Đặng')];

beforeEach(() => {
  vi.mocked(api.listTeams).mockResolvedValue([band]);
  vi.mocked(api.getPlan).mockResolvedValue(plan);
  vi.mocked(api.listPeoplePage).mockImplementation(async (query): Promise<RosterPersonPage> => {
    const pool = query?.team_id === 'band' ? members : everyone;
    const words = (query?.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const items = pool.filter((row) => words.every((word) => (row.full_name ?? '').toLowerCase().includes(word)));
    return { items, next_cursor: null, total: query?.team_id === 'band' ? items.length : words.length ? items.length : 340 };
  });
  vi.mocked(api.checkAssignmentConflicts).mockResolvedValue({ conflicts: [], blocked_candidates: [], override_permitted: true });
  vi.mocked(api.preferenceWarnings).mockResolvedValue([]);
  vi.mocked(api.deliveryReadiness).mockResolvedValue([]);
  vi.mocked(api.createAssignments).mockResolvedValue({ created: [], conflicts: [] });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('lists team members by default, searches everyone on the server and keeps picked people as chips', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageProvider>
        <SchedulePeopleModal open planId="plan-1" serviceTypeId={null} initialTeamId="band" onClose={onClose} />
      </LanguageProvider>
    </QueryClientProvider>,
  );

  // Few positions: chips, including the plan-only one and "new for this plan".
  const positions = await screen.findByRole('radiogroup', { name: 'Position' });
  expect(within(positions).getByRole('radio', { name: /Extra vocals/ })).toBeTruthy();
  await user.click(within(positions).getByRole('radio', { name: 'Keys' }));

  // Team members first, from the server's team filter; row status before ticking.
  expect(await screen.findByText('An Nguyen')).toBeTruthy();
  expect(vi.mocked(api.listPeoplePage).mock.calls.some(([query]) => query?.team_id === 'band')).toBe(true);
  expect(screen.queryByText('Vy Đặng')).toBeNull();
  const mai = screen.getByText('Mai Tran').closest('label')!;
  expect(mai.textContent).toContain('already on this plan');
  expect(mai.textContent).toContain('no login');
  expect(screen.getByRole('radio', { name: /Everyone\s*340/ })).toBeTruthy();

  await user.click(screen.getByRole('checkbox', { name: /An Nguyen/ }));
  expect(screen.getByRole('button', { name: 'Remove An Nguyen' })).toBeTruthy();

  // Everyone, searched on the server; the chip stays while An's row is gone.
  await user.click(screen.getByRole('radio', { name: /Everyone/ }));
  await user.type(screen.getByRole('searchbox', { name: 'Find a person' }), 'vy');
  expect(await screen.findByText('Vy Đặng')).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: /An Nguyen/ })).toBeNull());
  expect(vi.mocked(api.listPeoplePage).mock.calls.at(-1)?.[0]).toMatchObject({ q: 'vy' });
  expect(vi.mocked(api.listPeoplePage).mock.calls.at(-1)?.[0]).not.toHaveProperty('team_id');
  expect(screen.getByRole('button', { name: 'Remove An Nguyen' })).toBeTruthy();

  await user.click(screen.getByRole('checkbox', { name: /Vy Đặng/ }));
  await user.click(await screen.findByRole('button', { name: 'Schedule 2' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(api.createAssignments).toHaveBeenCalledWith('plan-1', expect.objectContaining({
    assignments: [
      expect.objectContaining({ person_id: 'p-1', team_id: 'band', position_id: 'keys' }),
      expect.objectContaining({ person_id: 'p-3', team_id: 'band', position_id: 'keys' }),
    ],
  }));
});
