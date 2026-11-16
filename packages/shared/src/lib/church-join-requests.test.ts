import { describe, expect, it } from 'vitest';
import type { MyChurchJoinRequest } from '../types/church-join-requests.js';
import { createChurchJoinRequestSchema, declineChurchJoinRequestSchema } from '../schemas/church-join-requests.js';
import type { ChurchApplication } from '../types/platform-admin.js';
import { churchJoinView, churchSlugFromInput, isChurchSlug, suggestedWelcomeChoice } from './church-join-requests.js';

const request = (overrides: Partial<MyChurchJoinRequest>): MyChurchJoinRequest => ({
  id: 'req-1',
  organization_id: 'org-1',
  organization_name: 'Riverside',
  organization_slug: 'riverside',
  status: 'pending',
  message: null,
  decline_reason: null,
  decided_at: null,
  created_at: '2026-11-16T00:00:00Z',
  updated_at: '2026-11-16T00:00:00Z',
  ...overrides,
});

describe('churchSlugFromInput', () => {
  it('lowercases and trims a typed slug', () => {
    expect(churchSlugFromInput('  Riverside ')).toBe('riverside');
    expect(churchSlugFromInput('@grace-atl')).toBe('grace-atl');
    expect(churchSlugFromInput('')).toBe('');
  });

  it('takes the last path segment of a pasted link', () => {
    expect(churchSlugFromInput('https://app.example.com/riverside')).toBe('riverside');
    expect(churchSlugFromInput('https://app.example.com/join/Riverside/?ref=x#top')).toBe('riverside');
    expect(churchSlugFromInput('app.example.com/riverside')).toBe('riverside');
    expect(churchSlugFromInput('http://localhost:5173/riverside')).toBe('riverside');
    expect(churchSlugFromInput('join/riverside')).toBe('riverside');
  });

  it('finds no slug in a bare host', () => {
    expect(churchSlugFromInput('https://app.example.com/')).toBe('');
    expect(churchSlugFromInput('app.example.com/')).toBe('');
  });

  it('leaves validation to isChurchSlug', () => {
    expect(isChurchSlug(churchSlugFromInput('Grace Church'))).toBe(false);
    expect(isChurchSlug('r')).toBe(false);
    expect(isChurchSlug('riverside')).toBe(true);
  });
});

describe('churchJoinView', () => {
  it('shows the form with no requests or after a withdrawal', () => {
    expect(churchJoinView([])).toEqual({ kind: 'form' });
    expect(churchJoinView([request({ status: 'withdrawn' })])).toEqual({ kind: 'form' });
  });

  it('prefers a pending request over newer decisions', () => {
    const pending = request({ id: 'old', status: 'pending' });
    expect(churchJoinView([request({ id: 'new', status: 'declined' }), pending])).toEqual({ kind: 'pending', request: pending });
  });

  it('shows the newest decision', () => {
    const declined = request({ status: 'declined', decline_reason: 'Not now' });
    expect(churchJoinView([declined])).toEqual({ kind: 'declined', request: declined });
    const approved = request({ status: 'approved' });
    expect(churchJoinView([approved, declined])).toEqual({ kind: 'approved', request: approved });
  });
});

describe('join request schemas', () => {
  it('normalizes the slug and blanks an empty message', () => {
    expect(createChurchJoinRequestSchema.parse({ slug: ' Riverside ', message: '   ' })).toEqual({ slug: 'riverside', message: null });
    expect(createChurchJoinRequestSchema.parse({ slug: 'riverside' })).toEqual({ slug: 'riverside', message: null });
  });

  it('limits the message and the decline reason to 500 characters', () => {
    expect(createChurchJoinRequestSchema.safeParse({ slug: 'riverside', message: 'x'.repeat(501) }).success).toBe(false);
    expect(declineChurchJoinRequestSchema.safeParse({ reason: 'x'.repeat(500) }).success).toBe(true);
    expect(declineChurchJoinRequestSchema.parse({})).toEqual({ reason: null });
  });
});

describe('suggestedWelcomeChoice', () => {
  const application = (status: ChurchApplication['status']): ChurchApplication => ({
    id: 'app-1',
    status,
    church_name: 'Grace',
    leader_name: 'Pastor Lee',
    contact_phone: null,
    website: null,
    address_line1: null,
    address_line2: null,
    city: 'Atlanta',
    state_province: null,
    postal_code: null,
    country: 'USA',
    expected_member_count: null,
    timezone: 'America/New_York',
    note: null,
    rejection_reason: null,
    reviewed_at: null,
    organization_id: null,
    created_at: '2026-11-16T00:00:00Z',
    updated_at: '2026-11-16T00:00:00Z',
  });

  it('lets the person pick when nothing is waiting or decided', () => {
    expect(suggestedWelcomeChoice([], [])).toBeNull();
    expect(suggestedWelcomeChoice([request({ status: 'withdrawn' })], [application('withdrawn')])).toBeNull();
  });

  it('opens the choice that has something to show, joining first', () => {
    expect(suggestedWelcomeChoice([], [application('pending')])).toBe('register');
    expect(suggestedWelcomeChoice([request({ status: 'declined' })], [])).toBe('join');
    expect(suggestedWelcomeChoice([request({ status: 'pending' })], [application('pending')])).toBe('join');
  });
});
