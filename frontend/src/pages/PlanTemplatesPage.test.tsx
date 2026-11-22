import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type CreatePlanTemplateRequest,
  type PlanTemplateContent,
  type PlanTemplateDetail,
  type RosterPerson,
  type ServiceTypeRow,
  type SongListItem,
  type TeamWithPositions,
  type UpdatePlanTemplateRequest,
} from '@service-center/shared';
import { api } from '../lib/api';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { PlanTemplatesPage } from './PlanTemplatesPage';

vi.mock('../lib/api', () => ({
  api: {
    planTemplates: vi.fn(),
    planTemplate: vi.fn(),
    createPlanTemplate: vi.fn(),
    updatePlanTemplate: vi.fn(),
    archivePlanTemplate: vi.fn(),
    duplicatePlanTemplate: vi.fn(),
    listServiceTypes: vi.fn(),
    listTeams: vi.fn(),
    listPeople: vi.fn(),
    listSongs: vi.fn(),
    getSong: vi.fn(),
  },
}));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../providers/AuthProvider', () => ({
  useAuth: () => ({ organizationId: 'org-1', session: null, role: 'admin', access: null, can: () => true, canAnywhere: () => true }),
}));

const STAMP = '2026-11-01T00:00:00Z';
const EMPTY: PlanTemplateContent = { version: 1, notes: null, times: [], items: [], needs: [], roster: [] };

const serviceType = (id: string, name: string): ServiceTypeRow => ({
  id,
  organization_id: 'org-1',
  name,
  recurrence: 'weekly',
  created_at: STAMP,
  updated_at: STAMP,
} as ServiceTypeRow);

const SUNDAY = serviceType('st-sunday', 'Sunday Morning');
const MIDWEEK = serviceType('st-midweek', 'Midweek Prayer');

const band: TeamWithPositions = {
  id: 'team-band',
  organization_id: 'org-1',
  service_type_id: SUNDAY.id,
  name: 'Worship Band',
  description: null,
  color: '#6366f1',
  sort_order: 0,
  default_visibility: 'released',
  default_response_owner_id: null,
  requires_eligibility: false,
  eligibility_kind: null,
  created_at: STAMP,
  updated_at: STAMP,
  positions: [
    { id: 'pos-keys', team_id: 'team-band', name: 'Keys', sort_order: 0, plan_id: null, created_by: null, created_at: STAMP, updated_at: STAMP },
    { id: 'pos-drums', team_id: 'team-band', name: 'Drums', sort_order: 1, plan_id: null, created_by: null, created_at: STAMP, updated_at: STAMP },
  ],
  members: [],
};

const sam: RosterPerson = {
  id: 'person-sam',
  person_id: 'person-sam',
  profile_id: null,
  has_login: false,
  full_name: 'Sam Lee',
  email: 'sam@example.org',
  phone: null,
  avatar_url: null,
  role: null,
  status: 'no_account',
  campus: null,
  invite_pending: false,
  archived: false,
};

const amazingGrace: SongListItem = {
  archived_at: null,
  revision: 1,
  id: 'song-grace',
  organization_id: 'org-1',
  title: 'Amazing Grace',
  author: 'Newton',
  ccli_number: null,
  copyright: null,
  administration: null,
  default_key: 'G',
  default_bpm: 72,
  meter: null,
  themes: [],
  song_types: [],
  style: null,
  speed: null,
  notes: null,
  created_by: null,
  created_at: STAMP,
  updated_at: STAMP,
  arrangements: [{
    archived_at: null, revision: 1, id: 'arr-acoustic', song_id: 'song-grace', name: 'Acoustic', song_key: 'G', capo: null, bpm: 72,
    meter: null, length_seconds: 240, sequence: [], chord_chart: null, chord_chart_format: 'chordpro', chart_columns: 1,
    chart_font: null, chart_font_size: null, chart_chord_color: null, is_default: true, created_at: STAMP, updated_at: STAMP,
  }],
  last_scheduled_at: null,
  usage_count: 0,
  in_plan: false,
};

