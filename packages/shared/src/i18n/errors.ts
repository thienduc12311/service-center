/**
 * Turns any thrown value into localized, user-safe text. Machine error codes
 * stay stable in the API; clients map them here. Unknown errors become a
 * localized generic message — raw database or provider text is never shown.
 */

import { ApiError } from '../lib/api-client.js';
import { FALLBACK_LOCALE, type SupportedLocale } from './locales.js';
import { englishResources } from './resources.js';
import type { TranslatableMessage, TranslationKey } from './types.js';

/** What to show for an error: a catalog message, or server text already written for people. */
export type ErrorPresentation =
  | { kind: 'message'; message: TranslatableMessage }
  | { kind: 'text'; text: string };

type ErrorCodeKey = keyof typeof englishResources.errors.codes;

const isKnownCode = (code: string | undefined): code is ErrorCodeKey =>
  typeof code === 'string' && Object.prototype.hasOwnProperty.call(englishResources.errors.codes, code);

const generic = (key: TranslationKey<'errors'>): ErrorPresentation => ({ kind: 'message', message: { key: `errors:${key}` } });

const isNetworkFailure = (error: unknown): boolean =>
  error instanceof TypeError && /fetch|network|load failed/i.test(error.message);

/** An error whose message is already a catalog key (see `LocalizedError`). */
export class LocalizedError extends Error {
  constructor(readonly translatable: TranslatableMessage) {
    super(translatable.key);
    this.name = 'LocalizedError';
  }
}

/**
 * How to present `error` in `locale`.
 *
 * - A stable API code with a catalog entry → that translation.
 * - A 4xx without a mapped code → the server's own sentence while the UI is
 *   English (those messages are written for people), otherwise a localized
 *   message for the status.
 * - 5xx, network and unexpected errors → a localized generic message.
 */
export const presentError = (error: unknown, locale: SupportedLocale): ErrorPresentation => {
  if (error instanceof LocalizedError) return { kind: 'message', message: error.translatable };
  if (error instanceof ApiError) {
    if (isKnownCode(error.code)) return { kind: 'message', message: { key: `errors:codes.${error.code}` } };
    if (error.status >= 500) return generic('generic.server');
    if (locale === FALLBACK_LOCALE && error.message && error.status !== 401) return { kind: 'text', text: error.message };
    switch (error.status) {
      case 401:
        return generic('generic.unauthorized');
      case 403:
        return generic('generic.forbidden');
      case 404:
        return generic('generic.notFound');
      case 409:
        return generic('generic.conflict');
      case 410:
        return generic('generic.gone');
      case 429:
        return generic('generic.rateLimited');
      case 400:
      case 422:
        return generic('generic.invalid');
      default:
        return generic('generic.unexpected');
    }
  }
  if (isNetworkFailure(error)) return generic('generic.network');
  return generic('generic.unexpected');
};
