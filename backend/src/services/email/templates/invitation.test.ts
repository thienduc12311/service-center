import { describe, expect, it } from 'vitest';
import { invitationEmail } from './invitation.js';
import type { EmailBranding } from './layout.js';
import type { PersonInvitationNotification } from '../../notifications.js';

const notification: PersonInvitationNotification = {
  to: 'riley@example.test',
  locale: 'en',
  personName: 'Riley <b>',
  organizationName: 'Riverside & Co',
  acceptUrl: 'https://app.test/invite/accept?token=a&b=1',
};

const unpublished: EmailBranding = {
  appName: 'Service Center',
  logoUrl: 'https://app.test/icon-192.png',
  iosAppStoreUrl: null,
  androidPlayStoreUrl: null,
};

const published: EmailBranding = {
  ...unpublished,
  iosAppStoreUrl: 'https://apps.apple.com/app/id123',
  androidPlayStoreUrl: 'https://play.google.com/store/apps/details?id=test.app',
};

describe('invitationEmail', () => {
  it('frames the invitation with the logo, app name and a join button', () => {
    const content = invitationEmail(notification, unpublished);
    expect(content.subject).toBe('Join Riverside & Co');
    expect(content.html).toMatch(/^<!doctype html><html lang="en">/);
    expect(content.html).toContain('<img src="https://app.test/icon-192.png"');
    expect(content.html).toContain('>Service Center</td>');
    expect(content.html).toContain('You&#39;re invited to join Riverside &amp; Co');
    expect(content.html).toContain('href="https://app.test/invite/accept?token=a&amp;b=1"');
    expect(content.html).not.toContain('Riley <b>');
  });

  it('shows both store badges as coming soon until the apps are published', () => {
    const content = invitationEmail(notification, unpublished);
    expect(content.html).toContain('Download on the App Store');
    expect(content.html).toContain('Get it on Google Play');
    expect(content.html.match(/Coming soon/g)).toHaveLength(2);
    expect(content.html).not.toContain('apps.apple.com');
    expect(content.text).toContain('Download on the App Store: coming soon');
    expect(content.text).toContain('Get it on Google Play: coming soon');
  });

  it('links the store badges once their URLs are configured', () => {
    const content = invitationEmail(notification, published);
    expect(content.html).toContain('href="https://apps.apple.com/app/id123"');
    expect(content.html).toContain('href="https://play.google.com/store/apps/details?id=test.app"');
    expect(content.html).not.toContain('Coming soon');
    expect(content.text).toContain('Download on the App Store: https://apps.apple.com/app/id123');
  });

  it('keeps the plain-text version complete', () => {
    const content = invitationEmail(notification, unpublished);
    expect(content.text).toContain('Hi Riley <b>,');
    expect(content.text).toContain('Join the organization: https://app.test/invite/accept?token=a&b=1');
    expect(content.text).toContain('someone at Riverside & Co invited you');
  });

  it('writes in the recipient language', () => {
    const content = invitationEmail({ ...notification, locale: 'vi' }, unpublished);
    expect(content.subject).toBe('Tham gia Riverside & Co');
    expect(content.html).toContain('<html lang="vi">');
    expect(content.html).toContain('Sắp ra mắt');
  });
});
