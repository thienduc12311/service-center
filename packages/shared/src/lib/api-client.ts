/**
 * Typed client for the Express API. Shared verbatim by the web app and the
 * React Native app — the only difference is how each supplies the access token.
 */

import type {
  ArrangementRow,
  AssignmentRow,
  BlockoutRow,
  ChordSheetImportRow,
  OrganizationMemberRow,
  OrganizationRow,
  PlanItemRow,
  PlanRow,
  ProfileRow,
  ServiceTypeRow,
  SongRow,
  SongbookRow,
  TeamPositionRow,
  TeamRow,
} from '../types/database.js';
import type {
  CalendarEvent,
  AssignmentNotificationSendResult,
  AssignmentRespondPreview,
  AssignmentRespondResult,
  CalendarFeedTokenResponse,
  CurrentUser,
  ImportQuota,
  ImportWithQuota,
  InvitationPreview,
  MyScheduleEntry,
  Paginated,
  PersonDetail,
  PlanDetail,
  PlanSummary,
  RosterPerson,
  SchedulingConflict,
  SongWithArrangements,
  SongbookDetail,
  TeamWithPositions,
} from '../types/domain.js';
import type { CreatePersonInput, UpdatePersonInput } from '../schemas/people.js';
import type {
  CreatePositionPayload,
  CreateTeamPayload,
  UpdatePositionPayload,
  UpdateTeamPayload,
} from '../schemas/team.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the caller should be bounced to the sign-in screen. */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Called before every request; return null when signed out. */
  getAccessToken: () => Promise<string | null> | string | null;
  /** Active organization, sent as X-Organization-Id. */
  getOrganizationId?: () => string | null;
  fetchImpl?: typeof fetch;
  onUnauthorized?: () => void;
}

type Query = Record<string, string | number | boolean | null | undefined>;

const buildQuery = (query?: Query): string => {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const str = params.toString();
  return str ? `?${str}` : '';
};

