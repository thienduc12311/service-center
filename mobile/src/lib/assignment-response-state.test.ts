import { describe, expect, it } from 'vitest';
import { ApiError } from '@service-center/shared';
import { assignmentResponseFailure } from './assignment-response-state';

describe('assignmentResponseFailure', () => {
  it('separates invalid, expired, used and network failures', () => {
    expect(assignmentResponseFailure(new ApiError(404, 'missing'))).toBe('invalid');
    expect(
      assignmentResponseFailure(
        new ApiError(410, 'expired', 'assignment_notification_expired'),
      ),
    ).toBe('expired');
    expect(
      assignmentResponseFailure(new ApiError(410, 'used', 'assignment_notification_used')),
    ).toBe('used');
    expect(assignmentResponseFailure(new TypeError('offline'))).toBe('network');
  });
});
