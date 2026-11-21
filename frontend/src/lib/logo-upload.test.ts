import { LocalizedError } from '@service-center/shared';
import { describe, expect, it } from 'vitest';
import { LOGO_FILE_ACCEPT, mapLogoUploadError, validateLogoFile } from './logo-upload';

describe('logo upload validation', () => {
  it('accepts raster types and refuses SVG', () => {
    expect(validateLogoFile({ type: 'image/png' })).toBeNull();
    expect(validateLogoFile({ type: 'image/webp' })).toBeNull();
    const refused = validateLogoFile({ type: 'image/svg+xml' });
    expect(refused).toBeInstanceOf(LocalizedError);
    expect(refused?.translatable.key).toBe('errors:codes.logo_type_unsupported');
    expect(validateLogoFile({ type: '' })).not.toBeNull();
  });

  it('keeps the picker filter in sync', () => {
    expect(LOGO_FILE_ACCEPT).toBe('image/png,image/jpeg,image/webp,image/gif');
  });

  it('maps a Storage MIME rejection to the same message', () => {
    const mapped = mapLogoUploadError({ message: 'mime type image/svg+xml is not supported', statusCode: '415' });
    expect(mapped).toBeInstanceOf(LocalizedError);
    const other = new Error('boom');
    expect(mapLogoUploadError(other)).toBe(other);
  });
});
