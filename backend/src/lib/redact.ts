/**
 * Public routes whose path segment after the prefix is a bearer secret
 * (response links, invitations, calendar feeds). Anyone holding the URL can
 * act on it, so request logs keep only the route shape.
 */
const TOKEN_PATH_PREFIXES = [
  '/api/v1/assignment-responses/',
  '/api/v1/invitations/',
  '/api/v1/calendar-feed/',
] as const;

/** `/api/v1/assignment-responses/abc123/respond?x` → `/api/v1/assignment-responses/[token]/respond` */
export const redactTokenPath = (url: string): string => {
  const path = url.split('?')[0] ?? url;
  for (const prefix of TOKEN_PATH_PREFIXES) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    const segment = slash === -1 ? rest : rest.slice(0, slash);
    const suffix = slash === -1 ? '' : rest.slice(slash);
    const extension = segment.endsWith('.ics') ? '.ics' : '';
    return `${prefix}[token]${extension}${suffix}`;
  }
  return url;
};
