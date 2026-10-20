import { isSupportedLocale, type LanguagePreferenceResponse, type PreferredLanguage } from '@service-center/shared';

/** One row of `my_language_preference` / `set_my_language_preference`. */
export interface LanguagePreferenceRow {
  person_linked: boolean;
  preferred_language: string | null;
}

/**
 * The database only stores codes its constraint allows, which this server
 * also supports; anything else would mean schema and registry disagree, so it
 * is reported as Automatic rather than passed through.
 */
const toPreferredLanguage = (value: string | null): PreferredLanguage => (isSupportedLocale(value) ? value : null);

export const mapLanguagePreferenceRow = (row: LanguagePreferenceRow | undefined): LanguagePreferenceResponse => ({
  preferred_language: row ? toPreferredLanguage(row.preferred_language) : null,
  person_linked: row?.person_linked ?? false,
});
