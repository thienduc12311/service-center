import { describe, expect, it } from 'vitest';
import { CHURCH_APPLICATION_REQUIRED, STORAGE_QUOTA_EXCEEDED } from '@service-center/shared';
import { fromPostgrestError } from './errors.js';

/** Super-admin dashboard errors raised by migration 20261116000100. */
describe('fromPostgrestError: platform controls', () => {
  it('maps an exhausted storage quota to 413 storage_quota_exceeded', () => {
    const error = fromPostgrestError({ code: 'PT413', message: 'Your church is out of storage space.', hint: 'storage_quota_exceeded' });
    expect(error).toMatchObject({ status: 413, code: STORAGE_QUOTA_EXCEEDED, message: 'Your church is out of storage space.' });
  });

  it('tells a person to apply when self-serve creation is off', () => {
    const error = fromPostgrestError({ code: '42501', message: 'New churches need an approved application', hint: 'church_application_required' });
    expect(error).toMatchObject({ status: 403, code: CHURCH_APPLICATION_REQUIRED });
  });

  it('keeps other permission errors generic', () => {
    expect(fromPostgrestError({ code: '42501', message: 'permission denied for table x' })).toMatchObject({
      status: 403,
      code: 'forbidden',
      message: 'You do not have access to do that',
    });
  });

  it('maps a decided application to 409 application_not_pending', () => {
    const error = fromPostgrestError({ code: 'PT409', message: 'already decided', hint: 'application_not_pending' });
    expect(error).toMatchObject({ status: 409, code: 'application_not_pending' });
  });
});