const detail = (id: string, name: string, content: PlanTemplateContent, revision = 1, type: ServiceTypeRow = SUNDAY): PlanTemplateDetail => ({
  id,
  organization_id: 'org-1',
  service_type_id: type.id,
  kind: 'plan',
  name,
  description: null,
  current_revision: revision,
  archived_at: null,
  created_by: null,
  updated_by: null,
  created_at: STAMP,
  updated_at: STAMP,
  service_type: { id: type.id, name: type.name },
  current_revision_id: `${id}-r${revision}`,
  counts: { times: content.times.length, items: content.items.length, needs: content.needs.length, roster: content.roster.length, has_notes: false },
  content,
  revisions: [{ id: `${id}-r${revision}`, revision, source_plan_id: null, created_by: null, created_at: STAMP }],
});

/** The server as the page sees it: templates by id. */
let templates: Map<string, PlanTemplateDetail>;

beforeEach(() => {
  templates = new Map();
  vi.mocked(api.planTemplates).mockImplementation(async () => [...templates.values()]);
  vi.mocked(api.planTemplate).mockImplementation(async (id) => {
    const found = templates.get(id);
    if (!found) throw new ApiError(404, 'Template not found', 'not_found');
    return found;
  });
  vi.mocked(api.listServiceTypes).mockResolvedValue([SUNDAY, MIDWEEK]);
  vi.mocked(api.listTeams).mockResolvedValue([band]);
  vi.mocked(api.listPeople).mockResolvedValue([sam]);
  vi.mocked(api.listSongs).mockResolvedValue({ data: [amazingGrace], page: 1, per_page: 10, total: 1 });
  vi.mocked(api.getSong).mockResolvedValue(amazingGrace);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const renderPage = (path = '/plans/templates') => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <LanguageProvider>
          <PlanTemplatesPage />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
};

describe('create from scratch', () => {
  it('creates an empty template for the chosen service type and opens it in the editor', async () => {
    vi.mocked(api.createPlanTemplate).mockImplementation(async (body: CreatePlanTemplateRequest) => {
      const created = { ...detail('tpl-new', body.name, EMPTY, 1, MIDWEEK), description: body.description ?? null };
      templates.set(created.id, created);
      return created;
    });
    const user = renderPage();

    expect(await screen.findByText('No templates yet')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'New template' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'New plan template' });
    const create = within(dialog).getByRole('button', { name: 'Create and edit' });
    expect((create as HTMLButtonElement).disabled).toBe(true);

    await user.type(within(dialog).getByLabelText('Name'), 'Midweek basics');
    await waitFor(() => expect(within(dialog).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Midweek Prayer', 'Sunday Morning', 'All service types']));
    await user.selectOptions(within(dialog).getByLabelText('Service type'), 'Midweek Prayer');
    await user.type(within(dialog).getByLabelText('Description (optional)'), 'Short and simple');
    await user.click(create);

    await waitFor(() => expect(api.createPlanTemplate).toHaveBeenCalledWith({
      kind: 'plan', name: 'Midweek basics', description: 'Short and simple', service_type_id: MIDWEEK.id, content: {},
    }));
    // The editor opens on the new, empty template.
    expect(await screen.findByRole('heading', { name: 'Midweek basics' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'New plan template' })).toBeNull();
    expect(screen.getByText('No items.')).toBeTruthy();
  });
});

describe('authoring content', () => {
  it('adds a header, an item, a song, a need and a person, and saves them as the next revision', async () => {
    templates.set('tpl-1', detail('tpl-1', 'Sunday standard', EMPTY));
    vi.mocked(api.updatePlanTemplate).mockImplementation(async (id: string, body: UpdatePlanTemplateRequest) => {
      const saved = detail(id, 'Sunday standard', { ...EMPTY, ...(body.content as PlanTemplateContent) }, 2);
      templates.set(id, saved);
      return saved;
    });
    const user = renderPage('/plans/templates?template=tpl-1');
    await screen.findByRole('heading', { name: 'Sunday standard' });

    // Header.
    await user.click(screen.getByRole('button', { name: 'Header' }));
    let dialog = await screen.findByRole('dialog', { name: 'Add to the order' });
    await user.type(within(dialog).getByLabelText('Title'), 'Worship');
    await user.click(within(dialog).getByRole('button', { name: 'Add to template' }));

    // Free-form item; a bad length is refused until fixed.
    await user.click(screen.getByRole('button', { name: 'Item' }));
    dialog = await screen.findByRole('dialog', { name: 'Add to the order' });
    await user.click(within(dialog).getByRole('button', { name: 'Add to template' }));
    expect(within(dialog).getByText('Give the item a title.')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Title'), 'Welcome');
    await user.type(within(dialog).getByLabelText('Length (m:ss)'), '2:75');
    await user.click(within(dialog).getByRole('button', { name: 'Add to template' }));
    expect(within(dialog).getByText('Enter a length like 4:30 (at most 10 hours).')).toBeTruthy();
    await user.clear(within(dialog).getByLabelText('Length (m:ss)'));
    await user.type(within(dialog).getByLabelText('Length (m:ss)'), '2:00');
    await user.type(within(dialog).getByLabelText('Description'), 'Host reads notices');
    await user.click(within(dialog).getByRole('button', { name: 'Add to template' }));

    // Song, from the song search, with an arrangement.
    await user.click(screen.getByRole('button', { name: 'Song' }));
    dialog = await screen.findByRole('dialog', { name: 'Add to the order' });
    await user.click(await within(dialog).findByRole('button', { name: 'Use Amazing Grace' }));
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: /Acoustic/ })).toHaveLength(1));
    await user.selectOptions(within(dialog).getByLabelText('Arrangement'), 'arr-acoustic');
    await user.type(within(dialog).getByLabelText('Length (m:ss)'), '4:00');
    await user.click(within(dialog).getByRole('button', { name: 'Add to template' }));

    // A needed position.
    await user.selectOptions(screen.getByLabelText('Team', { selector: '#template-need-team' }), 'team-band');
    await user.selectOptions(screen.getByLabelText('Position', { selector: '#template-need-position' }), 'pos-keys');
    await user.clear(screen.getByLabelText('How many'));
    await user.type(screen.getByLabelText('How many'), '2');
    await user.click(screen.getByRole('button', { name: 'Add need' }));
    // Keys is now listed and cannot be added again.
    expect(screen.getByRole('option', { name: 'Keys (already listed)' })).toBeTruthy();

    // A roster entry, with the plan's person picker.
    await user.selectOptions(screen.getByLabelText('Team', { selector: '#template-roster-team' }), 'team-band');
    await user.type(screen.getByRole('combobox', { name: 'Person' }), 'sam');
    await user.click(await screen.findByRole('option', { name: /Sam Lee/ }));
    await user.click(screen.getByRole('button', { name: 'Add person' }));

    await user.click(screen.getByRole('button', { name: 'Save as revision 2' }));
    await waitFor(() => expect(api.updatePlanTemplate).toHaveBeenCalledTimes(1));
    const [id, body] = vi.mocked(api.updatePlanTemplate).mock.calls[0]!;
    expect(id).toBe('tpl-1');
    expect(body.expected_revision).toBe(1);
    expect(body.content).toEqual({
      ...EMPTY,
      items: [
        { item_type: 'header', title: 'Worship', song_id: null, arrangement_id: null, key_override: null, length_seconds: 0, description: null },
        { item_type: 'item', title: 'Welcome', song_id: null, arrangement_id: null, key_override: null, length_seconds: 120, description: 'Host reads notices' },
        { item_type: 'song', title: 'Amazing Grace', song_id: 'song-grace', arrangement_id: 'arr-acoustic', key_override: null, length_seconds: 240, description: null },
      ],
      needs: [{ position_id: 'pos-keys', needed: 2 }],
      roster: [{ person_id: 'person-sam', team_id: 'team-band', position_id: null }],
    });
  });

  it('edits an existing item in place', async () => {
    templates.set('tpl-1', detail('tpl-1', 'Sunday standard', {
      ...EMPTY,
      items: [{ item_type: 'item', title: 'Announcements', song_id: null, arrangement_id: null, key_override: null, length_seconds: 60, description: null }],
    }));
    vi.mocked(api.updatePlanTemplate).mockImplementation(async (id) => templates.get(id)!);
    const user = renderPage('/plans/templates?template=tpl-1');

    await user.click(await screen.findByRole('button', { name: 'Edit Announcements' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Announcements' });
    expect((within(dialog).getByLabelText('Length (m:ss)') as HTMLInputElement).value).toBe('1:00');
    await user.clear(within(dialog).getByLabelText('Title'));
    await user.type(within(dialog).getByLabelText('Title'), 'Notices');
    await user.click(within(dialog).getByRole('button', { name: 'Update item' }));

    expect(screen.getByText('Notices')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save as revision 2' }));
    await waitFor(() => expect(vi.mocked(api.updatePlanTemplate).mock.calls[0]?.[1].content?.items).toEqual([
      { item_type: 'item', title: 'Notices', song_id: null, arrangement_id: null, key_override: null, length_seconds: 60, description: null },
    ]));
  });

  it('shows the save conflict when someone saved the template meanwhile', async () => {
    templates.set('tpl-1', detail('tpl-1', 'Sunday standard', EMPTY));
    vi.mocked(api.updatePlanTemplate).mockRejectedValue(new ApiError(409, 'This template changed since you opened it', 'template_changed'));
    const user = renderPage('/plans/templates?template=tpl-1');
    await screen.findByRole('heading', { name: 'Sunday standard' });

    await user.click(screen.getByRole('button', { name: 'Header' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add to the order' });
    await user.type(within(dialog).getByLabelText('Title'), 'Worship');
    await user.click(within(dialog).getByRole('button', { name: 'Add to template' }));
    await user.click(screen.getByRole('button', { name: 'Save as revision 2' }));

    expect(await screen.findByText('Someone saved this template meanwhile. It has been reloaded; make your change again.')).toBeTruthy();
    // The library is reloaded to pick up the other revision.
    await waitFor(() => expect(vi.mocked(api.planTemplate).mock.calls.length).toBeGreaterThan(1));
  });
});

describe('duplicate', () => {
  it('copies into another service type, asking before leaving staffing out, then opens the copy', async () => {
    templates.set('tpl-1', detail('tpl-1', 'Sunday standard', { ...EMPTY, needs: [{ position_id: 'pos-keys', needed: 1 }] }, 3));
    vi.mocked(api.duplicatePlanTemplate)
      .mockRejectedValueOnce(new ApiError(409, 'Some needed positions…', 'template_copy_unavailable', { needs: 1, roster: 0 }))
      .mockImplementationOnce(async (_id, body) => {
        const copy = detail('tpl-copy', body.name ?? 'copy', EMPTY, 1, MIDWEEK);
        templates.set(copy.id, copy);
        return copy;
      });
    const user = renderPage('/plans/templates?template=tpl-1');
    await screen.findByRole('heading', { name: 'Sunday standard' });

    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Duplicate Sunday standard' });
    expect(within(dialog).getByText('Copies revision 3 into a new template. The original does not change.')).toBeTruthy();
    expect((within(dialog).getByLabelText('Name of the copy') as HTMLInputElement).value).toBe('Sunday standard (copy)');
    await waitFor(() => expect((within(dialog).getByLabelText('Service type') as HTMLSelectElement).value).toBe(SUNDAY.id));

    await user.clear(within(dialog).getByLabelText('Name of the copy'));
    await user.type(within(dialog).getByLabelText('Name of the copy'), 'Midweek standard');
    await user.selectOptions(within(dialog).getByLabelText('Service type'), MIDWEEK.id);
    await user.click(within(dialog).getByRole('button', { name: 'Duplicate' }));

    expect(await within(dialog).findByText(
      'Not every team serves that service type: 1 needed position and 0 roster entries would be left out of the copy.',
    )).toBeTruthy();
    expect(vi.mocked(api.duplicatePlanTemplate).mock.calls[0]).toEqual(['tpl-1', { name: 'Midweek standard', service_type_id: MIDWEEK.id, drop_unavailable: false }]);

    await user.click(within(dialog).getByRole('button', { name: 'Copy without them' }));
    await waitFor(() => expect(vi.mocked(api.duplicatePlanTemplate).mock.calls[1]).toEqual([
      'tpl-1', { name: 'Midweek standard', service_type_id: MIDWEEK.id, drop_unavailable: true },
    ]));
    expect(await screen.findByRole('heading', { name: 'Midweek standard' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Duplicate Sunday standard' })).toBeNull();
  });

  it('keeps the service type when it is not changed', async () => {
    templates.set('tpl-1', detail('tpl-1', 'Sunday standard', EMPTY));
    vi.mocked(api.duplicatePlanTemplate).mockImplementation(async () => {
      const copy = detail('tpl-copy', 'Sunday standard (copy)', EMPTY);
      templates.set(copy.id, copy);
      return copy;
    });
    const user = renderPage('/plans/templates?template=tpl-1');
    await screen.findByRole('heading', { name: 'Sunday standard' });

    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Duplicate Sunday standard' });
    await user.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(api.duplicatePlanTemplate).toHaveBeenCalledWith('tpl-1', { name: 'Sunday standard (copy)', drop_unavailable: false }));
  });
});
