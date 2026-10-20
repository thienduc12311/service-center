/**
 * One i18next configuration for every runtime. Clients wrap the instance in
 * their React adapter; the server never changes an instance's language and
 * instead asks for a translator fixed to one recipient's locale.
 */

import i18next, { type i18n, type TFunction } from 'i18next';
import { FALLBACK_LOCALE, localeRegistry, type LocaleRegistry, type SupportedLocale } from './locales.js';
import { DEFAULT_NAMESPACE, NAMESPACES, resources, type LocaleResources, type Namespace } from './resources.js';
import type { TranslatableMessage, TranslationValues } from './types.js';

/** Called for a key missing from every language, including English. */
export type MissingKeyReporter = (locale: string, namespace: string, key: string) => void;

export interface CreateI18nOptions<Code extends string = SupportedLocale> {
  /** Initial display language. */
  locale?: Code;
  /** Defaults to the application registry; tests pass one with an extra language. */
  registry?: LocaleRegistry<Code>;
  /** Defaults to the bundled catalogs. */
  catalogs?: Record<Code, LocaleResources>;
  /**
   * Development diagnostics for missing keys. Released builds pass nothing;
   * either way a missing key renders as an empty string, never the raw key.
   */
  onMissingKey?: MissingKeyReporter;
  /** Registers plugins (e.g. react-i18next's `initReactI18next`) before initialization. */
  configure?: (instance: i18n) => void;
}

/**
 * A new, independent i18next instance (never the global singleton), fully
 * initialized synchronously from bundled resources.
 */
export const createI18n = <Code extends string = SupportedLocale>(options: CreateI18nOptions<Code> = {}): i18n => {
  const registry = options.registry ?? (localeRegistry as unknown as LocaleRegistry<Code>);
  const catalogs = options.catalogs ?? (resources as unknown as Record<Code, LocaleResources>);
  const instance = i18next.createInstance();
  options.configure?.(instance);
  void instance.init({
    resources: catalogs,
    lng: options.locale ?? registry.fallback,
    fallbackLng: registry.fallback,
    supportedLngs: [...registry.codes],
    // Canonical codes only: never load `vi-VN` resources, never strip to a language.
    load: 'currentOnly',
    nonExplicitSupportedLngs: false,
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    fallbackNS: false,
    initAsync: false,
    returnNull: false,
    returnEmptyString: false,
    // Values are inserted as plain text. React and React Native escape text
    // themselves; server output escapes per format (HTML, push, plain text).
    interpolation: { escapeValue: false, skipOnVariables: true },
    saveMissing: Boolean(options.onMissingKey),
    missingKeyHandler: options.onMissingKey
      ? (languages, namespace, key) => options.onMissingKey?.(languages[0] ?? FALLBACK_LOCALE, namespace, key)
      : false,
    // Never show a raw key: an unknown key renders empty (and is reported above).
    parseMissingKeyHandler: () => '',
    // Resources are bundled, so React bindings never need to suspend.
    react: { useSuspense: false },
  });
  return instance;
};

/** A translation function fixed to one language and namespace. */
export type FixedTranslator<N extends Namespace = Namespace> = TFunction<N>;

let serverInstance: i18n | null = null;

/**
 * Server-side translator for one recipient or request. The shared instance is
 * initialized once and its language is never changed; `getFixedT` returns a
 * function bound to `locale`, so concurrent recipients cannot affect each
 * other.
 */
export const translatorFor = <N extends Namespace>(locale: SupportedLocale, namespace: N): FixedTranslator<N> => {
  serverInstance ??= createI18n();
  return serverInstance.getFixedT(locale, namespace) as FixedTranslator<N>;
};

/**
 * Renders a key chosen at runtime (an API error code, a message passed
 * across a boundary). `TranslatableMessage.key` is already constrained to
 * real namespaced keys, so only i18next's literal-key overloads are bypassed.
 */
type RuntimeTranslate = (key: string, values?: TranslationValues) => string;

export const translateMessage = (instance: i18n, message: TranslatableMessage): string =>
  (instance.t as unknown as RuntimeTranslate)(message.key, message.values);
