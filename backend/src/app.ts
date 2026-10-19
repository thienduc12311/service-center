import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { redactTokenPath } from './lib/redact.js';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { withOrganization } from './middleware/organization.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

import { meRouter } from './routes/me.js';
import { organizationsRouter } from './routes/organizations.js';
import { peopleRouter } from './routes/people.js';
import { rosterRouter, searchRouter } from './routes/roster.js';
import { invitationAcceptRouter } from './routes/invitation-accept.js';
import { assignmentRespondRouter } from './routes/assignment-respond.js';
import { calendarFeedRouter } from './routes/calendar-feed.js';
import { serviceTypesRouter } from './routes/service-types.js';
import { teamsRouter } from './routes/teams.js';
import { songsRouter, arrangementsRouter } from './routes/songs.js';
import { plansRouter } from './routes/plans.js';
import {
  assignmentsRouter,
  planAssignmentTimesRouter,
  planAssignmentsRouter,
  planNotifyRouter,
  planReleaseRouter,
  scheduleRouter,
  schedulingRouter,
} from './routes/assignments.js';
import { calendarRouter } from './routes/calendar.js';
import { deliveriesRouter, deliveryWorkerRouter } from './routes/deliveries.js';
import { planDeliveriesRouter, releasesRouter, reminderPoliciesRouter } from './routes/releases.js';
import { blockoutsRouter } from './routes/blockouts.js';
import { availabilityRouter } from './routes/availability.js';
import { delegationsRouter } from './routes/delegations.js';
import { meAvailabilityRouter } from './routes/me-availability.js';
import { accessRouter } from './routes/access.js';
import { foldersRouter } from './routes/folders.js';
import { staffingMatrixRouter } from './routes/staffing-matrix.js';
import { rotationsRouter, staffingProposalsRouter } from './routes/staffing-proposals.js';
import { songbooksRouter } from './routes/songbooks.js';
import {
  conversationsRouter,
  mentionCandidatesRouter,
  messagesRouter,
  messageTemplatesRouter,
  noteCategoriesRouter,
  planItemCommentsRouter,
  planNotesRouter,
} from './routes/collaboration.js';
import { planTemplateUseRouter, planTemplatesRouter } from './routes/plan-templates.js';
import { liveRunsRouter, planLiveRunsRouter } from './routes/live-runs.js';
import { fileLinksRouter, filesRouter, planFilesRouter } from './routes/files.js';
import { mediaRouter, planRehearsalRouter, stageTemplatesRouter } from './routes/rehearsal.js';
import { planAttendanceRouter } from './routes/attendance.js';
import { reportsRouter } from './routes/reports.js';
import {
  personCalendarSharingRouter,
  planPublicationRouter,
  publicRouter,
  servicePublicLinksRouter,
} from './routes/publication.js';
import {
  deviceRevocationsRouter,
  devicesRouter,
  notificationsRouter,
} from './routes/notifications.js';
import {
  approvedSwapsRouter,
  opportunitiesRouter,
  opportunityClaimsRouter,
  planOpportunitiesRouter,
  replacementOffersRouter,
  replacementRequestsRouter,
} from './routes/opportunities.js';

/** Preview deployments are `<project>-<hash>-<team>.vercel.app`. */
const VERCEL_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

