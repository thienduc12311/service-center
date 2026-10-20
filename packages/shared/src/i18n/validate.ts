/**
 * Release validation for translation catalogs. English defines the contract;
 * every other language must provide the same namespaces and keys, the plural
 * forms its own language needs (not English's), and the same placeholders.
 * Run by `npm run i18n:check -w @service-center/shared` and the shared tests.
 */

import type { CatalogTree } from './resources.js';

export type CatalogIssueKind =
  | 'missing_namespace'
  | 'missing_key'
  | 'extra_key'
  | 'missing_plural_form'
  | 'unexpected_plural_form'
  | 'placeholder_mismatch'
  | 'unescaped_interpolation'
  | 'markup'
  | 'empty_value';

export interface CatalogIssue {
  kind: CatalogIssueKind;
  locale: string;
  namespace: string;
  key: string;
  detail?: string;
}

/** Plural suffixes i18next resolves (CLDR categories), plus the optional `_zero` override. */
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

const PLURAL_SUFFIX = new RegExp(`_(${PLURAL_CATEGORIES.join('|')})$`);
const PLACEHOLDER = /\{\{\s*(-?)\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g;
const MARKUP = /<\/?[a-z][^>]*>/i;

interface CatalogEntry {
  /** Key without plural suffix. */
  base: string;
  /** Plural category, or null for a plain key. */
  category: PluralCategory | null;
  value: string;
}

const flatten = (tree: CatalogTree, prefix = ''): CatalogEntry[] =>
  Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value !== 'string') return flatten(value, path);
    const match = PLURAL_SUFFIX.exec(path);
    return [{ base: match ? path.slice(0, -match[0].length) : path, category: (match?.[1] as PluralCategory | undefined) ?? null, value }];
  });

interface KeyGroup {
  plural: boolean;
  forms: Map<PluralCategory | null, string>;
}

const group = (entries: readonly CatalogEntry[]): Map<string, KeyGroup> => {
  const groups = new Map<string, KeyGroup>();
  for (const entry of entries) {
    const existing = groups.get(entry.base) ?? { plural: false, forms: new Map() };
    existing.forms.set(entry.category, entry.value);
    if (entry.category) existing.plural = true;
    groups.set(entry.base, existing);
  }
  return groups;
};

/** Named placeholders in one string (`{{name}}`), and whether any is unescaped (`{{- name}}`). */
export const placeholdersOf = (value: string): { names: Set<string>; unescaped: boolean } => {
  const names = new Set<string>();
  let unescaped = false;
  for (const match of value.matchAll(PLACEHOLDER)) {
    if (match[1]) unescaped = true;
    if (match[2]) names.add(match[2]);
  }
  return { names, unescaped };
};

const placeholderUnion = (forms: Iterable<string>): Set<string> => {
  const union = new Set<string>();
  for (const value of forms) for (const name of placeholdersOf(value).names) union.add(name);
  return union;
};

/** Required plural categories for a language, from the runtime's CLDR data. */
export const requiredPluralCategories = (locale: string): PluralCategory[] =>
  new Intl.PluralRules(locale).resolvedOptions().pluralCategories.filter((category): category is PluralCategory =>
    (PLURAL_CATEGORIES as readonly string[]).includes(category));

const sorted = (values: Iterable<string>): string => [...values].sort().join(', ');

export interface ValidateCatalogsInput {
  /** Language code → namespace → catalog tree. Must include the reference language. */
  resources: Record<string, Partial<Record<string, CatalogTree>>>;
  namespaces: readonly string[];
  /** The contract language (English). */
  reference: string;
  /** Plural categories per language; defaults to `Intl.PluralRules`. */
  pluralCategories?: (locale: string) => readonly string[];
}

export const validateCatalogs = ({
  resources,
  namespaces,
  reference,
  pluralCategories = requiredPluralCategories,
}: ValidateCatalogsInput): CatalogIssue[] => {
  const issues: CatalogIssue[] = [];
  const referenceCatalogs = resources[reference] ?? {};

  for (const [locale, catalogs] of Object.entries(resources)) {
    const required = new Set(pluralCategories(locale));
    for (const namespace of namespaces) {
      const tree = catalogs[namespace];
      if (!tree) {
        issues.push({ kind: 'missing_namespace', locale, namespace, key: '' });
        continue;
      }
      const target = group(flatten(tree));
      const contract = group(flatten(referenceCatalogs[namespace] ?? {}));

      for (const [key, groupEntry] of target) {
        for (const [category, value] of groupEntry.forms) {
          const formKey = category ? `${key}_${category}` : key;
          if (value.trim() === '') issues.push({ kind: 'empty_value', locale, namespace, key: formKey });
          if (placeholdersOf(value).unescaped) issues.push({ kind: 'unescaped_interpolation', locale, namespace, key: formKey });
          if (MARKUP.test(value)) issues.push({ kind: 'markup', locale, namespace, key: formKey, detail: value });
        }
      }

      for (const [key, expected] of contract) {
        const actual = target.get(key);
        if (!actual) {
          issues.push({ kind: 'missing_key', locale, namespace, key });
          continue;
        }
        if (expected.plural) {
          const present = new Set([...actual.forms.keys()].filter((category): category is PluralCategory => category !== null));
          for (const category of required) {
            if (!present.has(category as PluralCategory)) {
              issues.push({ kind: 'missing_plural_form', locale, namespace, key, detail: `needs _${category}` });
            }
          }
          for (const category of present) {
            // `_zero` is an optional, explicit override i18next honors for count 0.
            if (category !== 'zero' && !required.has(category)) {
              issues.push({ kind: 'unexpected_plural_form', locale, namespace, key, detail: `_${category} is not a ${locale} plural form` });
            }
          }
          if (actual.forms.has(null)) {
            issues.push({ kind: 'unexpected_plural_form', locale, namespace, key, detail: 'plain value alongside plural forms' });
          }
        } else if (actual.plural) {
          issues.push({ kind: 'unexpected_plural_form', locale, namespace, key, detail: 'reference value is not plural' });
        }

        const expectedNames = placeholderUnion(expected.forms.values());
        const actualNames = placeholderUnion(actual.forms.values());
        // A plural form may spell the number out ("an item"), so `count` is optional.
        expectedNames.delete('count');
        actualNames.delete('count');
        const missing = [...expectedNames].filter((name) => !actualNames.has(name));
        const extra = [...actualNames].filter((name) => !expectedNames.has(name));
        if (missing.length || extra.length) {
          issues.push({
            kind: 'placeholder_mismatch',
            locale,
            namespace,
            key,
            detail: `expected {${sorted(expectedNames)}}, found {${sorted(actualNames)}}`,
          });
        }
      }

      if (locale !== reference) {
        for (const key of target.keys()) {
          if (!contract.has(key)) issues.push({ kind: 'extra_key', locale, namespace, key });
        }
      }
    }
  }
  return issues;
};

export const formatCatalogIssue = (issue: CatalogIssue): string =>
  `${issue.locale}/${issue.namespace}${issue.key ? `:${issue.key}` : ''} — ${issue.kind}${issue.detail ? ` (${issue.detail})` : ''}`;
