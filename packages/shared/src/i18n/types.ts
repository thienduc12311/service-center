/**
 * Typed translation keys. English catalogs define the contract, so `t()` in
 * every package rejects keys that do not exist (plural suffixes are resolved
 * by i18next from `count`). Placeholder compatibility across languages is
 * enforced by `validateCatalogs`.
 */

import type { EnglishResources, Namespace } from './resources.js';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: EnglishResources;
    returnNull: false;
  }
}

type PluralSuffix = '_zero' | '_one' | '_two' | '_few' | '_many' | '_other';
type StripPlural<K extends string> = K extends `${infer Base}${PluralSuffix}` ? Base : K;

type LeafKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${StripPlural<K>}`
    : LeafKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** A key inside one namespace, e.g. `TranslationKey<'common'>` = `'language.label' | …`. */
export type TranslationKey<N extends Namespace = Namespace> = LeafKeys<EnglishResources[N]>;

/** A namespaced key, e.g. `'errors:generic.unexpected'`. */
export type QualifiedTranslationKey = { [N in Namespace]: `${N}:${TranslationKey<N>}` }[Namespace];

/** Interpolation values: always plain text or numbers, never markup. */
export type TranslationValues = Record<string, string | number>;

/** A key plus its values, for passing translatable messages across boundaries. */
export interface TranslatableMessage {
  key: QualifiedTranslationKey;
  values?: TranslationValues;
}
