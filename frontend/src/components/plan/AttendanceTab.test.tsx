import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceSheet, AttendanceSheetRow, AttendanceStatus, PlanDetail } from '@service-center/shared';
import { api } from '../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { AttendanceTab } from './AttendanceTab';

vi.mock('../../lib/api', () => ({ api: { attendanceSheet: vi.fn() } }));
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => ({ organizationId: 'org-1' }) }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

interface RowTeam {
  id: string;
  name: string;
  position?: string;
}

const row = (personId: string, name: string, teams: readonly RowTeam[], status: AttendanceStatus | null = null): AttendanceSheetRow => ({
  person_id: personId,
  person_name: name,
  archived: false,
  roles: teams.map((team, index) => ({
    assignment_id: `${personId}-a${index}`,
    team_id: team.id,
    team_name: team.name,
    position_name: team.position ?? null,
    response: 'confirmed',
    can_mark: true,
  })),
  record: status
    ? { id: `${personId}-r`, status, revision: 1, marked_by_name: 'Leader', marked_at: '2026-11-22T15:00:00Z', marked_team_id: teams[0]!.id }
    : null,
  mark_team_id: teams[0]!.id,
});

const BAND = { id: 'team-band', name: 'Worship Band' };
const PRODUCTION = { id: 'team-prod', name: 'Production' };

const sheet: AttendanceSheet = {
  plan_id: 'plan-1',
  time: { id: 'time-1', kind: 'service', name: null, starts_at: '2026-11-22T15:00:00Z', ends_at: '2026-11-22T16:30:00Z' },
  times: [{ id: 'time-1', kind: 'service', name: null, starts_at: '2026-11-22T15:00:00Z', ends_at: '2026-11-22T16:30:00Z' }],
  rows: [
    row('p-an', 'An Nguyen', [{ ...BAND, position: 'Bass' }], 'present'),
    row('p-binh', 'Bình Trần', [{ ...PRODUCTION, position: 'Sound' }]),
    row('p-chi', 'Chi Lê', [{ ...BAND, position: 'Keys' }, PRODUCTION], 'absent'),
  ],
  counts: { scheduled_people: 3, present: 1, absent: 1, unknown: 0, unmarked: 1 },
  orphaned_records: [],
  hidden_people: 0,
  can_mark_any: true,
};

const renderTab = () => {
  vi.mocked(api.attendanceSheet).mockResolvedValue(sheet);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageProvider>
        <AttendanceTab plan={{ id: 'plan-1' } as PlanDetail} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
};

/** The team sections' names, in order (the tab's own labelled-by section is not one). */
const teamSections = (): (string | null)[] =>
  screen
    .getAllByRole('region')
    .filter((section) => section.hasAttribute('aria-label'))
    .map((section) => section.getAttribute('aria-label'));

/** The rows' radiogroup labels under one team's section, in order. */
const namesIn = (teamName: string): string[] =>
  within(screen.getByRole('region', { name: teamName }))
    .getAllByRole('radiogroup')
    .map((group) => group.getAttribute('aria-label') ?? '');

describe('plan attendance', () => {
  it('groups people by team (A–Z), listing someone on two teams once, under the team they are marked through', async () => {
    renderTab();
    await screen.findByText('An Nguyen');
    const sections = teamSections();
    expect(sections).toEqual(['Production', 'Worship Band']);
    expect(namesIn('Worship Band')).toEqual(['Attendance for An Nguyen', 'Attendance for Chi Lê']);
    expect(namesIn('Production')).toEqual(['Attendance for Bình Trần']);
  });

  it('filters by name or position, ignoring accents, and by status', async () => {
    const user = renderTab();
    await screen.findByText('An Nguyen');

    await user.type(screen.getByRole('searchbox', { name: 'Search people at this time' }), 'binh');
    await waitFor(() => expect(screen.queryByText('An Nguyen')).toBeNull());
    expect(teamSections()).toEqual(['Production']);

    await user.clear(screen.getByRole('searchbox', { name: 'Search people at this time' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search people at this time' }), 'keys');
    expect(await screen.findByText('Chi Lê')).toBeTruthy();
    expect(screen.queryByText('Bình Trần')).toBeNull();

    await user.clear(screen.getByRole('searchbox', { name: 'Search people at this time' }));
    const filter = screen.getByRole('radiogroup', { name: 'Show' });
    await user.click(within(filter).getByRole('radio', { name: /Not marked/ }));
    expect(screen.getByText('Bình Trần')).toBeTruthy();
    expect(screen.queryByText('An Nguyen')).toBeNull();
    expect(screen.queryByText('Chi Lê')).toBeNull();
  });
});
