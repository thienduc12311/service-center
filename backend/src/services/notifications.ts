import type { EmailTransportMode } from '@service-center/shared';
import { config } from '../config.js';

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
  assignments?: Array<{ teamName: string | null; positionName: string | null }>;
  ics?: string;
}

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
  send(notification: ScheduleNotification): Promise<EmailSendReceipt>;
}

const consoleTransport: NotificationTransport = {
  mode: 'simulated',
  async send(notification) {
    if (!config.isTest) {
      console.info(`[notify] simulated email for "${notification.planTitle}" on ${notification.serviceDate}`);
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
