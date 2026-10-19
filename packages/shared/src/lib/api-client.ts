import type { ArrangementMaterials, LabeledKeyInput, LabeledKey, DuplicateArrangementInput, DuplicateArrangementCommit, DuplicateArrangementPreview, SongMergeInput, SongMergeCommit, SongMergePreview } from '../schemas/arrangement-curation.js';
import type { ImportPreviewRequest, ImportSaveRequest, ImportPreview, ImportJobDetail, ImportJob, ImportCommitRequest } from '../schemas/imports.js';
import type { SongBulkPreview } from '../types/song-curation.js';
import type { SongBulkPreviewInput, SongArchiveInput, SongBulkCommitInput } from '../schemas/song.js';
/**
 * Typed client for the Express API. Shared verbatim by the web app and the
 * React Native app — the only difference is how each supplies the access token.
 */

import type {
  FileDetail,
  FileDocument,
  FileDownload,
  FileFinalizeResult,
  FileLinkSummary,
  FileOwnerKind,
  FileSummary,
  FileUploadIntent,
  ParentFiles,
  PlanFiles,
} from '../types/files.js';
import type {
  ArchiveFileInput,
  CreateFileDocumentRequest,
  CreateFileLinkRequest,
  CreateFileUploadIntentRequest,
  FileDownloadRequest,
  LinkFileToPlanRequest,
  SaveFileDocumentVersionInput,
  SetFileLinkPinInput,
  UpdateFileLinkUrlInput,
  UpdateFileRequest,
} from '../schemas/files.js';
import type {
  ArchiveMediaInput,
  CreateMediaInput,
  CreatePlanStageLayoutInput,
  CreateStageTemplateRequest,
  ListMediaRequest,
  OfflinePackRequestInput,
  SetFilePlaybackRightsInput,
  SetPlanItemMediaInput,
  UpdateMediaInput,
  UpdatePlanStageLayoutInput,
  UpdateStageTemplateInput,
} from '../schemas/media.js';
import type { OfflinePackPlan, RehearsalManifest } from '../types/rehearsal.js';
import type {
  MediaDetail,
  MediaList,
  MediaSummary,
  PlanStageLayouts,
  PlanStageLayoutView,
  StageLayoutTemplateList,
  StageLayoutTemplateRow,
} from '../types/media.js';
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
  PlanItemSaveResult,
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
import type { UpdatePlanItemRequest } from '../schemas/plan.js';
import type { PlanScheduleResponse } from '../types/plan-order.js';
import type { LivePlanRuns, LiveRunHistory, LiveRunState } from '../types/live.js';
import type { CorrectLiveRunTimeInput, CreateLiveRunRequest, LiveRunActionInput } from '../schemas/live.js';
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
  ApprovedSwapRow,
  OpportunityClaimRow,
  OpportunityClaimDetail,
  ReplacementOfferRow,
  ReplacementRequestDetail,
  ReplacementRequestRow,
  SignupOpportunity,
  SignupOpportunityRow,
} from '../types/opportunities.js';
import type {
  ActOnApprovedSwapInput,
  ActOnReplacementOfferInput,
  CancelReplacementRequestInput,
  CancelSignupClaimInput,
  ClaimSignupOpportunityInput,
  CreateApprovedSwapInput,
  CreateReplacementRequestInput,
  CreateSignupOpportunityInput,
  DecideSignupClaimInput,
  IssueReplacementOfferInput,
  UpdateSignupOpportunityInput,
} from '../schemas/opportunities.js';
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
  PlanGenerationPreview,
  PlanGenerationResult,
  PlanTemplateApplicationRow,
  PlanTemplateDetail,
  PlanTemplateSummary,
  ReschedulePreview,
  RescheduleResult,
  TemplateApplyPreviewResult,
  TemplateApplyResult,
} from '../types/plan-templates.js';
import type {
  ApplyTemplateRequest,
  CreatePlanTemplateRequest,
  GeneratePlansRequest,
  ListPlanTemplatesRequest,
  PlanSeriesRequest,
  PreviewTemplateApplyRequest,
  RescheduleCommitRequest,
  ReschedulePreviewRequest,
  UpdatePlanTemplateRequest,
} from '../schemas/plan-templates.js';
import type {
  ConversationDetail,
  ConversationMessage,
  ConversationReport,
  ConversationSummary,
  DiscussionPage,
  MentionCandidate,
  MessageAudiencePreview,
  MessageTemplateList,
  MessageTemplateRow,
  NoteCategoryRow,
  OperationalMessageDetail,
  OperationalMessageSummary,
  PlanItemComment,
  PlanItemThread,
  PlanNote,
  PlanNotesResponse,
  PostDiscussionResult,
  SendOperationalMessageResult,
} from '../types/collaboration.js';
import type {
  ConversationMessagesQuery,
  CreateNoteCategoryInput,
  DiscussionPageQuery,
  ListOperationalMessagesQuery,
  OpenConversationInput,
  PostConversationMessageInput,
  PostItemCommentInput,
  PreviewOperationalMessageInput,
  ReportConversationMessageInput,
  ResolveConversationReportInput,
  RetryOperationalMessageInput,
  SaveMessageTemplateInput,
  SavePlanNoteInput,
  SendOperationalMessageInput,
  UpdateNoteCategoryInput,
} from '../schemas/collaboration.js';
import type {
  CreateReleaseBatchRequest,
  ListPreparedRequestsQuery,
  ListReleaseBatchesQuery,
  ReleaseBatchPreviewInput,
  ReminderPolicyScopeQuery,
  UpdateReminderPreferencesInput,
  UpsertReminderPolicyRequest,
} from '../schemas/reminders.js';
import type {
  PlanDeliveryHistory,
  PreparedRequestListItem,
  ReleaseBatchPreview,
  ReleaseBatchResult,
  ReleaseBatchSummary,
  ReminderPolicyRow,
  ReminderPolicyScopeView,
  ReminderPreferences,
} from '../types/reminders.js';
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
import type {
  RotationPreviewEntry,
  StaffingProposal,
  StaffingProposalCommitResult,
  TeamRotation,
} from '../types/staffing-proposals.js';
import type {
  CommitStaffingProposalInput,
  CreateStaffingProposalInput,
  CreateTeamRotationInput,
  RecomputeStaffingProposalInput,
  RotationPreviewQuery,
  UpdateTeamRotationInput,
} from '../schemas/staffing-proposals.js';

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

  previewImport = (body: ImportPreviewRequest) => this.request<ImportPreview>('POST', '/api/v1/imports/preview', body);
  saveImport = (body: ImportSaveRequest) => this.request<ImportJobDetail>('POST', '/api/v1/imports', body);
  listImports = () => this.request<ImportJob[]>('GET', '/api/v1/imports');
  getImport = (id: string) => this.request<ImportJobDetail>('GET', `/api/v1/imports/${id}`);
  commitImport = (id: string, body: ImportCommitRequest) => this.request<ImportJobDetail>('POST', `/api/v1/imports/${id}/commit`, body);

  // -------------------------------------------------------------- songs --
  previewSongBulk = (body: SongBulkPreviewInput) =>
    this.request<SongBulkPreview>('POST', '/api/v1/songs/bulk/preview', body);
  commitSongBulk = (body: SongBulkCommitInput) =>
    this.request<SongBulkPreview>('POST', '/api/v1/songs/bulk', body);
  getArrangementMaterials = (id: string) => this.request<ArrangementMaterials>('GET', `/api/v1/arrangements/${id}/materials`);
  saveArrangementKey = (id: string, body: LabeledKeyInput) => this.request<LabeledKey>('POST', `/api/v1/arrangements/${id}/keys`, body);
  previewArrangementDuplicate = (id: string, body: DuplicateArrangementInput) => this.request<DuplicateArrangementPreview>('POST', `/api/v1/arrangements/${id}/duplicate/preview`, body);
  duplicateArrangement = (id: string, body: DuplicateArrangementCommit) => this.request<{ arrangement_id: string; operation_id: string }>('POST', `/api/v1/arrangements/${id}/duplicate`, body);
  getSongDuplicates = (id: string) => this.request<{ id: string; title: string; reason: 'title' | 'ccli' }[]>('GET', `/api/v1/songs/${id}/duplicates`);
  previewSongMerge = (body: SongMergeInput) => this.request<SongMergePreview>('POST', '/api/v1/songs/merge/preview', body);
  mergeSongs = (body: SongMergeCommit) => this.request<{ winner_id: string; loser_id: string; operation_id: string }>('POST', '/api/v1/songs/merge', body);
  archiveSong = (id: string, body: SongArchiveInput) =>
    this.request<SongRow>('POST', `/api/v1/songs/${id}/archive`, body);
  archiveArrangement = (id: string, body: SongArchiveInput) =>
    this.request<ArrangementRow>('POST', `/api/v1/arrangements/${id}/archive`, body);
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

  // F10 saved templates, sections and bounded generation.
  planTemplates = (query: ListPlanTemplatesRequest = {}) =>
    this.request<PlanTemplateSummary[]>('GET', '/api/v1/plan-templates', undefined, query as Query);
  planTemplate = (templateId: string, revision?: number) =>
    this.request<PlanTemplateDetail>('GET', `/api/v1/plan-templates/${templateId}`, undefined, { revision });
  createPlanTemplate = (body: CreatePlanTemplateRequest) =>
    this.request<PlanTemplateDetail>('POST', '/api/v1/plan-templates', body);
  updatePlanTemplate = (templateId: string, body: UpdatePlanTemplateRequest) =>
    this.request<PlanTemplateDetail>('PATCH', `/api/v1/plan-templates/${templateId}`, body);
  archivePlanTemplate = (templateId: string, archived: boolean) =>
    this.request<PlanTemplateDetail>('POST', `/api/v1/plan-templates/${templateId}/archive`, { archived });
  planTemplateApplications = (planId: string) =>
    this.request<PlanTemplateApplicationRow[]>('GET', `/api/v1/plans/${planId}/template-applications`);
  previewApplyTemplate = (planId: string, body: PreviewTemplateApplyRequest) =>
    this.request<TemplateApplyPreviewResult>('POST', `/api/v1/plans/${planId}/apply-template/preview`, body);
  applyTemplate = (planId: string, body: ApplyTemplateRequest) =>
    this.request<TemplateApplyResult>('POST', `/api/v1/plans/${planId}/apply-template`, body);
  previewPlanGeneration = (body: PlanSeriesRequest) =>
    this.request<PlanGenerationPreview>('POST', '/api/v1/plans/generate/preview', body);
  generatePlans = (body: GeneratePlansRequest) =>
    this.request<PlanGenerationResult>('POST', '/api/v1/plans/generate', body);
  previewReschedule = (body: ReschedulePreviewRequest) =>
    this.request<ReschedulePreview>('POST', '/api/v1/plans/reschedule/preview', body);
  reschedulePlans = (body: RescheduleCommitRequest) =>
    this.request<RescheduleResult>('POST', '/api/v1/plans/reschedule', body);

  addPlanItem = (planId: string, body: Record<string, unknown>) =>
    this.request<PlanItemRow>('POST', `/api/v1/plans/${planId}/items`, body);
  /**
   * F11: edits an item in place. Pass `expected_revision` (the plan's
   * `content_revision`) so a competing edit is a 409 rather than overwritten.
   * The response is the saved row plus the plan's new revision.
   */
  updatePlanItem = (planId: string, itemId: string, body: UpdatePlanItemRequest) =>
    this.request<PlanItemRow & { content_revision: number }>('PATCH', `/api/v1/plans/${planId}/items/${itemId}`, body);
  deletePlanItem = (planId: string, itemId: string, expectedRevision?: number) =>
    this.request<void>(
      'DELETE',
      `/api/v1/plans/${planId}/items/${itemId}${expectedRevision === undefined ? '' : `?expected_revision=${expectedRevision}`}`,
    );
  /** Replaces the staffing need for every position sent; others are left alone. */
  setPlanPositionNeeds = (planId: string, body: SetPlanPositionNeedsInput) =>
    this.request<PlanPositionNeed[]>('PUT', `/api/v1/plans/${planId}/position-needs`, body);
  /** The full order in one transaction; with a revision, a stale order is a 409. */
  reorderPlanItems = (planId: string, itemIds: string[], expectedRevision?: number) =>
    this.request<PlanItemRow[]>('PUT', `/api/v1/plans/${planId}/items/order`, {
      item_ids: itemIds,
      ...(expectedRevision === undefined ? {} : { expected_revision: expectedRevision }),
    });
  /** F11: planned item times for one service time (derived, never stored). */
  planSchedule = (planId: string, timeId?: string) =>
    this.request<PlanScheduleResponse>(
      'GET',
      `/api/v1/plans/${planId}/schedule${timeId ? `?time_id=${encodeURIComponent(timeId)}` : ''}`,
    );

  // -------------------------------------------------------------- files --
  /** F13: the files one parent owns (readers see only what their audience allows). */
  files = (ownerKind: FileOwnerKind, ownerId: string) =>
    this.request<ParentFiles>('GET', '/api/v1/files', undefined, { owner_kind: ownerKind, owner_id: ownerId });
  /** Every file a plan uses: its own, its items', its songs'/arrangements' and linked defaults. */
  planFiles = (planId: string) => this.request<PlanFiles>('GET', `/api/v1/plans/${planId}/files`);
  file = (fileId: string) => this.request<FileDetail>('GET', `/api/v1/files/${fileId}`);
  /**
   * Step 1 of an upload (new file or replacement): returns one exact upload
   * target. PUT the bytes there, then `finalizeFile`. Retrying with the same
   * idempotency key returns the same intent.
   */
  createFileUploadIntent = (body: CreateFileUploadIntentRequest) =>
    this.request<FileUploadIntent>('POST', '/api/v1/files/upload-intents', body);
  /** Step 3: verifies the stored bytes; idempotent. Only `outcome: 'ready'` is a file version. */
  finalizeFile = (fileId: string, versionId: string) =>
    this.request<FileFinalizeResult>('POST', `/api/v1/files/${fileId}/finalize`, { version_id: versionId });
  /** Cancels an unfinished upload; a new file that never finished is removed. */
  abandonFileUpload = (fileId: string, versionId: string) =>
    this.request<{ file_removed: boolean }>('POST', `/api/v1/files/${fileId}/abandon`, { version_id: versionId });
  createFileLink = (body: CreateFileLinkRequest) => this.request<FileSummary>('POST', '/api/v1/files/links', body);
  updateFileLinkUrl = (fileId: string, body: UpdateFileLinkUrlInput) =>
    this.request<FileSummary>('PUT', `/api/v1/files/${fileId}/link`, body);
  createFileDocument = (body: CreateFileDocumentRequest) =>
    this.request<FileSummary>('POST', '/api/v1/files/documents', body);
  fileDocument = (fileId: string, versionId?: string) =>
    this.request<FileDocument>('GET', `/api/v1/files/${fileId}/document`, undefined, versionId ? { version_id: versionId } : undefined);
  /** Saves the text as a new version. */
  saveFileDocumentVersion = (fileId: string, body: SaveFileDocumentVersionInput) =>
    this.request<FileSummary>('PUT', `/api/v1/files/${fileId}/document`, body);
  updateFile = (fileId: string, body: UpdateFileRequest) => this.request<FileSummary>('PATCH', `/api/v1/files/${fileId}`, body);
  archiveFile = (fileId: string, body: ArchiveFileInput) =>
    this.request<FileSummary>('POST', `/api/v1/files/${fileId}/archive`, body);
  /** Permanent; refused (409 `file_in_use`) while any plan links the file. */
  deleteFile = (fileId: string, expectedRevision: number) =>
    this.request<void>('DELETE', `/api/v1/files/${fileId}`, { expected_revision: expectedRevision });
  /**
   * A short-lived link (rechecked against current access every time) or the
   * external address of a link file. Ask again when it expires.
   */
  fileDownload = (fileId: string, body: FileDownloadRequest = {}) =>
    this.request<FileDownload>('POST', `/api/v1/files/${fileId}/download`, body);
  linkFileToPlan = (planId: string, body: LinkFileToPlanRequest) =>
    this.request<FileLinkSummary>('POST', `/api/v1/plans/${planId}/file-links`, body);
  setFileLinkPin = (linkId: string, body: SetFileLinkPinInput) =>
    this.request<FileLinkSummary>('PATCH', `/api/v1/file-links/${linkId}`, body);
  /** Removes the plan reference only; the source file stays. */
  unlinkFile = (linkId: string) => this.request<void>('DELETE', `/api/v1/file-links/${linkId}`);
  /** F14: whether readers may save a copy of an upload (`stream_only` = play only). */
  setFilePlaybackRights = (fileId: string, body: SetFilePlaybackRightsInput) =>
    this.request<FileSummary>('PUT', `/api/v1/files/${fileId}/playback-rights`, body);

  // ---------------------------------------------------------- rehearsal --
  /**
   * F14: the plan's permitted materials in order, with charts in the service
   * key. Holds no file URLs: ask `fileDownload(file_id, { version_id })`
   * when playing. Re-read after `expires_at`.
   */
  rehearsalManifest = (planId: string) =>
    this.request<RehearsalManifest>('GET', `/api/v1/plans/${planId}/rehearsal-manifest`);
  /** F14 Pass C: downloadable entries with short-lived URLs for an explicit offline pack. */
  rehearsalOfflinePack = (planId: string, body: OfflinePackRequestInput = {}) =>
    this.request<OfflinePackPlan>('POST', `/api/v1/plans/${planId}/rehearsal-manifest/offline-pack`, body);

  // -------------------------------------------------------------- media --
  mediaList = (query: ListMediaRequest = {}) =>
    this.request<MediaList>('GET', '/api/v1/media', undefined, {
      ...(query.q ? { q: query.q } : {}),
      ...(query.include_archived ? { include_archived: 'true' } : {}),
    });
  media = (mediaId: string) => this.request<MediaDetail>('GET', `/api/v1/media/${mediaId}`);
  createMedia = (body: CreateMediaInput) => this.request<MediaDetail>('POST', '/api/v1/media', body);
  updateMedia = (mediaId: string, body: UpdateMediaInput) =>
    this.request<MediaDetail>('PATCH', `/api/v1/media/${mediaId}`, body);
  archiveMedia = (mediaId: string, body: ArchiveMediaInput) =>
    this.request<MediaSummary>('POST', `/api/v1/media/${mediaId}/archive`, body);
  deleteMedia = (mediaId: string, expectedRevision: number) =>
    this.request<void>('DELETE', `/api/v1/media/${mediaId}`, { expected_revision: expectedRevision });
  /** Links (or clears) a bundle on a regular order item, with the plan's revision. */
  setPlanItemMedia = (planId: string, itemId: string, body: SetPlanItemMediaInput) =>
    this.request<PlanItemSaveResult>('PUT', `/api/v1/plans/${planId}/items/${itemId}/media`, body);

  // ------------------------------------------------------- stage layouts --
  stageTemplates = () => this.request<StageLayoutTemplateList>('GET', '/api/v1/stage-templates');
  createStageTemplate = (body: CreateStageTemplateRequest) =>
    this.request<StageLayoutTemplateRow>('POST', '/api/v1/stage-templates', body);
  updateStageTemplate = (templateId: string, body: UpdateStageTemplateInput) =>
    this.request<StageLayoutTemplateRow>('PATCH', `/api/v1/stage-templates/${templateId}`, body);
  deleteStageTemplate = (templateId: string, expectedRevision: number) =>
    this.request<void>('DELETE', `/api/v1/stage-templates/${templateId}`, { expected_revision: expectedRevision });
  planStageLayouts = (planId: string) =>
    this.request<PlanStageLayouts>('GET', `/api/v1/plans/${planId}/stage-layouts`);
  createPlanStageLayout = (planId: string, body: CreatePlanStageLayoutInput) =>
    this.request<PlanStageLayoutView>('POST', `/api/v1/plans/${planId}/stage-layouts`, body);
  /** A 409 `layout_revision_stale` means someone else saved first: nothing was applied. */
  updatePlanStageLayout = (planId: string, layoutId: string, body: UpdatePlanStageLayoutInput) =>
    this.request<PlanStageLayoutView>('PATCH', `/api/v1/plans/${planId}/stage-layouts/${layoutId}`, body);
  deletePlanStageLayout = (planId: string, layoutId: string, expectedRevision: number) =>
    this.request<void>('DELETE', `/api/v1/plans/${planId}/stage-layouts/${layoutId}`, { expected_revision: expectedRevision });

  // --------------------------------------------------------------- live --
  /** F12: the plan's service times, each with its current run, and every run (newest first). */
  liveRuns = (planId: string) => this.request<LivePlanRuns>('GET', `/api/v1/plans/${planId}/runs`);
  /** Creates (or, with the same idempotency key, returns) the run of one service time; the caller holds control. */
  createLiveRun = (planId: string, body: CreateLiveRunRequest) =>
    this.request<LiveRunState>('POST', `/api/v1/plans/${planId}/runs`, body);
  /** Authoritative state plus the server clock; poll it and derive timers locally. */
  liveRunState = (runId: string) => this.request<LiveRunState>('GET', `/api/v1/runs/${runId}/state`);
  /**
   * One serialized command. A 409 (`run_revision_stale`, `run_control_lost`,
   * `run_control_held`, `run_state`) means nothing was applied: reload state.
   */
  liveRunAction = (runId: string, body: LiveRunActionInput) =>
    this.request<LiveRunState>('POST', `/api/v1/runs/${runId}/actions`, body);
  liveRunHistory = (runId: string) => this.request<LiveRunHistory>('GET', `/api/v1/runs/${runId}/history`);
  /** Appends an audited correction to one recorded time of an ended run. */
  correctLiveRunTime = (runId: string, body: CorrectLiveRunTimeInput) =>
    this.request<LiveRunHistory>('POST', `/api/v1/runs/${runId}/corrections`, body);

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

  // --------------------------------------- openings and replacements (F07) --
  listSignupOpportunities = (query?: { plan_id?: string }) =>
    this.request<SignupOpportunity[]>('GET', '/api/v1/opportunities', undefined, query);
  getSignupOpportunity = (id: string) => this.request<SignupOpportunity>('GET', `/api/v1/opportunities/${id}`);
  createSignupOpportunity = (planId: string, body: CreateSignupOpportunityInput) =>
    this.request<SignupOpportunityRow>('POST', `/api/v1/plans/${planId}/opportunities`, body);
  updateSignupOpportunity = (id: string, body: UpdateSignupOpportunityInput) =>
    this.request<SignupOpportunityRow>('PATCH', `/api/v1/opportunities/${id}`, body);
  claimSignupOpportunity = (id: string, body: ClaimSignupOpportunityInput) =>
    this.request<OpportunityClaimRow>('POST', `/api/v1/opportunities/${id}/claim`, body);
  decideSignupClaim = (id: string, body: DecideSignupClaimInput) =>
    this.request<OpportunityClaimRow>('POST', `/api/v1/opportunity-claims/${id}/decision`, body);
  cancelSignupClaim = (id: string, body: CancelSignupClaimInput) =>
    this.request<OpportunityClaimRow>('POST', `/api/v1/opportunity-claims/${id}/cancel`, body);
  listSignupClaims = (query?: { plan_id?: string }) =>
    this.request<OpportunityClaimDetail[]>('GET', '/api/v1/opportunity-claims', undefined, query);
  listReplacementRequests = () => this.request<ReplacementRequestDetail[]>('GET', '/api/v1/replacement-requests');
  createReplacementRequest = (body: CreateReplacementRequestInput) =>
    this.request<ReplacementRequestRow>('POST', '/api/v1/replacement-requests', body);
  cancelReplacementRequest = (id: string, body: CancelReplacementRequestInput) =>
    this.request<ReplacementRequestRow>('POST', `/api/v1/replacement-requests/${id}/cancel`, body);
  issueReplacementOffer = (id: string, body: IssueReplacementOfferInput) =>
    this.request<ReplacementOfferRow>('POST', `/api/v1/replacement-requests/${id}/offers`, body);
  actOnReplacementOffer = (id: string, body: ActOnReplacementOfferInput) =>
    this.request<ReplacementOfferRow>('POST', `/api/v1/replacement-offers/${id}/action`, body);
  listApprovedSwaps = () => this.request<ApprovedSwapRow[]>('GET', '/api/v1/approved-swaps');
  createApprovedSwap = (body: CreateApprovedSwapInput) =>
    this.request<ApprovedSwapRow>('POST', '/api/v1/approved-swaps', body);
  actOnApprovedSwap = (id: string, body: ActOnApprovedSwapInput) =>
    this.request<ApprovedSwapRow>('POST', `/api/v1/approved-swaps/${id}/action`, body);

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

  // ------------------------------------------------ staffing proposals --
  /** F06: capture a snapshot and run the deterministic engine. Creates no requests. */
  createStaffingProposal = (body: Partial<CreateStaffingProposalInput> & Pick<CreateStaffingProposalInput, 'plan_ids' | 'team_ids'>) =>
    this.request<StaffingProposal>('POST', '/api/v1/scheduling/proposals', body);
  staffingProposals = () => this.request<StaffingProposal[]>('GET', '/api/v1/scheduling/proposals');
  staffingProposal = (id: string) => this.request<StaffingProposal>('GET', `/api/v1/scheduling/proposals/${id}`);
  recomputeStaffingProposal = (id: string, body: RecomputeStaffingProposalInput) =>
    this.request<StaffingProposal>('POST', `/api/v1/scheduling/proposals/${id}/recompute`, body);
  refreshStaffingProposal = (id: string) =>
    this.request<StaffingProposal>('POST', `/api/v1/scheduling/proposals/${id}/refresh`, {});
  /** Creates the reviewed choices as prepared requests; release is a separate action. */
  commitStaffingProposal = (id: string, body: CommitStaffingProposalInput) =>
    this.request<StaffingProposalCommitResult>('POST', `/api/v1/scheduling/proposals/${id}/commit`, body);

  // ---------------------------------------------------------- rotations --
  rotations = (query: { team_id?: string; include_archived?: boolean } = {}) =>
    this.request<TeamRotation[]>('GET', `/api/v1/rotations${buildQuery({
      team_id: query.team_id, include_archived: query.include_archived ? 'true' : undefined,
    })}`);
  rotation = (id: string) => this.request<TeamRotation>('GET', `/api/v1/rotations/${id}`);
  createRotation = (body: CreateTeamRotationInput) => this.request<TeamRotation>('POST', '/api/v1/rotations', body);
  updateRotation = (id: string, body: UpdateTeamRotationInput) => this.request<TeamRotation>('PUT', `/api/v1/rotations/${id}`, body);
  archiveRotation = (id: string, expectedRevision: number) =>
    this.request<void>('POST', `/api/v1/rotations/${id}/archive`, { expected_revision: expectedRevision });
  previewRotation = (id: string, query: RotationPreviewQuery) =>
    this.request<RotationPreviewEntry[]>('GET', `/api/v1/rotations/${id}/preview${buildQuery(query)}`);

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

  // ---------------------------------------------- F08 release/reminders --
  /** Prepared requests on upcoming plans the caller may release. */
  listPreparedRequests = (query?: Partial<ListPreparedRequestsQuery>) =>
    this.request<PreparedRequestListItem[]>('GET', '/api/v1/releases/prepared', undefined, query as Query);
  /** Who will receive what (grouped per Person, then plan) and which channels will be skipped. */
  previewReleaseBatch = (body: ReleaseBatchPreviewInput) =>
    this.request<ReleaseBatchPreview>('POST', '/api/v1/releases/preview', body);
  /** Releases the reviewed set now, or schedules it when `scheduled_for` is in the future. */
  createReleaseBatch = (body: CreateReleaseBatchRequest) =>
    this.request<ReleaseBatchResult>('POST', '/api/v1/releases', body);
  listReleaseBatches = (query?: Partial<ListReleaseBatchesQuery>) =>
    this.request<ReleaseBatchSummary[]>('GET', '/api/v1/releases', undefined, query as Query);
  cancelReleaseBatch = (id: string) =>
    this.request<ReleaseBatchSummary>('POST', `/api/v1/releases/${id}/cancel`, {});
  /** Effective and explicit reminder policies at a scope (organization when both ids are omitted). */
  reminderPolicies = (query?: ReminderPolicyScopeQuery) =>
    this.request<ReminderPolicyScopeView>('GET', '/api/v1/reminder-policies', undefined, query as Query);
  saveReminderPolicy = (body: UpsertReminderPolicyRequest) =>
    this.request<ReminderPolicyRow>('PUT', '/api/v1/reminder-policies', body);
  /** Removes an override so the scope inherits again. */
  deleteReminderPolicy = (id: string) =>
    this.request<void>('DELETE', `/api/v1/reminder-policies/${id}`);
  myReminderPreferences = () =>
    this.request<ReminderPreferences>('GET', '/api/v1/reminder-policies/me');
  updateMyReminderPreferences = (body: UpdateReminderPreferencesInput) =>
    this.request<ReminderPreferences>('PUT', '/api/v1/reminder-policies/me', body);
  /** Scheduled reminders and per-Person/channel delivery history for one plan. */
  planDeliveryHistory = (planId: string) =>
    this.request<PlanDeliveryHistory>('GET', `/api/v1/plans/${planId}/deliveries`);
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

  // ------------------------------------------- F09 notes and discussion --
  /** Notes on a plan and its items the caller may read, plus offered categories. */
  planNotes = (planId: string) =>
    this.request<PlanNotesResponse>('GET', `/api/v1/plans/${planId}/notes`);
  createPlanNote = (planId: string, body: SavePlanNoteInput) =>
    this.request<PlanNote>('POST', `/api/v1/plans/${planId}/notes`, body);
  /** `expected_revision` is required; a stale editor gets 409 `note_stale`. */
  updatePlanNote = (planId: string, noteId: string, body: SavePlanNoteInput) =>
    this.request<PlanNote>('PUT', `/api/v1/plans/${planId}/notes/${noteId}`, body);
  deletePlanNote = (planId: string, noteId: string, expectedRevision: number) =>
    this.request<void>('DELETE', `/api/v1/plans/${planId}/notes/${noteId}`, undefined, { expected_revision: expectedRevision });
  noteCategories = (query?: { service_type_id?: string }) =>
    this.request<NoteCategoryRow[]>('GET', '/api/v1/note-categories', undefined, query);
  createNoteCategory = (body: Partial<CreateNoteCategoryInput> & { name: string }) =>
    this.request<NoteCategoryRow>('POST', '/api/v1/note-categories', body);
  updateNoteCategory = (id: string, body: UpdateNoteCategoryInput) =>
    this.request<NoteCategoryRow>('PATCH', `/api/v1/note-categories/${id}`, body);

  /** Current participants of an item thread (plan) or a conversation. */
  mentionCandidates = (query: { plan_id: string } | { conversation_id: string }) =>
    this.request<MentionCandidate[]>('GET', '/api/v1/mention-candidates', undefined, query);
  itemComments = (itemId: string, query?: Partial<DiscussionPageQuery>) =>
    this.request<PlanItemThread>('GET', `/api/v1/plan-items/${itemId}/comments`, undefined, query as Query);
  /** Reuse the same `id` when retrying; the server returns the stored comment. */
  postItemComment = (itemId: string, body: Partial<PostItemCommentInput> & { id: string; body: string }) =>
    this.request<PostDiscussionResult<PlanItemComment>>('POST', `/api/v1/plan-items/${itemId}/comments`, body);
  editItemComment = (itemId: string, commentId: string, body: { body: string }) =>
    this.request<PlanItemComment>('PATCH', `/api/v1/plan-items/${itemId}/comments/${commentId}`, body);
  deleteItemComment = (itemId: string, commentId: string, body: { reason?: string } = {}) =>
    this.request<PlanItemComment>('DELETE', `/api/v1/plan-items/${itemId}/comments/${commentId}`, body);

  // ------------------------------------------------ F09 targeted messages --
  /** Resolves the audience; sends nothing. */
  previewMessage = (body: PreviewOperationalMessageInput) =>
    this.request<MessageAudiencePreview>('POST', '/api/v1/messages/preview', body);
  sendMessage = (body: SendOperationalMessageInput) =>
    this.request<SendOperationalMessageResult>('POST', '/api/v1/messages', body);
  listMessages = (query?: Partial<ListOperationalMessagesQuery>) =>
    this.request<OperationalMessageSummary[]>('GET', '/api/v1/messages', undefined, query as Query);
  getMessage = (id: string) =>
    this.request<OperationalMessageDetail>('GET', `/api/v1/messages/${id}`);
  /** Re-queues only failed or uncertain deliveries. */
  retryMessage = (id: string, body: RetryOperationalMessageInput = {}) =>
    this.request<{ requeued: number }>('POST', `/api/v1/messages/${id}/retry`, body);
  messageTemplates = () => this.request<MessageTemplateList>('GET', '/api/v1/message-templates');
  createMessageTemplate = (body: SaveMessageTemplateInput) =>
    this.request<MessageTemplateRow>('POST', '/api/v1/message-templates', body);
  updateMessageTemplate = (id: string, body: SaveMessageTemplateInput) =>
    this.request<MessageTemplateRow>('PUT', `/api/v1/message-templates/${id}`, body);
  archiveMessageTemplate = (id: string) =>
    this.request<void>('DELETE', `/api/v1/message-templates/${id}`);

  // --------------------------------------------------- F09 conversations --
  conversations = () => this.request<ConversationSummary[]>('GET', '/api/v1/conversations');
  /** Opens (creating on first use) the conversation for a team or plan. */
  openConversation = (body: OpenConversationInput) =>
    this.request<ConversationSummary>('POST', '/api/v1/conversations/open', body);
  getConversation = (id: string) =>
    this.request<ConversationDetail>('GET', `/api/v1/conversations/${id}`);
  conversationMessages = (id: string, query?: Partial<ConversationMessagesQuery>) =>
    this.request<DiscussionPage<ConversationMessage>>('GET', `/api/v1/conversations/${id}/messages`, undefined, query as Query);
  /** Reuse the same `id` when retrying; the server returns the stored message. */
  postConversationMessage = (id: string, body: Partial<PostConversationMessageInput> & { id: string; body: string }) =>
    this.request<PostDiscussionResult<ConversationMessage>>('POST', `/api/v1/conversations/${id}/messages`, body);
  editConversationMessage = (id: string, messageId: string, body: { body: string }) =>
    this.request<ConversationMessage>('PATCH', `/api/v1/conversations/${id}/messages/${messageId}`, body);
  deleteConversationMessage = (id: string, messageId: string) =>
    this.request<ConversationMessage>('DELETE', `/api/v1/conversations/${id}/messages/${messageId}`);
  markConversationRead = (id: string, readAt: string) =>
    this.request<{ last_read_at: string | null }>('POST', `/api/v1/conversations/${id}/read`, { read_at: readAt });
  muteConversation = (id: string, muted: boolean) =>
    this.request<{ muted: boolean }>('PUT', `/api/v1/conversations/${id}/mute`, { muted });
  reportConversationMessage = (id: string, messageId: string, body: ReportConversationMessageInput) =>
    this.request<ConversationReport>('POST', `/api/v1/conversations/${id}/messages/${messageId}/report`, body);
  resolveConversationReport = (id: string, reportId: string, body: ResolveConversationReportInput) =>
    this.request<ConversationReport>('POST', `/api/v1/conversations/${id}/reports/${reportId}/resolve`, body);
  restoreConversationMessage = (id: string, messageId: string) =>
    this.request<ConversationMessage>('POST', `/api/v1/conversations/${id}/messages/${messageId}/restore`, {});

  health = () => this.request<{ status: string; version: string }>('GET', '/health');
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};