export class ServiceCenterApi {
  constructor(private readonly options: ApiClientOptions) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Query,
  ): Promise<T> {
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    const token = await this.options.getAccessToken();
    const orgId = this.options.getOrganizationId?.();

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (orgId) headers['X-Organization-Id'] = orgId;

    const response = await fetchImpl(
      `${this.options.baseUrl.replace(/\/$/, '')}${path}${buildQuery(query)}`,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
    );

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload = text ? safeJson(text) : null;

    if (!response.ok) {
      if (response.status === 401) this.options.onUnauthorized?.();
      const err = (payload ?? {}) as { error?: string; code?: string; details?: unknown };
      throw new ApiError(
        response.status,
        err.error ?? `Request failed with status ${response.status}`,
        err.code,
        err.details,
      );
    }
    return payload as T;
  }

  // ------------------------------------------------------------- account --
  me = () => this.request<CurrentUser>('GET', '/api/v1/me');
  updateMe = (body: Partial<Pick<ProfileRow, 'full_name' | 'phone' | 'avatar_url'>>) =>
    this.request<ProfileRow>('PATCH', '/api/v1/me', body);

  // ------------------------------------------------------ organizations --
  listOrganizations = () =>
    this.request<Array<{ organization: OrganizationRow; role: OrganizationMemberRow['role'] }>>(
      'GET',
      '/api/v1/organizations',
    );
  createOrganization = (body: { name: string; slug: string; timezone?: string; logo_url?: string | null }) =>
    this.request<OrganizationRow>('POST', '/api/v1/organizations', body);
  updateOrganization = (id: string, body: Partial<OrganizationRow>) =>
    this.request<OrganizationRow>('PATCH', `/api/v1/organizations/${id}`, body);

  listPeople = () => this.request<RosterPerson[]>('GET', '/api/v1/people');
  getPerson = (personId: string) => this.request<PersonDetail>('GET', `/api/v1/people/${personId}`);
  createPerson = (body: CreatePersonInput) => this.request<PersonDetail>('POST', '/api/v1/people', body);
  updatePerson = (personId: string, body: UpdatePersonInput) =>
    this.request<PersonDetail>('PATCH', `/api/v1/people/${personId}`, body);
  deletePerson = (personId: string) => this.request<void>('DELETE', `/api/v1/people/${personId}`);
  /** Gives an existing has-login member a full roster record. */
  convertMember = (userId: string) =>
    this.request<PersonDetail>('POST', `/api/v1/people/from-member/${userId}`);
  invitePerson = (personId: string, body: { email?: string; role?: string }) =>
    this.request<
      | { linked: true; invited: false }
      | { linked: false; invited: true; invite_url: string }
    >('POST', `/api/v1/people/${personId}/invitations`, body);

  updateMember = (userId: string, body: { role?: string; status?: string }) =>
    this.request<OrganizationMemberRow>('PATCH', `/api/v1/people/members/${userId}`, body);
  removeMember = (userId: string) => this.request<void>('DELETE', `/api/v1/people/members/${userId}`);

  // -------------------------------------------------- invitation acceptance
  previewInvitation = (token: string) =>
    this.request<InvitationPreview>('GET', `/api/v1/invitations/${token}`);
  acceptInvitation = (token: string, body: { password: string }) =>
    this.request<{ email: string; linked_existing_account: boolean }>(
      'POST',
      `/api/v1/invitations/${token}/accept`,
      body,
    );

  // ------------------------------------------------------ service types --
  listServiceTypes = () => this.request<ServiceTypeRow[]>('GET', '/api/v1/service-types');
  createServiceType = (body: { name: string; description?: string | null; sort_order?: number }) =>
    this.request<ServiceTypeRow>('POST', '/api/v1/service-types', body);

  // -------------------------------------------------------------- teams --
  listTeams = () => this.request<TeamWithPositions[]>('GET', '/api/v1/teams');
  getTeam = (id: string) => this.request<TeamWithPositions>('GET', `/api/v1/teams/${id}`);
  createTeam = (body: CreateTeamPayload) =>
    this.request<TeamWithPositions>('POST', '/api/v1/teams', body);
  updateTeam = (id: string, body: UpdateTeamPayload) =>
    this.request<TeamRow>('PATCH', `/api/v1/teams/${id}`, body);
  deleteTeam = (id: string) => this.request<void>('DELETE', `/api/v1/teams/${id}`);
  addPosition = (teamId: string, body: CreatePositionPayload) =>
    this.request<TeamPositionRow>('POST', `/api/v1/teams/${teamId}/positions`, body);
  updatePosition = (teamId: string, positionId: string, body: UpdatePositionPayload) =>
    this.request<TeamPositionRow>('PATCH', `/api/v1/teams/${teamId}/positions/${positionId}`, body);
  deletePosition = (teamId: string, positionId: string) =>
    this.request<void>('DELETE', `/api/v1/teams/${teamId}/positions/${positionId}`);
  addTeamMember = (teamId: string, body: { user_id: string; position_id?: string | null }) =>
    this.request<void>('POST', `/api/v1/teams/${teamId}/members`, body);
  removeTeamMember = (teamId: string, membershipId: string) =>
    this.request<void>('DELETE', `/api/v1/teams/${teamId}/members/${membershipId}`);

  // -------------------------------------------------------------- songs --
  listSongs = (query?: Query) =>
    this.request<Paginated<SongWithArrangements>>('GET', '/api/v1/songs', undefined, query);
  getSong = (id: string) => this.request<SongWithArrangements>('GET', `/api/v1/songs/${id}`);
  createSong = (body: Record<string, unknown>) =>
    this.request<SongWithArrangements>('POST', '/api/v1/songs', body);
  updateSong = (id: string, body: Record<string, unknown>) =>
    this.request<SongRow>('PATCH', `/api/v1/songs/${id}`, body);
  deleteSong = (id: string) => this.request<void>('DELETE', `/api/v1/songs/${id}`);
  createArrangement = (songId: string, body: Record<string, unknown>) =>
    this.request<ArrangementRow>('POST', `/api/v1/songs/${songId}/arrangements`, body);
  updateArrangement = (id: string, body: Record<string, unknown>) =>
    this.request<ArrangementRow>('PATCH', `/api/v1/arrangements/${id}`, body);
  deleteArrangement = (id: string) => this.request<void>('DELETE', `/api/v1/arrangements/${id}`);
  /** Server-side transposition, so web and native render identical charts. */
  getChart = (arrangementId: string, query?: { to?: string; semitones?: number; prefer?: string }) =>
    this.request<{ chordpro: string; key: string | null; semitones: number }>(
      'GET',
      `/api/v1/arrangements/${arrangementId}/chart`,
      undefined,
      query,
    );

  // -------------------------------------------------------------- plans --
  listPlans = (query?: Query) =>
    this.request<Paginated<PlanSummary>>('GET', '/api/v1/plans', undefined, query);
  getPlan = (id: string) => this.request<PlanDetail>('GET', `/api/v1/plans/${id}`);
  createPlan = (body: Record<string, unknown>) =>
    this.request<PlanDetail>('POST', '/api/v1/plans', body);
  updatePlan = (id: string, body: Record<string, unknown>) =>
    this.request<PlanRow>('PATCH', `/api/v1/plans/${id}`, body);
  deletePlan = (id: string) => this.request<void>('DELETE', `/api/v1/plans/${id}`);
  duplicatePlan = (id: string, body: { service_date: string; title?: string; copy_assignments?: boolean }) =>
    this.request<PlanDetail>('POST', `/api/v1/plans/${id}/duplicate`, body);

  addPlanItem = (planId: string, body: Record<string, unknown>) =>
    this.request<PlanItemRow>('POST', `/api/v1/plans/${planId}/items`, body);
  updatePlanItem = (planId: string, itemId: string, body: Record<string, unknown>) =>
    this.request<PlanItemRow>('PATCH', `/api/v1/plans/${planId}/items/${itemId}`, body);
  deletePlanItem = (planId: string, itemId: string) =>
    this.request<void>('DELETE', `/api/v1/plans/${planId}/items/${itemId}`);
  reorderPlanItems = (planId: string, itemIds: string[]) =>
    this.request<PlanItemRow[]>('PUT', `/api/v1/plans/${planId}/items/order`, {
      item_ids: itemIds,
    });

  // --------------------------------------------------------- scheduling --
  createAssignments = (planId: string, body: Record<string, unknown>) =>
    this.request<{ created: AssignmentRow[]; conflicts: SchedulingConflict[] }>(
      'POST',
      `/api/v1/plans/${planId}/assignments`,
      body,
    );
  updateAssignment = (id: string, body: Record<string, unknown>) =>
    this.request<AssignmentRow>('PATCH', `/api/v1/assignments/${id}`, body);
  deleteAssignment = (id: string) => this.request<void>('DELETE', `/api/v1/assignments/${id}`);
  respondToAssignment = (id: string, body: { status: 'confirmed' | 'declined'; notes?: string | null }) =>
    this.request<AssignmentRow>('POST', `/api/v1/assignments/${id}/respond`, body);
  notifyPlan = (planId: string) =>
    this.request<AssignmentNotificationSendResult>('POST', `/api/v1/plans/${planId}/notify`, {});
  checkConflicts = (body: { starts_at: string; ends_at: string; user_ids: string[] }) =>
    this.request<SchedulingConflict[]>('POST', '/api/v1/scheduling/conflicts', body);

  mySchedule = (query?: Query) =>
    this.request<MyScheduleEntry[]>('GET', '/api/v1/schedule/mine', undefined, query);

  // ----------------------------------------------------------- calendar --
  calendar = (query: { from: string; to: string; mine?: boolean; team_id?: string; service_type_id?: string; include_rehearsals?: boolean }) =>
    this.request<CalendarEvent[]>('GET', '/api/v1/calendar', undefined, query as Query);

  previewAssignmentResponse = (token: string) =>
    this.request<AssignmentRespondPreview>('GET', `/api/v1/assignment-responses/${encodeURIComponent(token)}`);
  respondToAssignmentNotification = (token: string, body: { status: 'confirmed' | 'declined'; notes?: string | null }) =>
    this.request<AssignmentRespondResult>('POST', `/api/v1/assignment-responses/${encodeURIComponent(token)}/respond`, body);
  getCalendarFeed = () => this.request<CalendarFeedTokenResponse>('GET', '/api/v1/me/calendar-feed');
  rotateCalendarFeed = () => this.request<CalendarFeedTokenResponse>('POST', '/api/v1/me/calendar-feed', {});

  // ---------------------------------------------------------- blockouts --
  listBlockouts = (query?: Query) =>
    this.request<BlockoutRow[]>('GET', '/api/v1/blockouts', undefined, query);
  createBlockout = (body: { starts_at: string; ends_at: string; reason?: string | null }) =>
    this.request<BlockoutRow>('POST', '/api/v1/blockouts', body);
  deleteBlockout = (id: string) => this.request<void>('DELETE', `/api/v1/blockouts/${id}`);

  // ----------------------------------------------------------- songbooks --
  listSongbooks = () => this.request<SongbookRow[]>('GET', '/api/v1/songbooks');
  getSongbook = (id: string) => this.request<SongbookDetail>('GET', `/api/v1/songbooks/${id}`);
  createSongbook = (body: Record<string, unknown>) =>
    this.request<SongbookDetail>('POST', '/api/v1/songbooks', body);
  deleteSongbook = (id: string) => this.request<void>('DELETE', `/api/v1/songbooks/${id}`);

  // ------------------------------------------------- phase 2: OCR import --
  listImports = () => this.request<ChordSheetImportRow[]>('GET', '/api/v1/imports');
  getImportQuota = () => this.request<ImportQuota>('GET', '/api/v1/imports/quota');
  getImport = (id: string) => this.request<ChordSheetImportRow>('GET', `/api/v1/imports/${id}`);
  createImport = (body: { storage_path: string; original_filename?: string | null }) =>
    this.request<ImportWithQuota>('POST', '/api/v1/imports', body);
  retryImport = (id: string) =>
    this.request<ImportWithQuota>('POST', `/api/v1/imports/${id}/retry`, {});
  acceptImport = (id: string, body: Record<string, unknown>) =>
    this.request<{ song: SongRow; arrangement: ArrangementRow }>(
      'POST',
      `/api/v1/imports/${id}/accept`,
      body,
    );

  health = () => this.request<{ status: string; version: string }>('GET', '/health');
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};
