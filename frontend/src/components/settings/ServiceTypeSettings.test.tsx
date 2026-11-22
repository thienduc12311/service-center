import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type AccessCapability, type AccessTarget, type FolderTree, type ServiceTypeRow, type TeamWithPositions } from '@service-center/shared';
import { api } from '../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { ServiceTypeSettings } from './ServiceTypeSettings';
import { CopyServiceTypeModal } from './CopyServiceTypeModal';

/** What the mocked session may do: organization-wide capabilities, plus per-service-type ones. */
interface FakeSession {
  isAdmin: boolean;
  orgWide: AccessCapability[];
  byServiceType: Record<string, AccessCapability[]>;
}

const session = vi.hoisted<{ current: FakeSession }>(() => ({
  current: { isAdmin: true, orgWide: ['plans.edit'], byServiceType: {} },
}));

vi.mock('../../lib/api', () => ({
  api: {
    listServiceTypes: vi.fn(),
    archiveServiceType: vi.fn(),
    copyServiceType: vi.fn(),
    serviceTypeTeams: vi.fn(),
    listTeams: vi.fn(),
    folderTree: vi.fn(),
  },
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({
    organizationId: 'org-1',
    isAdmin: session.current.isAdmin,
    can: (capability: AccessCapability, target: AccessTarget = {}) =>
      session.current.orgWide.includes(capability) ||
      Boolean(target.serviceTypeId && session.current.byServiceType[target.serviceTypeId]?.includes(capability)),
  }),
}));

const NOW = '2026-11-21T00:00:00Z';
const serviceType = (id: string, name: string, extra: Partial<ServiceTypeRow> = {}): ServiceTypeRow => ({
  id,
  organization_id: 'org-1',
  name,
  description: null,
  recurrence: 'weekly',
  sort_order: 0,
  folder_id: null,
  archived_at: null,
  created_at: NOW,
  updated_at: NOW,
  ...extra,
});

const sunday = serviceType('sunday', 'Sunday Service', { description: 'Main gathering', recurrence: 'weekly', folder_id: 'north' });
const youth = serviceType('youth', 'Youth Night');
const prayer = serviceType('prayer', 'Midweek Prayer', { archived_at: '2026-10-01T00:00:00Z' });

