import { NAMESPACES, type CatalogTree, type LocaleResources } from './resources.js';

/** Vietnamese uses one count form in our catalogs across ICU versions. */
export const VIETNAMESE_PLURAL_CATEGORY = 'other';

const withVietnameseAliases = (tree: CatalogTree): CatalogTree => {
  const result = { ...tree };
  const suffix = `_${VIETNAMESE_PLURAL_CATEGORY}`;
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value !== 'string') {
      result[key] = withVietnameseAliases(value);
    } else if (key.endsWith(suffix)) {
      const base = key.slice(0, -suffix.length);
      // ICU 79 can select _one for Vietnamese. Let i18next find the same text
      // before falling back to English, while keeping its optional _zero override.
      result[`${base}_one`] ??= value;
    }
  }
  return result;
};

/** Keep runtime aliases out of the source catalogs and their release validation. */
export const preparePluralResources = (catalogs: Record<string, LocaleResources>): Record<string, LocaleResources> => {
  const vietnamese = catalogs.vi;
  if (!vietnamese) return catalogs;
  const prepared = { ...vietnamese };
  for (const namespace of NAMESPACES) {
    const tree = vietnamese[namespace];
    if (tree) prepared[namespace] = withVietnameseAliases(tree);
  }
  return { ...catalogs, vi: prepared };
};
