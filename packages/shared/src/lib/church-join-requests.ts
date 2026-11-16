/**
 * Joining a church by its URL slug, as both clients show it: reading what the
 * person typed (a slug or a pasted church link), which state their requests
 * are in, and the API error codes. See
 * supabase/migrations/20261117000000_church_join_requests.sql.
 */
import type { MyChurchJoinRequest } from '../types/church-join-requests.js';
import type { ChurchApplication } from '../types/platform-admin.js';
import { churchApplicationView } from './church-applications.js';

/** 404: no active church uses that slug (unknown and disabled read the same). */
export const CHURCH_NOT_FOUND = 'church_not_found';
/** 409: the person already belongs to that church (any membership status). */
export const ALREADY_CHURCH_MEMBER = 'already_church_member';
/** 409: the person already has a request waiting at that church. */
export const JOIN_REQUEST_PENDING = 'join_request_pending';
/** 409: approving someone who joined the church meanwhile (owners see this). */
export const REQUESTER_ALREADY_MEMBER = 'requester_already_member';
/** 409: the request was decided or withdrawn meanwhile. */
export const JOIN_REQUEST_NOT_PENDING = 'join_request_not_pending';

/** Same rule as `organizations.slug`. */
const SLUG_PATTERN = /^[a-z0-9-]{2,40}$/;

/**
 * The slug in what the person typed: a bare slug (`Riverside`), or a pasted
 * link whose last path segment is the slug (`https://app.example.com/riverside/`).
 * Lowercased and trimmed; an empty string when nothing usable remains.
 */
export const churchSlugFromInput = (input: string): string => {
  let value = input.trim();
  if (value.includes('/')) {
    const path = (value.split(/[?#]/)[0] ?? '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    const segments = path.split('/').filter(Boolean);
    // A slug never has a dot or colon, so a first segment with one is the host.
    const first = segments[0] ?? '';
    const hasHost = first.includes('.') || first.includes(':') || first === 'localhost';
    const pathSegments = hasHost ? segments.slice(1) : segments;
    value = pathSegments[pathSegments.length - 1] ?? '';
  }
  return value.replace(/^@/, '').trim().toLowerCase();
};

/** True when `slug` could be a church slug (checked again by the API). */
export const isChurchSlug = (slug: string): boolean => SLUG_PATTERN.test(slug);

/** What the person sees about joining, from their requests (newest first). */
export type ChurchJoinView =
  | { kind: 'form' }
  | { kind: 'pending'; request: MyChurchJoinRequest }
  | { kind: 'declined'; request: MyChurchJoinRequest }
  | { kind: 'approved'; request: MyChurchJoinRequest };

/**
 * A pending request always wins. Otherwise the newest decision is shown: a
 * decline (with its reason) or an approval (the invitation is on its way).
 * A withdrawn request, or none, is the form.
 */
export const churchJoinView = (requests: readonly MyChurchJoinRequest[]): ChurchJoinView => {
  const pending = requests.find((request) => request.status === 'pending');
  if (pending) return { kind: 'pending', request: pending };
  const newest = requests[0];
  if (newest?.status === 'declined') return { kind: 'declined', request: newest };
  if (newest?.status === 'approved') return { kind: 'approved', request: newest };
  return { kind: 'form' };
};

/** The two ways to start on the welcome screen. */
export type WelcomeChoice = 'join' | 'register';

/**
 * Which choice to open on the welcome screen: the one with something to show
 * (a request waiting or decided), the join request first. Null: neither yet,
 * so the person picks.
 */
export const suggestedWelcomeChoice = (
  joinRequests: readonly MyChurchJoinRequest[],
  applications: readonly ChurchApplication[],
): WelcomeChoice | null => {
  if (churchJoinView(joinRequests).kind !== 'form') return 'join';
  if (churchApplicationView(applications, { hasChurch: false }).kind !== 'form') return 'register';
  return null;
};
