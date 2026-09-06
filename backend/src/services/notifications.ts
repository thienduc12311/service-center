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

/**
 * Delivery is intentionally pluggable. The default transport logs, which keeps
 * local development and tests free of external dependencies; swap in Resend,
 * Postmark or Supabase Auth emails by replacing `send`.
 */
export interface NotificationTransport {
  send(notification: ScheduleNotification): Promise<void>;
}

const consoleTransport: NotificationTransport = {
  async send(notification) {
    if (config.isTest) return;
    console.info(`[notify] schedule notification prepared for "${notification.planTitle}" on ${notification.serviceDate}`);
  },
};

let transport: NotificationTransport = consoleTransport;

export const setNotificationTransport = (next: NotificationTransport): void => {
  transport = next;
};

export const sendScheduleNotifications = async (
  notifications: ScheduleNotification[],
): Promise<number> => {
  const results = await Promise.allSettled(notifications.map((n) => transport.send(n)));
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length && !config.isTest) {
    console.warn(`[notify] ${failures.length} of ${notifications.length} notifications failed`);
  }
  return results.length - failures.length;
};

export const respondUrlFor = (token: string): string => `${config.APP_URL}/respond?token=${encodeURIComponent(token)}`;

export interface PersonInvitationNotification {
  to: string;
  personName: string;
  organizationName: string;
  acceptUrl: string;
}

/** Same pluggable-transport shape as schedule notifications, see above. */
export interface PersonInvitationTransport {
  send(notification: PersonInvitationNotification): Promise<void>;
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

export const sendPersonInvitation = (notification: PersonInvitationNotification): Promise<void> =>
  personInvitationTransport.send(notification);
