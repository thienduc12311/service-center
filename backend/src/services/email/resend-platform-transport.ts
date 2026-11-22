import { Resend } from 'resend';
import { config } from '../../config.js';
import { mailbox } from './mailbox.js';
import type { PlatformEmail, PlatformEmailTransport } from '../platform-email.js';

/** Platform emails through Resend, from the platform's own sender name. */
export class ResendPlatformEmailTransport implements PlatformEmailTransport {
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(email: PlatformEmail): Promise<void> {
    const { error } = await this.client.emails.send({
      from: mailbox(config.MAIL_FROM_NAME),
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (error) throw new Error(`Resend refused the email (${error.name})`);
  }
}
