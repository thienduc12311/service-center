/**
 * Typed client for the Express API. Shared verbatim by the web app and the
 * React Native app — the only difference is how each supplies the access token.
 */

import type {
  ArrangementRow,
  AssignmentOwnerChangeRow,
  AssignmentRow,
  PersonEligibilityRecordRow,
  ServiceTypeFolderRow,
  BlockoutRow,
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
  AccessMember,
  AccessMoveChange,
  CapabilityExplanation,
  EffectiveAccess,
  FolderTree,
  ScopeAccess,
  TeamCandidate,
  TeamEligibilityEntry,
  TeamPolicySettings,
  CalendarEvent,
  AssignmentNotificationSendResult,
  AssignmentRespondPreview,
  AssignmentRespondResult,
  CalendarFeedTokenResponse,
  CurrentUser,
  DeliveryList,
  DeliveryListItem,
  DeliveryTransportStatus,
  DeviceRegistration,
  ImportPlanContentsResult,
  InvitationPreview,
  MyScheduleEntry,
  NotificationFeed,
  NotificationFeedItem,
  Paginated,
  PersonDetail,
  PlanDetail,
  PlanPositionNeed,
  PlanSummary,
  RosterPerson,
  SchedulingConflict,
  ServiceTypeSetupResult,
  SongChart,
  SongListItem,
  SongScheduleEntry,
  SongWithArrangements,
  SongbookDetail,
  TeamWithPositions,
  UnreadNotificationCount,
} from '../types/domain.js';
import type { CreatePersonInput, UpdatePersonInput } from '../schemas/people.js';
import type {
  ChartQuery,
  CreateArrangementInput,
  CreateSongInput,
  SongScheduleQuery,
  UpdateArrangementInput,
  UpdateSongInput,
} from '../schemas/song.js';
import type { ServiceTypePayload } from '../schemas/organization.js';
import type { ServiceTypeSetupPayload } from '../schemas/service-type.js';
import type {
  DuplicatePlanRequest,
  ImportPlanContentsRequest,
  SetPlanPositionNeedsInput,
} from '../schemas/plan.js';
import type { ListDeliveriesRequest, NotifyPlanInput } from '../schemas/delivery.js';
import type {
  ArchiveServiceTypeInput,
  CopyServiceTypeRequest,
  CreateFolderRequest,
  EligibilityRecordInput,
  ExplainCapabilityQuery,
  MoveFolderRequest,
  MoveServiceTypeRequest,
  ReleaseAssignmentsRequest,
  ReplaceScopeGrantsInput,
  RosterVisibilityInput,
  SetResponseOwnerInput,
  UpdateFolderInput,
  UpdateMemberAccessInput,
} from '../schemas/access.js';
import type { RespondToAssignmentNotificationRequest, RespondToAssignmentRequest } from '../schemas/assignment.js';
import type {
  ListNotificationsQuery,
  MarkNotificationsReadInput,
  RegisterDeviceInput,
  RevokeDeviceRegistrationInput,
} from '../schemas/notification.js';
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

export interface ApiRequestContext {
  accessToken: string | null;
  organizationId?: string | null;
  /** Opaque caller metadata returned to onUnauthorized for stale-request checks. */
  metadata?: Readonly<Record<string, unknown>>;
}

interface ApiClientOptionsBase {
  baseUrl: string;
  /** Active organization, sent as X-Organization-Id. */
  getOrganizationId?: () => string | null;
  fetchImpl?: typeof fetch;
  onUnauthorized?: (context: ApiRequestContext) => void;
}

