import { config } from '../../config.js';

/**
 * The From header for mail we send: `"Display name" <MAIL_FROM_ADDRESS>`.
 *
 * The display name is often a church's name, which is free text. Unquoted, a
 * comma, `<`, `"` or line break in it made the header malformed (the provider
 * then refused every email from that church) or let it masquerade as another
 * address. It is quoted per RFC 5322, with line breaks and control characters
 * folded to spaces and `\` / `"` escaped.
 */
export const mailbox = (displayName: string): string => {
  const name = displayName
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\"]/g, (match) => `\\${match}`);
  return name ? `"${name}" <${config.MAIL_FROM_ADDRESS}>` : config.MAIL_FROM_ADDRESS;
};