export const createApp = (): Express => {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(compression());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Native apps and server-to-server calls send no Origin header.
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        if (config.CORS_ALLOW_VERCEL_PREVIEWS && VERCEL_PREVIEW_ORIGIN.test(origin)) {
          return callback(null, true);
        }
        callback(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  if (!config.isTest) {
    // Bearer-token paths (response links, invitations, feeds) are logged by shape only.
    morgan.token<express.Request>('url', (req) => redactTokenPath(req.originalUrl ?? req.url ?? ''));
    app.use(morgan(config.isProduction ? 'combined' : 'dev'));
  }

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.isProduction ? 300 : 10_000,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: config.version });
  });

  // /me and /organizations work before an organization is chosen; every other
  // route resolves and authorises one first.
  // Devices are per-person, not per-organization, so they sit beside /me.
  app.use('/api/v1/me/devices', requireAuth, devicesRouter);
  app.use('/api/v1/device-revocations', deviceRevocationsRouter);
  app.use('/api/v1/me', requireAuth, meAvailabilityRouter, meRouter);
  app.use('/api/v1/organizations', requireAuth, organizationsRouter);
  // Fully public: the caller isn't signed in yet — a valid token is the
  // entire authorisation for this route (see invitation-accept.ts).
  app.use('/api/v1/invitations', invitationAcceptRouter);
  app.use('/api/v1/assignment-responses', assignmentRespondRouter);
  app.use('/api/v1/calendar-feed', calendarFeedRouter);
  // F16: anonymous, allowlisted public projections only.
  app.use('/api/v1/public', publicRouter);
  app.use('/api/v1/internal/deliveries', deliveryWorkerRouter);

  const scoped = [requireAuth, withOrganization];
  // Roster maintenance first: its fixed paths must not be read as a person id.
  app.use('/api/v1/people/:personId/calendar-sharing', scoped, personCalendarSharingRouter);
  app.use('/api/v1/people', scoped, rosterRouter, peopleRouter);
  app.use('/api/v1/search', scoped, searchRouter);
  app.use('/api/v1/service-types/:serviceTypeId/public-links', scoped, servicePublicLinksRouter);
  app.use('/api/v1/service-types', scoped, serviceTypesRouter);
  app.use('/api/v1/teams', scoped, teamsRouter);
  app.use('/api/v1/songs', scoped, songsRouter);
  app.use('/api/v1/arrangements', scoped, arrangementsRouter);
  app.use('/api/v1/plans/:planId/assignments', scoped, planAssignmentsRouter);
  app.use('/api/v1/plans/:planId/assignment-times', scoped, planAssignmentTimesRouter);
  app.use('/api/v1/plans/:planId/notify', scoped, planNotifyRouter);
  app.use('/api/v1/plans/:planId/release', scoped, planReleaseRouter);
  app.use('/api/v1/plans/:planId/deliveries', scoped, planDeliveriesRouter);
  app.use('/api/v1/plans/:planId/opportunities', scoped, planOpportunitiesRouter);
  app.use('/api/v1/plans/:planId/notes', scoped, planNotesRouter);
  app.use('/api/v1/plans/:planId/runs', scoped, planLiveRunsRouter);
  app.use('/api/v1/plans/:planId/attendance', scoped, planAttendanceRouter);
  app.use('/api/v1/plans/:planId/publication', scoped, planPublicationRouter);
  app.use('/api/v1/plans/:planId', scoped, planFilesRouter, planRehearsalRouter);
  app.use('/api/v1/plans', scoped, planTemplateUseRouter, plansRouter);
  app.use('/api/v1/plan-templates', scoped, planTemplatesRouter);
  app.use('/api/v1/runs', scoped, liveRunsRouter);
  app.use('/api/v1/files', scoped, filesRouter);
  app.use('/api/v1/file-links', scoped, fileLinksRouter);
  app.use('/api/v1/media', scoped, mediaRouter);
  app.use('/api/v1/stage-templates', scoped, stageTemplatesRouter);
  app.use('/api/v1/plan-items', scoped, planItemCommentsRouter);
  app.use('/api/v1/note-categories', scoped, noteCategoriesRouter);
  app.use('/api/v1/mention-candidates', scoped, mentionCandidatesRouter);
  app.use('/api/v1/messages', scoped, messagesRouter);
  app.use('/api/v1/message-templates', scoped, messageTemplatesRouter);
  app.use('/api/v1/conversations', scoped, conversationsRouter);
  app.use('/api/v1/opportunities', scoped, opportunitiesRouter);
  app.use('/api/v1/opportunity-claims', scoped, opportunityClaimsRouter);
  app.use('/api/v1/replacement-requests', scoped, replacementRequestsRouter);
  app.use('/api/v1/replacement-offers', scoped, replacementOffersRouter);
  app.use('/api/v1/approved-swaps', scoped, approvedSwapsRouter);
  app.use('/api/v1/assignments', scoped, assignmentsRouter);
  app.use('/api/v1/schedule', scoped, scheduleRouter);
  app.use('/api/v1/scheduling/proposals', scoped, staffingProposalsRouter);
  app.use('/api/v1/scheduling', scoped, schedulingRouter);
  app.use('/api/v1/calendar', scoped, calendarRouter);
  app.use('/api/v1/reports', scoped, reportsRouter);
  app.use('/api/v1/blockouts', scoped, blockoutsRouter);
  app.use('/api/v1/availability', scoped, availabilityRouter);
  app.use('/api/v1/delegations', scoped, delegationsRouter);
  app.use('/api/v1/songbooks', scoped, songbooksRouter);
  app.use('/api/v1/notifications', scoped, notificationsRouter);
  app.use('/api/v1/deliveries', scoped, deliveriesRouter);
  app.use('/api/v1/releases', scoped, releasesRouter);
  app.use('/api/v1/reminder-policies', scoped, reminderPoliciesRouter);
  app.use('/api/v1/access', scoped, accessRouter);
  app.use('/api/v1/folders', scoped, foldersRouter);
  app.use('/api/v1/staffing-matrix', scoped, staffingMatrixRouter);
  app.use('/api/v1/rotations', scoped, rotationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
