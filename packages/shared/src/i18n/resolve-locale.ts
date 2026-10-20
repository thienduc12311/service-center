import { localeRegistry, type LocaleRegistry, type SupportedLocale } from './locales.js';

/** Where the displayed language came from, for diagnostics and the selector hint. */
export type LocaleSource =
  /** The member's explicit choice saved on their Person in this church. */
  | 'saved'
  /** Reserved: a church-wide default (future; never set in this release). */
  | 'organization'
  /** The recipient's saved choice on a verified token page (respond, accept invite). */
  | 'recipient'
  /** An explicit choice made on this device while signed out. */
  | 'anonymous'
  /** The first supported browser/device language. */
  | 'device'
  /** Nothing matched, or the saved code is one this client does not know. */
  | 'fallback';

/**
 * Inputs to language resolution. Raw values are `unknown`-safe: a saved code
 * written by a newer client that this build does not support is ignored for
 * display (English is shown) but never rewritten.
 */
export interface LocaleResolutionInput {
  /**
   * True once a signed-in member has an active church. Only then does the
   * saved preference apply, and the anonymous device choice is ignored.
   */
  member: boolean;
  /** The Person's saved preference for that church; null means Automatic. */
  saved?: string | null;
  /** Future church default; not populated in this release. */
  organizationDefault?: string | null;
  /**
   * Signed out only: the token recipient's saved preference, used after the
   * page's token was verified. A language toggle on that page replaces it.
   */
  recipient?: string | null;
  /** The explicit signed-out choice on this device (separate from any member). */
  anonymous?: string | null;
  /** Browser/device languages, most preferred first (`navigator.languages`, `getLocales()`). */
  detected?: readonly string[];
}

export interface LocaleResolution<Code extends string = SupportedLocale> {
  locale: Code;
  source: LocaleSource;
  /** Set when a saved value is not supported by this client; it is preserved, not overwritten. */
  unsupportedSaved: string | null;
}

/** First supported language in an ordered device list (`vi-VN` → `vi`). */
export const detectSupportedLocale = <Code extends string>(
  detected: readonly string[] | undefined,
  registry: LocaleRegistry<Code>,
): Code | null => {
  for (const tag of detected ?? []) {
    const code = registry.normalize(tag);
    if (code) return code;
  }
  return null;
};

/**
 * Pure language precedence.
 *
 * Member with an active church: saved preference → (future church default) →
 * device language → English. Signed out or before a church: verified token
 * recipient's preference (token pages only) → anonymous device choice →
 * device language → English.
 */
export function resolveLocale(input: LocaleResolutionInput): LocaleResolution<SupportedLocale>;
export function resolveLocale<Code extends string>(input: LocaleResolutionInput, registry: LocaleRegistry<Code>): LocaleResolution<Code>;
export function resolveLocale<Code extends string>(
  input: LocaleResolutionInput,
  registry: LocaleRegistry<Code> = localeRegistry as unknown as LocaleRegistry<Code>,
): LocaleResolution<Code> {
  let unsupportedSaved: string | null = null;

  if (input.member) {
    if (typeof input.saved === 'string' && input.saved !== '') {
      // Saved values are canonical codes, so they are matched exactly.
      if (registry.isSupported(input.saved)) return { locale: input.saved, source: 'saved', unsupportedSaved };
      unsupportedSaved = input.saved;
      // An older client meeting a newer language shows English without
      // overwriting the saved value (device language would misrepresent it).
      return { locale: registry.fallback, source: 'fallback', unsupportedSaved };
    }
    const organizationDefault = registry.normalize(input.organizationDefault);
    if (organizationDefault) return { locale: organizationDefault, source: 'organization', unsupportedSaved };
  } else {
    if (registry.isSupported(input.recipient)) return { locale: input.recipient, source: 'recipient', unsupportedSaved };
    const anonymous = registry.normalize(input.anonymous);
    if (anonymous) return { locale: anonymous, source: 'anonymous', unsupportedSaved };
  }

  const device = detectSupportedLocale(input.detected, registry);
  if (device) return { locale: device, source: 'device', unsupportedSaved };
  return { locale: registry.fallback, source: 'fallback', unsupportedSaved };
}

/**
 * System-generated text for one recipient: the recipient Person's explicit
 * preference, then English. There is no device language on the server, and
 * the sender's UI language is never used.
 */
export const resolveRecipientLocale = (preferred: string | null | undefined): SupportedLocale =>
  localeRegistry.isSupported(preferred) ? preferred : localeRegistry.fallback;
