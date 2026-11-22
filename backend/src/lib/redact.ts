/**
 * Public routes whose path segment after the prefix is a bearer secret
 * (response links, invitations, calendar feeds). Anyone holding the URL can
 * act on it, so request logs keep only the route shape. The first matching
 * prefix wins, so a longer prefix must come before one it extends
 * (`calendar-feed/scoped/` before `calendar-feed/`).
 */
const TOKEN_PATH_PREFIXES = [
  '/api/v1/assignment-responses/',
  '/api/v1/invitations/',
  '/api/v1/calendar-feed/scoped/',
  '/api/v1/calendar-feed/',
  // Unlisted publications: the slug is the capability.
  '/api/v1/public/plans/',
  '/api/v1/public/set-lists/',
] as const;

/** Stands in for a dropped query string, so the log still shows there was one. */
const REDACTED_QUERY = '?[redacted]';

/** Percent-decoded when well formed: `%2F`-style spellings must not dodge a prefix. */
const decodePath = (path: string): string => {
  try {
    return decodeURIComponent(path);
  } catch (error) {
    if (error instanceof URIError) return path;
    throw error;
  }
};

/**
 * The URL as a request log may show it (W10-SEC-D3):
 *
 * - Express matches routes case-insensitively, so a token prefix is matched on
 *   the lower-cased, percent-decoded path (`/API/V1/INVITATIONS/<t>` routes and
 *   must be redacted too); the token segment becomes `[token]`.
 * - The query string is never logged — any parameter may carry a secret
 *   (`?access_token=<JWT>`, `?token=`) or personal search text.
 *
 * `/api/v1/assignment-responses/abc123/respond?x` → `/api/v1/assignment-responses/[token]/respond`
 */
export const redactTokenPath = (url: string): string => {
  const queryStart = url.indexOf('?');
  const path = queryStart === -1 ? url : url.slice(0, queryStart);
  const query = queryStart === -1 ? '' : REDACTED_QUERY;
  const normalized = decodePath(path).toLowerCase();
  for (const prefix of TOKEN_PATH_PREFIXES) {
    if (!normalized.startsWith(prefix)) continue;
    const rest = normalized.slice(prefix.length);
    const slash = rest.indexOf('/');
    const segment = slash === -1 ? rest : rest.slice(0, slash);
    const suffix = slash === -1 ? '' : rest.slice(slash);
    const extension = segment.endsWith('.ics') ? '.ics' : '';
    return `${prefix}[token]${extension}${suffix}`;
  }
  return `${path}${query}`;
};

/**
 * The `Referer` a request log may show: its origin only. The page that sent
 * the request can carry a token in its path or query (`/respond?token=…`).
 */
export const redactReferrer = (referrer: string | undefined): string | undefined => {
  if (!referrer) return undefined;
  try {
    const { origin } = new URL(referrer);
    return origin === 'null' ? '[redacted]' : origin;
  } catch (error) {
    if (error instanceof TypeError) return '[redacted]';
    throw error;
  }
};
