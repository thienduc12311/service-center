import { Router, type Request } from 'express';
import {
  attendanceHistoryQuerySchema,
  attendanceSheetQuerySchema,
  recordAttendanceSchema,
  type AttendanceHistoryQuery,
  type AttendanceSheetQuery,
  type RecordAttendanceInput,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import {
  getAttendanceHistory,
  getAttendanceSheet,
  recordAttendance,
  type AttendanceCaller,
} from '../services/attendance-records.js';

/**
 * F16 actual attendance. Team schedulers mark the people on their teams; the
 * database (`record_attendance`, RLS) decides every write and read. The
 * capability gate only gives members a clear early 403.
 */
const caller = (req: Request): AttendanceCaller => ({ db: req.db, orgId: req.orgId, access: req.access });

export const planAttendanceRouter: Router = Router({ mergeParams: true });

planAttendanceRouter.use(requireCapability('scheduling.manage'));

planAttendanceRouter.get('/', validateQuery(attendanceSheetQuerySchema), async (req, res) => {
  const { plan_time_id } = parsedQuery<AttendanceSheetQuery>(res);
  res.set('Cache-Control', 'no-store');
  res.json(await getAttendanceSheet(caller(req), param(req, 'planId'), plan_time_id));
});

planAttendanceRouter.post('/', validateBody(recordAttendanceSchema), async (req, res) => {
  res.json(await recordAttendance(caller(req), param(req, 'planId'), req.body as RecordAttendanceInput));
});

planAttendanceRouter.get('/history', validateQuery(attendanceHistoryQuerySchema), async (req, res) => {
  const { plan_time_id, person_id } = parsedQuery<AttendanceHistoryQuery>(res);
  res.json(await getAttendanceHistory(caller(req), param(req, 'planId'), plan_time_id, person_id));
});
