import { ApiError } from '@service-center/shared';

export type AssignmentResponseFailure = 'invalid' | 'expired' | 'used' | 'network';

export const assignmentResponseFailure = (error: unknown): AssignmentResponseFailure => {
  if (error instanceof ApiError) {
    if (error.code === 'assignment_notification_expired') return 'expired';
    if (error.code === 'assignment_notification_used') return 'used';
    if (error.status === 404) return 'invalid';
  }
  return 'network';
};
