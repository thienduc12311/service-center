import { Router, type Request, type Response } from 'express';
import {
  reportFilename,
  reportQuerySchema,
  reportToCsv,
  requestReportExportSchema,
  type ReportKind,
  type ReportQueryInput,
  type RequestReportExportInput,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { buildReport, type ReportContext } from '../services/reports.js';
import {
  listReportExports,
  reportExportDownload,
  requestReportExport,
  retryReportExport,
} from '../services/report-exports.js';

/**
 * F16 operational reports. Each report reads only what the caller's access
 * covers (the builders' scope filters plus RLS) and every format — JSON for
 * screen/print, CSV — comes from the same built report.
 */
const context = (req: Request): ReportContext => ({ db: req.db, orgId: req.orgId, access: req.access, serviceRole: false });

export const reportsRouter: Router = Router();

const send = (kind: ReportKind) => async (req: Request, res: Response) => {
  const { format, ...filters } = parsedQuery<ReportQueryInput>(res);
  const report = await buildReport(context(req), kind, filters);
  res.set('Cache-Control', 'no-store');
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${reportFilename(kind, report.filters)}"`);
    res.send(reportToCsv(report));
    return;
  }
  res.json(report);
};

reportsRouter.get('/staffing', validateQuery(reportQuerySchema), send('staffing'));
reportsRouter.get('/participation', validateQuery(reportQuerySchema), send('participation'));
reportsRouter.get('/song-usage', validateQuery(reportQuerySchema), send('song_usage'));
reportsRouter.get('/run-times', validateQuery(reportQuerySchema), send('run_times'));
reportsRouter.get('/schedule', validateQuery(reportQuerySchema), send('schedule'));

reportsRouter.get('/exports', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await listReportExports({ db: req.db, orgId: req.orgId }));
});

reportsRouter.post('/exports', validateBody(requestReportExportSchema), async (req, res) => {
  res.status(202).json(await requestReportExport({ db: req.db, orgId: req.orgId }, req.body as RequestReportExportInput));
});

reportsRouter.post('/exports/:id/retry', async (req, res) => {
  res.status(202).json(await retryReportExport({ db: req.db, orgId: req.orgId }, param(req, 'id')));
});

reportsRouter.post('/exports/:id/download', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await reportExportDownload({ db: req.db, orgId: req.orgId }, param(req, 'id')));
});
