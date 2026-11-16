import { config } from '../config.js';

/**
 * Emails about the platform itself (church applications), sent straight to
 * the provider: the delivery outbox belongs to a church, and these have none.
 * Best effort: a failed email never undoes the action that caused it.
 */

/** One rendered platform email. */
export interface PlatformEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface PlatformEmailTransport {
  send(email: PlatformEmail): Promise<void>;
}

const consolePlatformEmailTransport: PlatformEmailTransport = {
  async send(email) {
    if (config.isTest) return;
    // Subject only: recipients and bodies carry personal data.
    console.info(`[platform-email] simulated: ${email.subject}`);
  },
};

let platformEmailTransport: PlatformEmailTransport = consolePlatformEmailTransport;

export const setPlatformEmailTransport = (next: PlatformEmailTransport): void => {
  platformEmailTransport = next;
};

/** Sends each email; a failure is logged and the rest still go. */
export const sendPlatformEmails = async (emails: readonly PlatformEmail[]): Promise<void> => {
  const results = await Promise.allSettled(emails.map((email) => platformEmailTransport.send(email)));
  for (const result of results) {
    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : 'unknown error';
      console.error(`[platform-email] sending failed: ${reason}`);
    }
  }
};
