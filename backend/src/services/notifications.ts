import type { EmailTransportMode } from '@service-center/shared';
import { config } from '../config.js';

export interface ScheduleNotificationRole {
  teamName: string | null;
  positionName: string | null;
}

/** F08: one plan inside a consolidated message, with its own response action. */
export interface ScheduleNotificationPlan {
  planTitle: string;
  serviceDate: string;
  assignments: ScheduleNotificationRole[];
  /** Answers this plan only. */
  respondUrl: string;
}

export interface ScheduleNotification {
  to: string;
  personName: string | null;
  planTitle: string;
  serviceDate: string;
  teamName: string | null;
  positionName: string | null;
  respondUrl: string;
  organizationName?: string;
  schedulerEmail?: string | null;
  assignments?: ScheduleNotificationRole[];
  ics?: string;
  /** Set for a multi-plan release; each plan is answered separately. */
  plans?: ScheduleNotificationPlan[];
  /** A reminder for an unanswered request rather than the first request. */
  reminder?: boolean;
}

/** F08: "coming up" reminder for confirmed people; no response action. */
export interface ServiceReminderNotification {
  to: string;
  personName: string | null;
  organizationName: string;
  planTitle: string;
  serviceDate: string;
  /** The first time this person needs to be there, ISO instant. */
  firstTimeAt: string | null;
  firstTimeLabel: string | null;
  location: string | null;
  assignments: ScheduleNotificationRole[];
  planUrl: string;
  replyTo?: string | null;
}

/** F03: a leader asks someone to review their availability. */
export interface AvailabilityRequestNotification {
  to: string;
  personName: string | null;
  organizationName: string;
  message: string | null;
  windowStart: string;
  windowEnd: string;
  respondBy: string | null;
  /** Where to update availability (sign-in required). */
  availabilityUrl: string;
  replyTo?: string | null;
}

export type EmailNotification = ScheduleNotification | AvailabilityRequestNotification | ServiceReminderNotification;

/** Per-send options a transport may honor. */
export interface EmailSendOptions {
  /**
   * Stable across retries of one delivery (F08). With a deterministic link
   * token the payload is identical, so the provider can drop a duplicate.
   */
  idempotencyKey?: string;
}

export const isServiceReminder = (notification: object): notification is ServiceReminderNotification =>
  'planUrl' in notification;

export const isAvailabilityRequest = (notification: object): notification is AvailabilityRequestNotification =>
  'availabilityUrl' in notification;

/** What a provider told us after accepting an email. */
export interface EmailSendReceipt {
  providerMessageId: string | null;
}

/**
 * Delivery is intentionally pluggable. The default transport only logs, which
 * keeps local development and tests free of external dependencies; its mode
 * is `simulated`, so nothing reports a logged email as sent. A transport
 * signals failure by throwing a `DeliveryError` that says whether a retry can
 * help; anything else it throws is treated as an unexpected failure.
 */
export interface NotificationTransport {
  readonly mode: EmailTransportMode;
  send(notification: EmailNotification, options?: EmailSendOptions): Promise<EmailSendReceipt>;
}

const consoleTransport: NotificationTransport = {
  mode: 'simulated',
  async send(notification) {
    if (!config.isTest) {
      console.info(isAvailabilityRequest(notification)
        ? '[notify] simulated availability request email'
        : isServiceReminder(notification)
          ? `[notify] simulated service reminder for "${notification.planTitle}"`
          : `[notify] simulated email for "${notification.planTitle}" on ${notification.serviceDate}`);
    }
    return { providerMessageId: null };
  },
};

let transport: NotificationTransport = consoleTransport;

export const setNotificationTransport = (next: NotificationTransport): void => {
  transport = next;
};

export const emailTransport = (): NotificationTransport => transport;

export const respondUrlFor = (token: string): string => `${config.APP_URL}/respond?token=${encodeURIComponent(token)}`;

export interface PersonInvitationNotification {
  to: string;
  personName: string;
  organizationName: string;
  acceptUrl: string;
}

/** Same pluggable-transport shape as schedule notifications, see above. */
export interface PersonInvitationTransport {
  send(notification: PersonInvitationNotification): Promise<EmailSendReceipt | void>;
}

const consolePersonInvitationTransport: PersonInvitationTransport = {
  async send(notification) {
    if (config.isTest) return;
    console.info(`[invite] organization invitation prepared for ${notification.organizationName}`);
  },
};

let personInvitationTransport: PersonInvitationTransport = consolePersonInvitationTransport;

export const setPersonInvitationTransport = (next: PersonInvitationTransport): void => {
  personInvitationTransport = next;
};

export const sendPersonInvitation = async (notification: PersonInvitationNotification): Promise<void> => {
  await personInvitationTransport.send(notification);
};
