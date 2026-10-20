import { z } from 'zod';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../i18n/locales.js';

/**
 * A persisted language choice: a canonical supported code, or null for
 * "Automatic". Regional tags such as `vi-VN` are rejected — clients normalize
 * detected languages but only ever send canonical codes.
 */
export const preferredLanguageSchema = z
  .enum(SUPPORTED_LOCALES as [SupportedLocale, ...SupportedLocale[]], {
    errorMap: () => ({ message: 'Unsupported language' }),
  })
  .nullable();

/** PATCH /api/v1/me/language-preference — exactly this field, nothing else. */
export const updateLanguagePreferenceSchema = z
  .object({ preferred_language: preferredLanguageSchema })
  .strict();

export type PreferredLanguage = z.infer<typeof preferredLanguageSchema>;
export type UpdateLanguagePreferenceInput = z.infer<typeof updateLanguagePreferenceSchema>;

/** The caller's own saved language in the active church. */
export interface LanguagePreferenceResponse {
  /** Null means Automatic. A newer client may have saved a code this build does not support. */
  preferred_language: PreferredLanguage;
  /** False when this login has no Person in the active church (legacy member). */
  person_linked: boolean;
}

/** Stable error code for a self-service write when no Person is linked. */
export const PERSON_LINK_REQUIRED = 'PERSON_LINK_REQUIRED';
