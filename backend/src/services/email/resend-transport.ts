import { Resend } from 'resend';
import type { NotificationTransport, PersonInvitationNotification, PersonInvitationTransport, ScheduleNotification } from '../notifications.js';
import { config } from '../../config.js';
import { invitationEmail } from './templates/invitation.js';
import { scheduleEmail } from './templates/schedule.js';

export class ResendTransport implements NotificationTransport, PersonInvitationTransport {
  private readonly client: Resend;

  constructor(apiKey: string = config.RESEND_API_KEY ?? '') {
    this.client = new Resend(apiKey);
  }

  async send(notification: ScheduleNotification | PersonInvitationNotification): Promise<void> {
    const content = 'respondUrl' in notification ? scheduleEmail(notification) : invitationEmail(notification);
    const replyTo = 'respondUrl' in notification ? notification.schedulerEmail ?? undefined : undefined;
    const attachments = 'respondUrl' in notification && notification.ics
      ? [{ filename: 'assignment.ics', content: Buffer.from(notification.ics).toString('base64') }]
      : undefined;
    const { error } = await this.client.emails.send({
      from: `${'respondUrl' in notification ? notification.organizationName ?? config.MAIL_FROM_NAME : config.MAIL_FROM_NAME} <${config.MAIL_FROM_ADDRESS}>`,
      to: notification.to,
      subject: content.subject,
      html: content.html,
      text: content.text,
      ...(replyTo ? { replyTo } : {}),
      ...(attachments ? { attachments } : {}),
    });
    if (error) throw new Error(`Email delivery failed: ${error.message}`);
  }
}
