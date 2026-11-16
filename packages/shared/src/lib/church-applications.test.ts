import { describe, expect, it } from 'vitest';
import type { ChurchApplication } from '../types/platform-admin.js';
import {
  churchApplicationDraftFrom,
  churchApplicationRequestFrom,
  churchApplicationView,
  emptyChurchApplicationDraft,
  storageQuotaState,
} from './church-applications.js';

const application = (overrides: Partial<ChurchApplication>): ChurchApplication => ({
  id: 'app-1',
  status: 'pending',
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
  expected_member_count: 120,
  timezone: 'America/New_York',
  note: null,
  rejection_reason: null,
  reviewed_at: null,
  organization_id: null,
  created_at: '2026-11-16T00:00:00Z',
  updated_at: '2026-11-16T00:00:00Z',
  ...overrides,
});

describe('churchApplicationView', () => {
  it('shows a blank form before the first request', () => {
    expect(churchApplicationView([], { hasChurch: false })).toEqual({ kind: 'form', prefill: null });
  });

  it('prefers a pending request over older decisions', () => {
    const pending = application({ id: 'new' });
    const view = churchApplicationView([application({ id: 'old', status: 'rejected' }), pending], { hasChurch: false });
    expect(view).toEqual({ kind: 'pending', application: pending });
  });

  it('shows the newest rejection with its reason', () => {
    const rejected = application({ status: 'rejected', rejection_reason: 'Duplicate' });
    expect(churchApplicationView([rejected], { hasChurch: true })).toEqual({ kind: 'rejected', application: rejected });
  });

  it('shows an approval only to someone still without a church', () => {
    const approved = application({ status: 'approved', organization_id: 'org-1' });
    expect(churchApplicationView([approved], { hasChurch: false }).kind).toBe('approved');
    expect(churchApplicationView([approved], { hasChurch: true }).kind).toBe('form');
  });

  it('starts over after a withdrawal', () => {
    expect(churchApplicationView([application({ status: 'withdrawn' })], { hasChurch: false }).kind).toBe('form');
  });
});

describe('church application drafts', () => {
  it('sends blank optional fields as null and the count as a whole number', () => {
    const request = churchApplicationRequestFrom({
      ...emptyChurchApplicationDraft('Asia/Ho_Chi_Minh'),
      church_name: ' Grace ',
      leader_name: 'Pastor Lee',
      city: 'Hue',
      country: 'Vietnam',
      website: '   ',
      expected_member_count: '120.7',
    });
    expect(request).toMatchObject({
      church_name: 'Grace',
      website: null,
      expected_member_count: 120,
      timezone: 'Asia/Ho_Chi_Minh',
    });
  });

  it('round-trips an existing application', () => {
    const existing = application({ website: 'https://grace.example', note: 'Sundays' });
    expect(churchApplicationRequestFrom(churchApplicationDraftFrom(existing))).toMatchObject({
      website: 'https://grace.example',
      note: 'Sundays',
      expected_member_count: 120,
    });
  });
});

describe('storageQuotaState', () => {
  it('warns at the threshold and is full at the quota', () => {
    expect(storageQuotaState(0.79, 0.8)).toBe('ok');
    expect(storageQuotaState(0.8, 0.8)).toBe('warning');
    expect(storageQuotaState(1, 0.8)).toBe('full');
  });
});
