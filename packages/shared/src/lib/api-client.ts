/**
 * Typed client for the Express API. Shared verbatim by the web app and the
 * React Native app — the only difference is how each supplies the access token.
 */

import type {
  AvailabilityAudienceMember,
  AvailabilityRequestDetail,
  AvailabilityRequestSummary,
  AvailabilityReviewStatus,
  CombinedSchedule,
  CopyAvailabilityResult,
  CreateAvailabilityRequestResult,
  DelegatedResponseResult,
  DelegatedSchedule,
  DelegationSummary,
  MyAvailabilityRequest,
  PreferenceWarning,
  SchedulingPreferenceRow,
  UserScheduleSettingsRow,
} from '../types/availability.js';
import type {
  CombinedScheduleQuery,
  CopyAvailabilityRequest,
  CreateAvailabilityRequestInput,
  DelegatedRespondInput,
  GrantDelegationRequest,
  PreferenceWarningsInput,
  PreviewAvailabilityRequestInput,
  SaveSchedulingPreferenceRequest,
  ScheduleSettingsInput,
} from '../schemas/availability.js';
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
  AssignmentResponseCommitResult,
  AssignmentResponseReview,
  AssignmentReleasePreview,
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
  AffectedAssignmentPreview,
  BlockoutSaveResult,
  BlockoutSeriesDetail,
  BlockoutSeriesSaveResult,
  BlockoutOccurrencePreview,
} from '../types/domain.js';
import type {
  AffectedAssignmentsPreviewInput,
  CreateBlockoutInput,
  CreateBlockoutSeriesInput,
  MaintainBlockoutSeriesInput,
  PreviewBlockoutSeriesInput,
  UpdateBlockoutInput,
} from '../schemas/blockout.js';
import type { CreatePersonInput, UpdatePersonInput } from '../schemas/people.js';
import type {
  IdentityReconciliation,
  PersonDeliveryReadiness,
  GlobalSearchResults,
  PersonRosterEvent,
  PersonTagGroupRow,
  RosterBulkApplyResult,
  RosterBulkPreview,
  RosterTagCatalog,
} from '../types/roster.js';
import type {
  CreateGuestInput,
  CreatePlanPositionRequest,
  DeliveryReadinessInput,
  ResolveReconciliationInput,
  ApplyRosterBulkRequest,
  CreateTagGroupRequest,
  PreviewRosterBulkRequest,
  SetTagGroupInput,
} from '../schemas/roster.js';
import type {
  ChartQuery,
  CreateArrangementInput,
  CreateSongInput,
  SongScheduleQuery,
  UpdateArrangementInput,
  UpdateSongInput,
} from '../schemas/song.js';
import type { ServiceTypePayload } from '../schemas/organization.js';
import type {
  AssignmentConflictOverrideRow,
  AttendanceConflict,
  ConflictCheckResult,
  PlanTimeImpact,
} from '../types/attendance.js';
import type {
  CheckAssignmentConflictsRequest,
  PreviewPlanTimesInput,
  SetAssignmentAttendanceRequest,
} from '../schemas/attendance.js';
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
  ReleaseAssignmentsPreviewInput,
  ReleaseAssignmentsRequest,
  ReplaceScopeGrantsInput,
  RosterVisibilityInput,
  SetResponseOwnerInput,
  UpdateFolderInput,
  UpdateMemberAccessInput,
} from '../schemas/access.js';
import type {
  PreviewAssignmentResponsesInput,
  RespondToAssignmentNotificationRequest,
  RespondToAssignmentRequest,
  RespondToAssignmentSnapshotsRequest,
} from '../schemas/assignment.js';
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
import type {
  StaffingMatrixCommitResult,
  StaffingMatrixPage,
  StaffingMatrixPreview,
  StaffingMatrixSavedView,
} from '../types/staffing-matrix.js';
import type {
  CommitStaffingMatrixInput,
  PreviewStaffingMatrixInput,
  SaveStaffingMatrixViewInput,
  StaffingMatrixQueryInput,
} from '../schemas/staffing-matrix.js';

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

  /** Archived people are left out unless asked for. */
  listPeople = (query?: { include_archived?: boolean }) =>
    this.request<RosterPerson[]>('GET', '/api/v1/people', undefined, query as Query);
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

  // ------------------------------------------------------ roster (F02) --
  archivePerson = (personId: string) =>
    this.request<PersonDetail>('POST', `/api/v1/people/${personId}/archive`, {});
  restorePerson = (personId: string) =>
    this.request<PersonDetail>('POST', `/api/v1/people/${personId}/restore`, {});
  rosterAudit = (query?: { person_id?: string; limit?: number }) =>
    this.request<PersonRosterEvent[]>('GET', '/api/v1/people/audit', undefined, query as Query);
  rosterTagCatalog = () => this.request<RosterTagCatalog>('GET', '/api/v1/people/tag-catalog');
  createTagGroup = (body: CreateTagGroupRequest) =>
    this.request<PersonTagGroupRow>('POST', '/api/v1/people/tag-groups', body);
  updateTagGroup = (groupId: string, body: Partial<CreateTagGroupRequest>) =>
    this.request<PersonTagGroupRow>('PATCH', `/api/v1/people/tag-groups/${groupId}`, body);
  deleteTagGroup = (groupId: string) => this.request<void>('DELETE', `/api/v1/people/tag-groups/${groupId}`);
  setTagGroup = (body: SetTagGroupInput) =>
    this.request<RosterTagCatalog>('PUT', '/api/v1/people/tag-catalog', body);
  previewRosterBulk = (body: PreviewRosterBulkRequest) =>
    this.request<RosterBulkPreview>('POST', '/api/v1/people/bulk/preview', body);
  applyRosterBulk = (body: ApplyRosterBulkRequest) =>
    this.request<RosterBulkApplyResult>('POST', '/api/v1/people/bulk/apply', body);
  /** A minimal no-login Person, created while staffing (schedulers or people managers). */
  createGuest = (body: CreateGuestInput) => this.request<RosterPerson>('POST', '/api/v1/people/guests', body);
  /** Whether requests can reach these People (login / email / active), never the address. */
  deliveryReadiness = (body: DeliveryReadinessInput) =>
    this.request<PersonDeliveryReadiness[]>('POST', '/api/v1/people/readiness', body);
  /** Possible duplicate identities awaiting an administrator's decision. */
  identityReconciliations = () =>
    this.request<IdentityReconciliation[]>('GET', '/api/v1/people/reconciliations');
  resolveIdentityReconciliation = (id: string, body: ResolveReconciliationInput) =>
    this.request<IdentityReconciliation>('POST', `/api/v1/people/reconciliations/${id}/resolve`, body);
  createPlanPosition = (planId: string, body: CreatePlanPositionRequest) =>
    this.request<TeamPositionRow>('POST', `/api/v1/plans/${planId}/positions`, body);
  deletePlanPosition = (planId: string, positionId: string) =>
    this.request<void>('DELETE', `/api/v1/plans/${planId}/positions/${positionId}`);
  /** Permission-filtered search across people, teams, positions, plans, songs and media. */
  search = (query: { q: string; limit?: number }) =>
    this.request<GlobalSearchResults>('GET', '/api/v1/search', undefined, query as Query);

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
  addTeamMember = (teamId: string, body: { person_id?: string; user_id?: string; position_id?: string | null }) =>
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
    this.request<{ created: AssignmentRow[]; conflicts: AttendanceConflict[]; warnings?: PreferenceWarning[] }>(
      'POST',
      `/api/v1/plans/${planId}/assignments`,
      body,
    );
  updateAssignment = (id: string, body: Record<string, unknown>) =>
    this.request<AssignmentRow>('PATCH', `/api/v1/assignments/${id}`, body);
  /** F04: change which times existing requests cover (expected revisions required). */
  setAssignmentAttendance = (planId: string, body: SetAssignmentAttendanceRequest) =>
    this.request<{ updated: AssignmentRow[] }>('PUT', `/api/v1/plans/${planId}/assignment-times`, body);
  /** F04: what a proposed full time list would do to requests, before saving it. */
  previewPlanTimes = (planId: string, body: PreviewPlanTimesInput) =>
    this.request<PlanTimeImpact>('POST', `/api/v1/plans/${planId}/times/preview`, body);
  /** F04: requests committed over a conflict on this plan, with reasons. */
  planConflictOverrides = (planId: string) =>
    this.request<AssignmentConflictOverrideRow[]>('GET', `/api/v1/plans/${planId}/conflict-overrides`);
  deleteAssignment = (id: string) => this.request<void>('DELETE', `/api/v1/assignments/${id}`);
  respondToAssignment = (id: string, body: RespondToAssignmentRequest) =>
    this.request<AssignmentRow>('POST', `/api/v1/assignments/${id}/respond`, body);
  previewAssignmentResponses = (body: PreviewAssignmentResponsesInput) =>
    this.request<AssignmentResponseReview[]>('POST', '/api/v1/assignments/responses/preview', body);
  respondToAssignmentSnapshots = (body: RespondToAssignmentSnapshotsRequest) =>
    this.request<AssignmentResponseCommitResult>('POST', '/api/v1/assignments/responses/commit', body);
  notifyPlan = (planId: string, body: NotifyPlanInput = {}) =>
    this.request<AssignmentNotificationSendResult>('POST', `/api/v1/plans/${planId}/notify`, body);

  /** Releases exactly the reviewed prepared requests, notifying in the same transaction. */
  previewAssignmentRelease = (planId: string, body: ReleaseAssignmentsPreviewInput) =>
    this.request<AssignmentReleasePreview>('POST', `/api/v1/plans/${planId}/release/preview`, body);
  releaseAssignments = (planId: string, body: ReleaseAssignmentsRequest) =>
    this.request<{ released: AssignmentRow[] }>('POST', `/api/v1/plans/${planId}/release`, body);
  setResponseOwner = (body: SetResponseOwnerInput) =>
    this.request<AssignmentRow[]>('PUT', '/api/v1/assignments/response-owner', body);
  responseOwnerHistory = (assignmentId: string) =>
    this.request<AssignmentOwnerChangeRow[]>('GET', `/api/v1/assignments/${assignmentId}/response-owner-history`);

  // ---------------------------------------------------- staffing matrix --
  staffingMatrix = (body: StaffingMatrixQueryInput) =>
    this.request<StaffingMatrixPage>('POST', '/api/v1/staffing-matrix/query', body);
  previewStaffingMatrix = (body: PreviewStaffingMatrixInput) =>
    this.request<StaffingMatrixPreview>('POST', '/api/v1/staffing-matrix/preview', body);
  commitStaffingMatrix = (body: CommitStaffingMatrixInput) =>
    this.request<StaffingMatrixCommitResult>('POST', '/api/v1/staffing-matrix/commit', body);
  staffingMatrixViews = () =>
    this.request<StaffingMatrixSavedView[]>('GET', '/api/v1/staffing-matrix/views');
  saveStaffingMatrixView = (body: SaveStaffingMatrixViewInput) =>
    this.request<StaffingMatrixSavedView>('POST', '/api/v1/staffing-matrix/views', body);
  deleteStaffingMatrixView = (id: string) =>
    this.request<void>('DELETE', `/api/v1/staffing-matrix/views/${id}`);

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
  /** F04: typed, redacted conflicts for prospective requests (actual attendance intervals). */
  checkAssignmentConflicts = (body: CheckAssignmentConflictsRequest) =>
    this.request<ConflictCheckResult>('POST', '/api/v1/scheduling/conflicts/check', body);

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
  createBlockout = (body: CreateBlockoutInput | { starts_at: string; ends_at: string; reason?: string | null }) =>
    this.request<BlockoutRow | BlockoutSaveResult>('POST', '/api/v1/blockouts', body);
  updateBlockout = (id: string, body: UpdateBlockoutInput) =>
    this.request<BlockoutSaveResult>('PATCH', `/api/v1/blockouts/${id}`, body);
  deleteBlockout = (id: string, expectedRevision?: number) =>
    this.request<void>('DELETE', `/api/v1/blockouts/${id}`, undefined,
      expectedRevision == null ? undefined : { expected_revision: expectedRevision });
  previewAffectedAssignments = (body: AffectedAssignmentsPreviewInput) =>
    this.request<AffectedAssignmentPreview[]>('POST', '/api/v1/blockouts/affected-assignments', body);
  previewBlockoutSeries = (body: PreviewBlockoutSeriesInput) =>
    this.request<{ occurrences: BlockoutOccurrencePreview[]; affected_assignments: AffectedAssignmentPreview[] }>(
      'POST', '/api/v1/blockouts/series/preview', body,
    );
  createBlockoutSeries = (body: CreateBlockoutSeriesInput) =>
    this.request<BlockoutSeriesSaveResult>('POST', '/api/v1/blockouts/series', body);
  getBlockoutSeries = (id: string) =>
    this.request<BlockoutSeriesDetail>('GET', `/api/v1/blockouts/series/${id}`);
  changeBlockoutSeries = (id: string, body: MaintainBlockoutSeriesInput) =>
    this.request<{ deleted: boolean; series_id: string; revision?: number }>(
      'POST', `/api/v1/blockouts/series/${id}/change`, body,
    );

  // ------------------------------------------- availability (F03) ---------
  listSchedulingPreferences = (query?: { person_id?: string }) =>
    this.request<SchedulingPreferenceRow[]>('GET', '/api/v1/availability/preferences', undefined, query);
  saveSchedulingPreference = (body: SaveSchedulingPreferenceRequest) =>
    this.request<SchedulingPreferenceRow>('PUT', '/api/v1/availability/preferences', body);
  deleteSchedulingPreference = (id: string) =>
    this.request<void>('DELETE', `/api/v1/availability/preferences/${id}`);
  availabilityReview = (query?: { person_id?: string }) =>
    this.request<AvailabilityReviewStatus>('GET', '/api/v1/availability/review', undefined, query);
  affirmAvailability = (body: { person_id?: string } = {}) =>
    this.request<AvailabilityReviewStatus>('POST', '/api/v1/availability/affirm', body);
  preferenceWarnings = (body: PreferenceWarningsInput) =>
    this.request<PreferenceWarning[]>('POST', '/api/v1/availability/warnings', body);
  previewAvailabilityRequest = (body: PreviewAvailabilityRequestInput) =>
    this.request<AvailabilityAudienceMember[]>('POST', '/api/v1/availability/requests/preview', body);
  createAvailabilityRequest = (body: CreateAvailabilityRequestInput) =>
    this.request<CreateAvailabilityRequestResult>('POST', '/api/v1/availability/requests', body);
  listAvailabilityRequests = (query?: { team_id?: string }) =>
    this.request<AvailabilityRequestSummary[]>('GET', '/api/v1/availability/requests', undefined, query);
  getAvailabilityRequest = (id: string) =>
    this.request<AvailabilityRequestDetail>('GET', `/api/v1/availability/requests/${id}`);
  myAvailabilityRequests = () =>
    this.request<MyAvailabilityRequest[]>('GET', '/api/v1/availability/requests/mine');

  listDelegations = () => this.request<DelegationSummary[]>('GET', '/api/v1/delegations');
  grantDelegation = (body: GrantDelegationRequest) =>
    this.request<DelegationSummary>('POST', '/api/v1/delegations', body);
  revokeDelegation = (id: string) =>
    this.request<DelegationSummary>('POST', `/api/v1/delegations/${id}/revoke`);
  delegatedSchedule = (id: string) =>
    this.request<DelegatedSchedule>('GET', `/api/v1/delegations/${id}/schedule`);
  respondAsDelegate = (id: string, assignmentId: string, body: DelegatedRespondInput) =>
    this.request<DelegatedResponseResult>('POST', `/api/v1/delegations/${id}/assignments/${assignmentId}/respond`, body);

  scheduleSettings = () => this.request<UserScheduleSettingsRow>('GET', '/api/v1/me/schedule-settings');
  updateScheduleSettings = (body: ScheduleSettingsInput) =>
    this.request<UserScheduleSettingsRow>('PUT', '/api/v1/me/schedule-settings', body);
  combinedSchedule = (query: CombinedScheduleQuery) =>
    this.request<CombinedSchedule>('GET', '/api/v1/me/combined-schedule', undefined, query);
  copyAvailability = (body: CopyAvailabilityRequest) =>
    this.request<CopyAvailabilityResult>('POST', '/api/v1/me/availability/copy', body);

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
