import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { withOrganization } from './middleware/organization.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

import { meRouter } from './routes/me.js';
import { organizationsRouter } from './routes/organizations.js';
import { peopleRouter } from './routes/people.js';
import { invitationAcceptRouter } from './routes/invitation-accept.js';
import { serviceTypesRouter } from './routes/service-types.js';
import { teamsRouter } from './routes/teams.js';
import { songsRouter, arrangementsRouter } from './routes/songs.js';
import { plansRouter } from './routes/plans.js';
import {
  assignmentsRouter,
  planAssignmentsRouter,
  planNotifyRouter,
  scheduleRouter,
  schedulingRouter,
} from './routes/assignments.js';
import { calendarRouter } from './routes/calendar.js';
import { blockoutsRouter } from './routes/blockouts.js';
import { importsRouter } from './routes/imports.js';
import { songbooksRouter } from './routes/songbooks.js';

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
        callback(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  if (!config.isTest) app.use(morgan(config.isProduction ? 'combined' : 'dev'));

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
  app.use('/api/v1/me', requireAuth, meRouter);
  app.use('/api/v1/organizations', requireAuth, organizationsRouter);
  // Fully public: the caller isn't signed in yet — a valid token is the
  // entire authorisation for this route (see invitation-accept.ts).
  app.use('/api/v1/invitations', invitationAcceptRouter);

  const scoped = [requireAuth, withOrganization];
  app.use('/api/v1/people', scoped, peopleRouter);
  app.use('/api/v1/service-types', scoped, serviceTypesRouter);
  app.use('/api/v1/teams', scoped, teamsRouter);
  app.use('/api/v1/songs', scoped, songsRouter);
  app.use('/api/v1/arrangements', scoped, arrangementsRouter);
  app.use('/api/v1/plans/:planId/assignments', scoped, planAssignmentsRouter);
  app.use('/api/v1/plans/:planId/notify', scoped, planNotifyRouter);
  app.use('/api/v1/plans', scoped, plansRouter);
  app.use('/api/v1/assignments', scoped, assignmentsRouter);
  app.use('/api/v1/schedule', scoped, scheduleRouter);
  app.use('/api/v1/scheduling', scoped, schedulingRouter);
  app.use('/api/v1/calendar', scoped, calendarRouter);
  app.use('/api/v1/blockouts', scoped, blockoutsRouter);
  app.use('/api/v1/imports', scoped, importsRouter);
  app.use('/api/v1/songbooks', scoped, songbooksRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
