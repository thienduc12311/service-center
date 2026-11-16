import { describe, expect, it } from 'vitest';
import { churchApplicationDraftFrom, churchApplicationRequestFrom, type AdminChurchApplication } from '@service-center/shared';
import { applicationLocation, changedApplicationFields, isApplicationStatus, sortApplications, websiteHref } from './applications';

const application = (overrides: Partial<AdminChurchApplication> = {}): AdminChurchApplication => ({
  id: 'a1',
  status: 'pending',
  church_name: 'Hope Church',
  leader_name: 'Pastor Kim',
  contact_phone: null,
  website: 'hope.org',
  address_line1: null,
  address_line2: null,
  city: 'Atlanta',
  state_province: 'GA',
  postal_code: null,
  country: 'United States',
  expected_member_count: 120,
  timezone: 'America/New_York',
  note: null,
  rejection_reason: null,
  reviewed_at: null,
  organization_id: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  applicant_id: 'u1',
  applicant_name: 'Kim',
  applicant_email: 'kim@hope.org',
  reviewed_by: null,
  ...overrides,
});

describe('changedApplicationFields', () => {
  it('is empty when the draft is unchanged', () => {
    const original = application();
    expect(changedApplicationFields(original, churchApplicationRequestFrom(churchApplicationDraftFrom(original)))).toEqual({});
  });

  it('returns only edited fields, with cleared ones as null', () => {
    const original = application();
    const draft = { ...churchApplicationDraftFrom(original), church_name: 'Hope Church Atlanta', website: '  ', expected_member_count: '150' };
    expect(changedApplicationFields(original, churchApplicationRequestFrom(draft))).toEqual({
      church_name: 'Hope Church Atlanta',
      website: null,
      expected_member_count: 150,
    });
  });
});

describe('applicationLocation', () => {
  it('joins the parts that are present', () => {
    expect(applicationLocation(application())).toBe('Atlanta, GA, United States');
    expect(applicationLocation(application({ state_province: null }))).toBe('Atlanta, United States');
  });
});

describe('websiteHref', () => {
  it('adds a scheme when missing', () => {
    expect(websiteHref('hope.org')).toBe('https://hope.org');
    expect(websiteHref('http://hope.org')).toBe('http://hope.org');
  });
});

describe('sortApplications', () => {
  const older = application({ id: 'old', created_at: '2026-10-01T00:00:00Z' });
  const newer = application({ id: 'new', created_at: '2026-11-01T00:00:00Z' });

  it('puts the oldest pending first', () => {
    expect(sortApplications([newer, older], 'pending').map((a) => a.id)).toEqual(['old', 'new']);
  });

  it('puts the newest decision first', () => {
    expect(sortApplications([older, newer], 'approved').map((a) => a.id)).toEqual(['new', 'old']);
  });
});

describe('isApplicationStatus', () => {
  it('accepts the four statuses only', () => {
    expect(isApplicationStatus('rejected')).toBe(true);
    expect(isApplicationStatus('deleted')).toBe(false);
    expect(isApplicationStatus(null)).toBe(false);
  });
});
