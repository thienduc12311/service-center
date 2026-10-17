import { ApiError } from '@service-center/shared';

export type AssignmentResponseFailure = 'invalid' | 'expired' | 'used' | 'stale' | 'network';

export const assignmentResponseFailure = (error: unknown): AssignmentResponseFailure => {
  if (error instanceof ApiError) {
    if (error.code === 'assignment_notification_expired') return 'expired';
    if (error.code === 'assignment_notification_used') return 'used';
    if (error.code === 'assignment_request_stale' || error.status === 409) return 'stale';
    if (error.status === 404) return 'invalid';
  }
  return 'network';
};
