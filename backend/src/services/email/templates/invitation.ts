import type { PersonInvitationNotification } from '../../notifications.js';
import { escapeHtml, recipientLanguage } from '../../../lib/i18n.js';
import { config } from '../../../config.js';
import type { EmailContent } from './schedule.js';
import {
  brandedEmailLayout,
  divider,
  heading,
  mutedParagraph,
  paragraph,
  primaryButton,
  storeBadges,
  subheading,
  type EmailBranding,
  type StoreBadge,
} from './layout.js';

/** Branding from the environment: the web app serves the logo, the stores serve the app. */
export const configuredEmailBranding = (): EmailBranding => ({
  appName: 'Service Center',
  logoUrl: new URL('/icon-192.png', config.APP_URL).toString(),
  iosAppStoreUrl: config.IOS_APP_STORE_URL ?? null,
  androidPlayStoreUrl: config.ANDROID_PLAY_STORE_URL ?? null,
});

/** Sent in the invited Person's saved language (set by a manager before they have a login). */
export const invitationEmail = (
  notification: PersonInvitationNotification,
  branding: EmailBranding = configuredEmailBranding(),
): EmailContent => {
  const { t, locale } = recipientLanguage(notification.locale);
  const organization = notification.organizationName;
  const greeting = t('email.greeting', { name: notification.personName });
  const lead = t('email.invitation.lead', { organization });
  const body = t('email.invitation.body');
  const subject = t('email.invitation.subject', { organization });
  const footer = t('email.invitation.footer', { organization });
  const comingSoon = t('email.invitation.comingSoon');
  const badges: StoreBadge[] = [
    { label: t('email.invitation.appStore'), comingSoonLabel: comingSoon, url: branding.iosAppStoreUrl },
    { label: t('email.invitation.googlePlay'), comingSoonLabel: comingSoon, url: branding.androidPlayStoreUrl },
  ];

  const bodyHtml = [
    heading(t('email.invitation.heading', { organization })),
    paragraph(escapeHtml(greeting)),
    paragraph(escapeHtml(lead)),
    paragraph(escapeHtml(body)),
    primaryButton(t('email.invitation.link'), notification.acceptUrl),
    mutedParagraph(escapeHtml(t('email.invitation.linkFallback'))),
    mutedParagraph(`<a href="${escapeHtml(notification.acceptUrl)}" style="color:#4f46e5;word-break:break-all">${escapeHtml(notification.acceptUrl)}</a>`),
    divider(),
    `<div style="text-align:center">`,
    subheading(t('email.invitation.getAppHeading')),
    mutedParagraph(escapeHtml(t('email.invitation.getAppBody'))),
    storeBadges(badges),
    `</div>`,
  ].join('');

  const storeLines = badges.map((badge) => badge.url
    ? t('email.invitation.storeText', { store: badge.label, url: badge.url })
    : t('email.invitation.storeComingSoonText', { store: badge.label }));

  return {
    subject,
    html: brandedEmailLayout({
      locale,
      title: subject,
      preheader: t('email.invitation.preheader', { organization }),
      bodyHtml,
      footerHtml: mutedParagraph(escapeHtml(footer)),
      branding,
    }),
    text: [
      greeting,
      lead,
      body,
      t('email.invitation.linkText', { url: notification.acceptUrl }),
      [t('email.invitation.getAppHeading'), ...storeLines].join('\n'),
      footer,
    ].join('\n\n'),
  };
};