export type ApiClientOptions = ApiClientOptionsBase &
  (
    | {
        /** Called before every request; return null when signed out. */
        getAccessToken: () => Promise<string | null> | string | null;
        getRequestContext?: never;
      }
    | {
        /**
         * Atomically captures authentication and organization for one request.
         * Prefer this when either value can change while an async token read is in progress.
         */
        getRequestContext: () => Promise<ApiRequestContext> | ApiRequestContext;
        getAccessToken?: never;
      }
  );

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
    const context = this.options.getRequestContext
      ? await this.options.getRequestContext()
      : {
          accessToken: (await this.options.getAccessToken?.()) ?? null,
          organizationId: this.options.getOrganizationId?.() ?? null,
        };
    const token = context.accessToken;
    const orgId = context.organizationId;

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
      if (response.status === 401) this.options.onUnauthorized?.(context);
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
  /** Archived service types are left out unless asked for. */
  listServiceTypes = (query?: { include_archived?: boolean }) =>
    this.request<ServiceTypeRow[]>('GET', '/api/v1/service-types', undefined, query);
  createServiceType = (body: ServiceTypePayload) =>
    this.request<ServiceTypeRow>('POST', '/api/v1/service-types', body);
  updateServiceType = (id: string, body: Partial<ServiceTypePayload>) =>
    this.request<ServiceTypeRow>('PATCH', `/api/v1/service-types/${id}`, body);
  deleteServiceType = (id: string) => this.request<void>('DELETE', `/api/v1/service-types/${id}`);
  /** The three-step setup wizard: service type + first plan + its teams, in one call. */
  setUpServiceType = (body: ServiceTypeSetupPayload) =>
    this.request<ServiceTypeSetupResult>('POST', '/api/v1/service-types/setup', body);

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
    this.request<Paginated<SongListItem>>('GET', '/api/v1/songs', undefined, query);
  getSong = (id: string) => this.request<SongWithArrangements>('GET', `/api/v1/songs/${id}`);
  /** Creates the song and its first arrangement in one call. */
  createSong = (body: CreateSongInput) =>
    this.request<SongWithArrangements>('POST', '/api/v1/songs', body);
  updateSong = (id: string, body: UpdateSongInput) =>
    this.request<SongRow>('PATCH', `/api/v1/songs/${id}`, body);
  deleteSong = (id: string) => this.request<void>('DELETE', `/api/v1/songs/${id}`);
  /** The most recent services the song was scheduled in, newest first. */
  getSongSchedule = (id: string, query?: Partial<SongScheduleQuery>) =>
    this.request<SongScheduleEntry[]>('GET', `/api/v1/songs/${id}/schedule`, undefined, {
      limit: query?.limit,
      arrangement_id: query?.arrangement_id,
    });
  createArrangement = (songId: string, body: CreateArrangementInput) =>
    this.request<ArrangementRow>('POST', `/api/v1/songs/${songId}/arrangements`, body);
  updateArrangement = (id: string, body: UpdateArrangementInput) =>
    this.request<ArrangementRow>('PATCH', `/api/v1/arrangements/${id}`, body);
  deleteArrangement = (id: string) => this.request<void>('DELETE', `/api/v1/arrangements/${id}`);
  /**
   * Transposes and/or converts the chart server-side, so web and native render
   * identical output for the same request.
   */
  getChart = (arrangementId: string, query?: Partial<ChartQuery>) =>
    this.request<SongChart>(
      'GET',
      `/api/v1/arrangements/${arrangementId}/chart`,
      undefined,
      query as Query,
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
  duplicatePlan = (id: string, body: DuplicatePlanRequest) =>
    this.request<PlanDetail>('POST', `/api/v1/plans/${id}/duplicate`, body);
  /** Copies another plan's order/needs/team into this one in one transaction. */
  importPlanContents = (planId: string, body: ImportPlanContentsRequest) =>
    this.request<ImportPlanContentsResult>('POST', `/api/v1/plans/${planId}/import`, body);

  addPlanItem = (planId: string, body: Record<string, unknown>) =>
    this.request<PlanItemRow>('POST', `/api/v1/plans/${planId}/items`, body);
  updatePlanItem = (planId: string, itemId: string, body: Record<string, unknown>) =>
    this.request<PlanItemRow>('PATCH', `/api/v1/plans/${planId}/items/${itemId}`, body);
  deletePlanItem = (planId: string, itemId: string) =>
    this.request<void>('DELETE', `/api/v1/plans/${planId}/items/${itemId}`);
  /** Replaces the staffing need for every position sent; others are left alone. */
  setPlanPositionNeeds = (planId: string, body: SetPlanPositionNeedsInput) =>
    this.request<PlanPositionNeed[]>('PUT', `/api/v1/plans/${planId}/position-needs`, body);
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
  respondToAssignment = (id: string, body: RespondToAssignmentRequest) =>
    this.request<AssignmentRow>('POST', `/api/v1/assignments/${id}/respond`, body);
  notifyPlan = (planId: string, body: NotifyPlanInput = {}) =>
    this.request<AssignmentNotificationSendResult>('POST', `/api/v1/plans/${planId}/notify`, body);

  /** Releases exactly the reviewed prepared requests, notifying in the same transaction. */
  releaseAssignments = (planId: string, body: ReleaseAssignmentsRequest) =>
    this.request<{ released: AssignmentRow[] }>('POST', `/api/v1/plans/${planId}/release`, body);
  setResponseOwner = (body: SetResponseOwnerInput) =>
    this.request<AssignmentRow[]>('PUT', '/api/v1/assignments/response-owner', body);
  responseOwnerHistory = (assignmentId: string) =>
    this.request<AssignmentOwnerChangeRow[]>('GET', `/api/v1/assignments/${assignmentId}/response-owner-history`);

  // ------------------------------------------------------------- access --
  /** The caller's effective access in the active organization. */
  myAccess = () => this.request<EffectiveAccess>('GET', '/api/v1/access/me');
  /** Administrators: every member's role, access mode and explicit grants. */
  listAccessMembers = () => this.request<AccessMember[]>('GET', '/api/v1/access/members');
  memberAccess = (userId: string) => this.request<EffectiveAccess>('GET', `/api/v1/access/members/${userId}`);
  updateMemberAccess = (userId: string, body: UpdateMemberAccessInput) =>
    this.request<AccessMember>('PATCH', `/api/v1/access/members/${userId}`, body);
  explainAccess = (query: ExplainCapabilityQuery) =>
    this.request<CapabilityExplanation>('GET', '/api/v1/access/explain', undefined, query as unknown as Query);
  organizationAccess = () => this.request<ScopeAccess>('GET', '/api/v1/access/organization');
  replaceOrganizationAccess = (body: ReplaceScopeGrantsInput) =>
    this.request<ScopeAccess>('PUT', '/api/v1/access/organization', body);
  serviceTypeAccess = (id: string) => this.request<ScopeAccess>('GET', `/api/v1/service-types/${id}/access`);
  replaceServiceTypeAccess = (id: string, body: ReplaceScopeGrantsInput) =>
    this.request<ScopeAccess>('PUT', `/api/v1/service-types/${id}/access`, body);
  teamAccess = (id: string) => this.request<ScopeAccess>('GET', `/api/v1/teams/${id}/access`);
  replaceTeamAccess = (id: string, body: ReplaceScopeGrantsInput) =>
    this.request<ScopeAccess>('PUT', `/api/v1/teams/${id}/access`, body);
  folderAccess = (id: string) => this.request<ScopeAccess>('GET', `/api/v1/folders/${id}/access`);
  replaceFolderAccess = (id: string, body: ReplaceScopeGrantsInput) =>
    this.request<ScopeAccess>('PUT', `/api/v1/folders/${id}/access`, body);

  // ------------------------------------------------------------ folders --
  folderTree = () => this.request<FolderTree>('GET', '/api/v1/folders');
  createFolder = (body: CreateFolderRequest) => this.request<ServiceTypeFolderRow>('POST', '/api/v1/folders', body);
  updateFolder = (id: string, body: UpdateFolderInput) =>
    this.request<ServiceTypeFolderRow>('PATCH', `/api/v1/folders/${id}`, body);
  deleteFolder = (id: string) => this.request<void>('DELETE', `/api/v1/folders/${id}`);
  previewFolderMove = (id: string, parentId: string | null) =>
    this.request<AccessMoveChange[]>('GET', `/api/v1/folders/${id}/move-preview`, undefined, { parent_id: parentId ?? undefined });
  moveFolder = (id: string, body: MoveFolderRequest) =>
    this.request<ServiceTypeFolderRow>('POST', `/api/v1/folders/${id}/move`, body);
  setLandingFolder = (folderId: string | null) =>
    this.request<void>('PUT', '/api/v1/folders/landing', { folder_id: folderId });
  previewServiceTypeMove = (id: string, folderId: string | null) =>
    this.request<AccessMoveChange[]>('GET', `/api/v1/service-types/${id}/move-preview`, undefined, { folder_id: folderId ?? undefined });
  moveServiceType = (id: string, body: MoveServiceTypeRequest) =>
    this.request<ServiceTypeRow>('POST', `/api/v1/service-types/${id}/move`, body);
  archiveServiceType = (id: string, body: ArchiveServiceTypeInput) =>
    this.request<ServiceTypeRow>('POST', `/api/v1/service-types/${id}/archive`, body);
  copyServiceType = (id: string, body: CopyServiceTypeRequest) =>
    this.request<ServiceTypeRow>('POST', `/api/v1/service-types/${id}/copy`, body);
  serviceTypeTeams = (id: string) => this.request<string[]>('GET', `/api/v1/service-types/${id}/teams`);
  replaceServiceTypeTeams = (id: string, teamIds: string[]) =>
    this.request<string[]>('PUT', `/api/v1/service-types/${id}/teams`, { team_ids: teamIds });

  // ------------------------------------------------------ team policies --
  teamPolicies = (teamId: string) => this.request<TeamPolicySettings>('GET', `/api/v1/teams/${teamId}/policies`);
  replaceTeamTagRules = (teamId: string, tags: string[]) =>
    this.request<TeamPolicySettings>('PUT', `/api/v1/teams/${teamId}/tag-rules`, { tags });
  replaceRelatedTeams = (teamId: string, teamIds: string[]) =>
    this.request<TeamPolicySettings>('PUT', `/api/v1/teams/${teamId}/related-teams`, { team_ids: teamIds });
  teamCandidates = (teamId: string) => this.request<TeamCandidate[]>('GET', `/api/v1/teams/${teamId}/candidates`);
  teamEligibility = (teamId: string) =>
    this.request<TeamEligibilityEntry[]>('GET', `/api/v1/teams/${teamId}/eligibility`);
  personTags = (personId: string) => this.request<string[]>('GET', `/api/v1/people/${personId}/tags`);
  replacePersonTags = (personId: string, tags: string[]) =>
    this.request<string[]>('PUT', `/api/v1/people/${personId}/tags`, { tags });
  listEligibilityRecords = (userId: string) =>
    this.request<PersonEligibilityRecordRow[]>('GET', `/api/v1/people/members/${userId}/eligibility`);
  recordEligibility = (body: EligibilityRecordInput) =>
    this.request<PersonEligibilityRecordRow>('POST', '/api/v1/people/eligibility', body);
  setRosterVisibility = (body: RosterVisibilityInput) =>
    this.request<RosterVisibilityInput>('PUT', '/api/v1/access/roster-visibility', body);

  // --------------------------------------------------------- deliveries --
  deliveryStatus = () => this.request<DeliveryTransportStatus>('GET', '/api/v1/deliveries/status');
  listDeliveries = (query?: ListDeliveriesRequest) =>
    this.request<DeliveryList>('GET', '/api/v1/deliveries', undefined, query as Query);
  /** Re-queues a failed or uncertain delivery (administrators only). */
  retryDelivery = (id: string) =>
    this.request<DeliveryListItem>('POST', `/api/v1/deliveries/${id}/retry`, {});
  checkConflicts = (body: { starts_at: string; ends_at: string; user_ids: string[] }) =>
    this.request<SchedulingConflict[]>('POST', '/api/v1/scheduling/conflicts', body);

  mySchedule = (query?: Query) =>
    this.request<MyScheduleEntry[]>('GET', '/api/v1/schedule/mine', undefined, query);

  // ----------------------------------------------------------- calendar --
  calendar = (query: { from: string; to: string; mine?: boolean; team_id?: string; service_type_id?: string; include_rehearsals?: boolean }) =>
    this.request<CalendarEvent[]>('GET', '/api/v1/calendar', undefined, query as Query);

  previewAssignmentResponse = (token: string) =>
    this.request<AssignmentRespondPreview>('GET', `/api/v1/assignment-responses/${encodeURIComponent(token)}`);
  respondToAssignmentNotification = (token: string, body: RespondToAssignmentNotificationRequest) =>
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

  // ------------------------------------------------------- notifications --
  listNotifications = (query?: Partial<ListNotificationsQuery>) =>
    this.request<NotificationFeed>('GET', '/api/v1/notifications', undefined, query);
  unreadNotificationCount = () =>
    this.request<UnreadNotificationCount>('GET', '/api/v1/notifications/unread-count');
  getNotification = (id: string) =>
    this.request<NotificationFeedItem>('GET', `/api/v1/notifications/${id}`);
  /** Omit `ids` to mark everything in the active organization as read. */
  markNotificationsRead = (body: MarkNotificationsReadInput = {}) =>
    this.request<UnreadNotificationCount>('POST', '/api/v1/notifications/read', body);

  /** Registers this device for push. Not organization-scoped. */
  registerDevice = (body: RegisterDeviceInput) =>
    this.request<DeviceRegistration>('POST', '/api/v1/me/devices', body);
  unregisterDevice = (token: string) =>
    this.request<void>('DELETE', `/api/v1/me/devices/${encodeURIComponent(token)}`);
  /** Revokes one registration after auth is gone; the secret authorizes only this token. */
  revokeDeviceRegistration = (body: RevokeDeviceRegistrationInput) =>
    this.request<void>('POST', '/api/v1/device-revocations', body);

  health = () => this.request<{ status: string; version: string }>('GET', '/health');
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};
