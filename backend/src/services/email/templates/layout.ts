import { escapeHtml } from '../../../lib/i18n.js';

/**
 * The branded email frame: logo and app name on top, a white card, a muted
 * footer. Table-based with inline styles so it holds up in Gmail and Outlook,
 * which ignore <style> blocks and most modern CSS.
 */

export const BRAND_COLOR = '#4f46e5';
const TEXT_COLOR = '#0f172a';
const MUTED_COLOR = '#64748b';
const PAGE_BACKGROUND = '#f8fafc';
const BORDER_COLOR = '#e2e8f0';
const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Where the brand assets and app downloads live; comes from config in production. */
export interface EmailBranding {
  appName: string;
  /** Absolute URL of a PNG logo (SVG is blocked by Gmail and Outlook). */
  logoUrl: string;
  /** Unset until the app is published: the badge shows "Coming soon". */
  iosAppStoreUrl: string | null;
  androidPlayStoreUrl: string | null;
}

export interface BrandedEmailLayoutInput {
  /** BCP 47 language tag for the `lang` attribute. */
  locale: string;
  /** Title of the HTML document (shown by some clients). */
  title: string;
  /** Inbox preview text, hidden in the body. */
  preheader: string;
  /** Already-escaped HTML for the inside of the card. */
  bodyHtml: string;
  /** Already-escaped HTML shown under the card. */
  footerHtml: string;
  branding: EmailBranding;
}

export interface StoreBadge {
  label: string;
  /** Short line under the badge when the link is not out yet. */
  comingSoonLabel: string;
  url: string | null;
}

export const paragraph = (html: string, style = ''): string =>
  `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${TEXT_COLOR};${style}">${html}</p>`;

export const mutedParagraph = (html: string): string =>
  `<p style="margin:0 0 8px;font-size:13px;line-height:20px;color:${MUTED_COLOR}">${html}</p>`;

export const heading = (text: string): string =>
  `<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:700;color:${TEXT_COLOR}">${escapeHtml(text)}</h1>`;

export const subheading = (text: string): string =>
  `<h2 style="margin:0 0 8px;font-size:17px;line-height:24px;font-weight:600;color:${TEXT_COLOR}">${escapeHtml(text)}</h2>`;

/** A "bulletproof" button: the whole padded cell is the link. */
export const primaryButton = (label: string, url: string): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr>`
  + `<td align="center" bgcolor="${BRAND_COLOR}" style="border-radius:8px">`
  + `<a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT_STACK};font-size:16px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a>`
  + `</td></tr></table>`;

export const divider = (): string =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="border-top:1px solid ${BORDER_COLOR};font-size:0;line-height:0">&nbsp;</td></tr></table>`;

/**
 * One store badge. Drawn in HTML rather than as the stores' artwork so it
 * needs no hosted images; a badge without a URL is greyed out and inert.
 */
const storeBadge = (badge: StoreBadge): string => {
  const live = badge.url !== null;
  const background = live ? '#000000' : '#cbd5e1';
  const label = `<span style="font-family:${FONT_STACK};font-size:14px;font-weight:600;line-height:18px;color:#ffffff">${escapeHtml(badge.label)}</span>`;
  const inner = live
    ? `<a href="${escapeHtml(badge.url ?? '')}" target="_blank" style="display:inline-block;padding:10px 16px;text-decoration:none;border-radius:8px">${label}</a>`
    : `<span style="display:inline-block;padding:10px 16px">${label}</span>`;
  const note = live
    ? ''
    : `<div style="padding-top:4px;font-family:${FONT_STACK};font-size:12px;line-height:16px;color:${MUTED_COLOR}">${escapeHtml(badge.comingSoonLabel)}</div>`;
  return `<td align="center" valign="top" style="padding:4px 6px">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${background}" style="border-radius:8px">${inner}</td></tr></table>`
    + note
    + `</td>`;
};

export const storeBadges = (badges: readonly StoreBadge[]): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 0"><tr>`
  + badges.map(storeBadge).join('')
  + `</tr></table>`;

export const brandedEmailLayout = (input: BrandedEmailLayoutInput): string => {
  const { branding } = input;
  return '<!doctype html>'
    + `<html lang="${escapeHtml(input.locale)}"><head>`
    + '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">'
    + `<title>${escapeHtml(input.title)}</title></head>`
    + `<body style="margin:0;padding:0;background-color:${PAGE_BACKGROUND};font-family:${FONT_STACK}">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(input.preheader)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE_BACKGROUND}" style="background-color:${PAGE_BACKGROUND}"><tr><td align="center" style="padding:32px 16px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">`
    // Header: logo + app name.
    + `<tr><td align="center" style="padding:0 0 24px">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`
    + `<td valign="middle" style="padding-right:12px"><img src="${escapeHtml(branding.logoUrl)}" width="44" height="44" alt="${escapeHtml(branding.appName)}" style="display:block;width:44px;height:44px;border:0;border-radius:10px"></td>`
    + `<td valign="middle" style="font-family:${FONT_STACK};font-size:20px;font-weight:700;line-height:28px;color:${TEXT_COLOR}">${escapeHtml(branding.appName)}</td>`
    + `</tr></table></td></tr>`
    // Card.
    + `<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid ${BORDER_COLOR};border-radius:12px;padding:32px;font-family:${FONT_STACK}">`
    + input.bodyHtml
    + `</td></tr>`
    // Footer.
    + `<tr><td align="center" style="padding:24px 16px 0;font-family:${FONT_STACK}">${input.footerHtml}</td></tr>`
    + `</table></td></tr></table></body></html>`;
};
