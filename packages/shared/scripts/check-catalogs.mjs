// Release gate for translation catalogs: every language has every English
// namespace and key, its own plural forms, and the same placeholders.
// Usage: npm run i18n:check (builds the shared package first).
import { FALLBACK_LOCALE, NAMESPACES, formatCatalogIssue, resources, validateCatalogs } from '../dist/index.js';

const issues = validateCatalogs({ resources, namespaces: NAMESPACES, reference: FALLBACK_LOCALE });
if (issues.length > 0) {
  console.error(`Translation catalogs have ${issues.length} problem(s):`);
  for (const issue of issues) console.error(`  ${formatCatalogIssue(issue)}`);
  process.exit(1);
}
const counts = Object.entries(resources).map(([locale, catalogs]) => {
  const leaves = (tree) => Object.values(tree).reduce((total, value) => total + (typeof value === 'string' ? 1 : leaves(value)), 0);
  return `${locale}: ${NAMESPACES.reduce((total, namespace) => total + leaves(catalogs[namespace] ?? {}), 0)} strings`;
});
console.log(`Translation catalogs OK (${NAMESPACES.length} namespaces; ${counts.join(', ')}).`);