const team = (id: string, name: string): TeamWithPositions => ({ id, name } as TeamWithPositions);
const tree: FolderTree = {
  folders: [
    { id: 'north', name: 'North Campus', children: [], service_type_ids: ['sunday'] } as unknown as FolderTree['folders'][number],
    { id: 'south', name: 'South Campus', children: [], service_type_ids: [] } as unknown as FolderTree['folders'][number],
  ],
  unfiled_service_type_ids: ['youth'],
  landing_folder_id: null,
};

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <LanguageProvider>{ui}</LanguageProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  session.current = { isAdmin: true, orgWide: ['plans.edit'], byServiceType: {} };
  vi.mocked(api.listServiceTypes).mockImplementation(async (query) =>
    query?.include_archived ? [sunday, youth, prayer] : [sunday, youth],
  );
  vi.mocked(api.listTeams).mockResolvedValue([team('band', 'Band'), team('hosts', 'Hosts'), team('kids', 'Kids')]);
  vi.mocked(api.serviceTypeTeams).mockResolvedValue(['band', 'hosts']);
  vi.mocked(api.folderTree).mockResolvedValue(tree);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('ServiceTypeSettings', () => {
  it('lists active service types and an Archived section with Restore', async () => {
    const user = userEvent.setup();
    vi.mocked(api.archiveServiceType).mockResolvedValue({ ...prayer, archived_at: null });
    wrap(<ServiceTypeSettings />);

    expect(await screen.findByText('Sunday Service')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy Sunday Service' })).toBeTruthy();
    expect(await screen.findByText('Midweek Prayer')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Restore Midweek Prayer' }));
    expect(api.archiveServiceType).toHaveBeenCalledWith('prayer', { archived: false });
  });

  it('archives only after confirming, and says what archiving does', async () => {
    const user = userEvent.setup();
    vi.mocked(api.archiveServiceType).mockResolvedValue({ ...youth, archived_at: NOW });
    wrap(<ServiceTypeSettings />);

    await user.click(await screen.findByRole('button', { name: 'Archive Youth Night' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Nothing is deleted/)).toBeTruthy();
    expect(within(dialog).getByText(/its plans can still be opened/)).toBeTruthy();
    expect(api.archiveServiceType).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(api.archiveServiceType).toHaveBeenCalledWith('youth', { archived: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows an archive failure in the dialog', async () => {
    const user = userEvent.setup();
    vi.mocked(api.archiveServiceType).mockRejectedValue(new ApiError(500, 'Boom'));
    wrap(<ServiceTypeSettings />);

    await user.click(await screen.findByRole('button', { name: 'Archive Youth Night' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
  });

  it('hides actions the server would refuse', async () => {
    // Plans editor for Youth Night only: may archive/restore it, may not copy (that creates a service type).
    session.current = { isAdmin: false, orgWide: [], byServiceType: { youth: ['plans.edit'] } };
    wrap(<ServiceTypeSettings />);

    expect(await screen.findByRole('button', { name: 'Archive Youth Night' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Archive Sunday Service' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Copy / })).toBeNull();
    expect(await screen.findByText('Midweek Prayer')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restore Midweek Prayer' })).toBeNull();
  });
});

describe('CopyServiceTypeModal', () => {
  it('pre-fills from the source, ticks its teams and sends the chosen settings', async () => {
    const user = userEvent.setup();
    vi.mocked(api.copyServiceType).mockResolvedValue(serviceType('copy', 'Sunday Evening'));
    const onClose = vi.fn();
    wrap(<CopyServiceTypeModal source={sunday} onClose={onClose} />);

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Sunday Service (copy)');
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Main gathering');
    expect((screen.getByLabelText('Plans recur') as HTMLSelectElement).value).toBe('weekly');
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Band' }) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByRole('checkbox', { name: 'Kids' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/People, permissions, plans, templates and default files are not copied/)).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('Folder') as HTMLSelectElement).value).toBe('north'));

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Sunday Evening');
    await user.selectOptions(screen.getByLabelText('Plans recur'), 'monthly');
    await user.selectOptions(screen.getByLabelText('Folder'), 'south');
    await user.click(screen.getByRole('checkbox', { name: 'Hosts' }));
    await user.click(screen.getByRole('checkbox', { name: 'Kids' }));
    await user.click(screen.getByRole('button', { name: 'Copy service type' }));

    expect(api.copyServiceType).toHaveBeenCalledWith('sunday', {
      name: 'Sunday Evening',
      description: 'Main gathering',
      recurrence: 'monthly',
      folder_id: 'south',
      team_ids: ['band', 'kids'],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('needs a name', async () => {
    const user = userEvent.setup();
    wrap(<CopyServiceTypeModal source={sunday} onClose={vi.fn()} />);
    await user.clear(screen.getByLabelText('Name'));
    expect(screen.getByText('Name the copy.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy service type' })).toHaveProperty('disabled', true);
    expect(api.copyServiceType).not.toHaveBeenCalled();
  });

  it('keeps the folder fixed for someone who is not an administrator', async () => {
    session.current = { isAdmin: false, orgWide: ['plans.edit'], byServiceType: {} };
    wrap(<CopyServiceTypeModal source={sunday} onClose={vi.fn()} />);
    const folder = screen.getByLabelText('Folder') as HTMLInputElement;
    expect(folder.readOnly).toBe(true);
    await waitFor(() => expect(folder.value).toBe('North Campus'));
    expect(screen.getByText(/Only administrators can choose another folder/)).toBeTruthy();
  });

  it('explains a refusal from the server', async () => {
    const user = userEvent.setup();
    vi.mocked(api.copyServiceType).mockRejectedValue(new ApiError(403, 'Forbidden'));
    wrap(<CopyServiceTypeModal source={sunday} onClose={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Band' }) as HTMLInputElement).checked).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Copy service type' }));
    expect(await screen.findByText(/You can’t copy this service type/)).toBeTruthy();
  });

  it('shows other failures as an error', async () => {
    const user = userEvent.setup();
    vi.mocked(api.copyServiceType).mockRejectedValue(new TypeError('Failed to fetch'));
    wrap(<CopyServiceTypeModal source={sunday} onClose={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Band' }) as HTMLInputElement).checked).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Copy service type' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
