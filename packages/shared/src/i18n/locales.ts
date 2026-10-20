/**
 * The central language registry. Every runtime (web, native, server) reads
 * supported languages from here; screens and message services never branch
 * on a language code. Adding a language is a registry entry plus catalogs —
 * see `README.md` in this directory.
 */

export type TextDirection = 'ltr' | 'rtl';

/** One supported language as the registry describes it. */
export interface LocaleDefinition<Code extends string = string> {
  /** Canonical code persisted in `people.preferred_language` (lowercase BCP 47 language). */
  code: Code;
  /** Name in the language itself, shown in the selector ("Tiếng Việt"). */
  nativeName: string;
  /** English name, for logs, docs and screen readers in English. */
  englishName: string;
  /** Locale handed to `Intl` for dates, times and numbers. */
  formatLocale: string;
  direction: TextDirection;
}

/**
 * Launch languages. English is the ultimate fallback and must stay first.
 * The database constraint `people_preferred_language_check` (and the
 * delivery locale constraint) must list exactly these codes.
 */
export const LOCALE_DEFINITIONS = [
  { code: 'en', nativeName: 'English', englishName: 'English', formatLocale: 'en-US', direction: 'ltr' },
  { code: 'vi', nativeName: 'Tiếng Việt', englishName: 'Vietnamese', formatLocale: 'vi-VN', direction: 'ltr' },
] as const satisfies readonly LocaleDefinition[];

export type SupportedLocale = (typeof LOCALE_DEFINITIONS)[number]['code'];

export const FALLBACK_LOCALE = 'en' satisfies SupportedLocale;

/** Selector option for one language; the caller adds "Automatic" itself. */
export interface LocaleOption<Code extends string = string> {
  code: Code;
  label: string;
  /** BCP 47 tag for the option's `lang` attribute, so screen readers pronounce it correctly. */
  lang: Code;
}

/**
 * Lookups over one set of definitions. The application uses `localeRegistry`;
 * tests build their own with an extra language to prove that registering a
 * language needs no screen changes.
 */
export interface LocaleRegistry<Code extends string = string> {
  readonly definitions: readonly LocaleDefinition<Code>[];
  readonly codes: readonly Code[];
  readonly fallback: Code;
  isSupported(value: unknown): value is Code;
  definition(code: Code): LocaleDefinition<Code>;
  /**
   * A detected or stored tag reduced to a supported code: `vi-VN` → `vi`,
   * `EN_us` → `en`; anything unsupported → null.
   */
  normalize(tag: string | null | undefined): Code | null;
  options(): LocaleOption<Code>[];
}

export const createLocaleRegistry = <Code extends string>(
  definitions: readonly LocaleDefinition<Code>[],
): LocaleRegistry<Code> => {
  const first = definitions[0];
  if (!first) throw new Error('A locale registry needs at least one language');
  const byCode = new Map(definitions.map((definition) => [definition.code, definition]));
  const codes = definitions.map((definition) => definition.code);

  const isSupported = (value: unknown): value is Code => typeof value === 'string' && byCode.has(value as Code);

  return {
    definitions,
    codes,
    fallback: first.code,
    isSupported,
    definition: (code) => byCode.get(code) ?? first,
    normalize: (tag) => {
      if (typeof tag !== 'string') return null;
      const cleaned = tag.trim().replace(/_/g, '-').toLowerCase();
      if (!cleaned) return null;
      if (isSupported(cleaned)) return cleaned;
      const language = cleaned.split('-')[0] ?? '';
      return isSupported(language) ? language : null;
    },
    options: () => definitions.map((definition) => ({ code: definition.code, label: definition.nativeName, lang: definition.code })),
  };
};

export const localeRegistry: LocaleRegistry<SupportedLocale> = createLocaleRegistry<SupportedLocale>(LOCALE_DEFINITIONS);

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = localeRegistry.codes;

export const isSupportedLocale = (value: unknown): value is SupportedLocale => localeRegistry.isSupported(value);

export const normalizeLocale = (tag: string | null | undefined): SupportedLocale | null => localeRegistry.normalize(tag);

/** Locale handed to `Intl` for one supported language. */
export const formatLocaleFor = (locale: SupportedLocale): string => localeRegistry.definition(locale).formatLocale;

export const directionFor = (locale: SupportedLocale): TextDirection => localeRegistry.definition(locale).direction;
