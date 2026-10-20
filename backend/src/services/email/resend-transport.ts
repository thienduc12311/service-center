import { Resend, type ErrorResponse } from 'resend';
import {
  isAvailabilityRequest,
  isSchedulerResponse,
  isOperationalMessage,
  isServiceReminder,
  type AvailabilityRequestNotification,
  type EmailSendOptions,
  type EmailSendReceipt,
  type NotificationTransport,
  type OperationalMessageNotification,
  type PersonInvitationNotification,
  type PersonInvitationTransport,
  type ScheduleNotification,
  type SchedulerResponseNotification,
  type ServiceReminderNotification,
} from '../notifications.js';
import { schedulerResponseEmail } from './templates/scheduler-response.js';
import { availabilityRequestEmail } from './templates/availability.js';
import { config } from '../../config.js';
import { DeliveryError } from '../../model/delivery.model.js';
import { invitationEmail } from './templates/invitation.js';
import { scheduleEmail } from './templates/schedule.js';
import { serviceReminderEmail } from './templates/service-reminder.js';
import { operationalMessageEmail } from './templates/operational-message.js';

/** How long to wait for Resend before treating the outcome as unknown. */
const SEND_TIMEOUT_MS = 15_000;

/**
 * Maps a Resend error to what the worker should do. A response without a
 * status code means the request never got an answer, so the email may or may
 * not have been sent.
 */
export const classifyResendError = (error: Pick<ErrorResponse, 'name' | 'statusCode'>): DeliveryError => {
  if (error.statusCode === null) return new DeliveryError('provider_timeout', 'ambiguous');
  switch (error.name) {
    // Same idempotency key, different body, within Resend's 24-hour window:
    // an earlier attempt of this delivery was already accepted.
    case 'invalid_idempotent_request':
      return new DeliveryError('provider_duplicate_key', 'ambiguous');
    case 'rate_limit_exceeded':
    case 'concurrent_idempotent_requests':
      return new DeliveryError('provider_rate_limited', 'retry', 60);
    case 'daily_quota_exceeded':
      return new DeliveryError('provider_rate_limited', 'retry', 60 * 60);
    case 'application_error':
    case 'internal_server_error':
      return new DeliveryError('provider_unavailable', 'retry', 120);
    case 'missing_api_key':
    case 'invalid_api_key':
    case 'restricted_api_key':
    case 'invalid_from_address':
    case 'invalid_access':
    case 'invalid_region':
    case 'security_error':
    case 'monthly_quota_exceeded':
      return new DeliveryError('provider_misconfigured', 'fail');
    default:
      return new DeliveryError('provider_rejected', 'fail');
  }
};

const timeout = (ms: number): Promise<never> =>
  new Promise((_, reject) => {
    setTimeout(() => reject(new DeliveryError('provider_timeout', 'ambiguous')), ms).unref?.();
  });

export class ResendTransport implements NotificationTransport, PersonInvitationTransport {
  readonly mode = 'resend' as const;
  private readonly client: Resend;

  constructor(apiKey: string = config.RESEND_API_KEY ?? '') {
    this.client = new Resend(apiKey);
  }

  async send(
    notification:
      | ScheduleNotification
      | AvailabilityRequestNotification
      | ServiceReminderNotification
      | OperationalMessageNotification
      | SchedulerResponseNotification
      | PersonInvitationNotification,
    options: EmailSendOptions = {},
  ): Promise<EmailSendReceipt> {
    if (isSchedulerResponse(notification)) {
      const content = schedulerResponseEmail(notification);
      return this.deliver({
        from: `${notification.organizationName ?? config.MAIL_FROM_NAME} <${config.MAIL_FROM_ADDRESS}>`,
        to: notification.to, subject: content.subject, html: content.html, text: content.text,
      }, options);
    }
    if (isOperationalMessage(notification)) {
      const content = operationalMessageEmail(notification);
      return this.deliver({
        from: `${notification.organizationName} <${config.MAIL_FROM_ADDRESS}>`,
        to: notification.to, subject: content.subject, html: content.html, text: content.text,
        ...(notification.replyTo ? { replyTo: notification.replyTo } : {}),
      }, options);
    }
    if (isAvailabilityRequest(notification)) {
      const content = availabilityRequestEmail(notification);
      return this.deliver({
        from: `${notification.organizationName} <${config.MAIL_FROM_ADDRESS}>`,
        to: notification.to, subject: content.subject, html: content.html, text: content.text,
        ...(notification.replyTo ? { replyTo: notification.replyTo } : {}),
      }, options);
    }
    if (isServiceReminder(notification)) {
      const content = serviceReminderEmail(notification);
      return this.deliver({
        from: `${notification.organizationName} <${config.MAIL_FROM_ADDRESS}>`,
        to: notification.to, subject: content.subject, html: content.html, text: content.text,
        ...(notification.replyTo ? { replyTo: notification.replyTo } : {}),
      }, options);
    }
    const content = 'respondUrl' in notification ? scheduleEmail(notification) : invitationEmail(notification);
    const replyTo = 'respondUrl' in notification ? notification.schedulerEmail ?? undefined : undefined;
    const attachments = 'respondUrl' in notification && notification.ics
      ? [{ filename: 'assignment.ics', content: Buffer.from(notification.ics).toString('base64') }]
      : undefined;
    const { data, error } = await Promise.race([
      this.client.emails.send({
        from: `${'respondUrl' in notification ? notification.organizationName ?? config.MAIL_FROM_NAME : config.MAIL_FROM_NAME} <${config.MAIL_FROM_ADDRESS}>`,
        to: notification.to,
        subject: content.subject,
        html: content.html,
        text: content.text,
        ...(replyTo ? { replyTo } : {}),
        ...(attachments ? { attachments } : {}),
      }, options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined),
      timeout(SEND_TIMEOUT_MS),
    ]);
    if (error) throw classifyResendError(error);
    return { providerMessageId: data?.id ?? null };
  }

  private async deliver(
    message: { from: string; to: string; subject: string; html: string; text: string; replyTo?: string },
    options: EmailSendOptions = {},
  ): Promise<EmailSendReceipt> {
    const { data, error } = await Promise.race([
      this.client.emails.send(message, options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined),
      timeout(SEND_TIMEOUT_MS),
    ]);
    if (error) throw classifyResendError(error);
    return { providerMessageId: data?.id ?? null };
  }
}
