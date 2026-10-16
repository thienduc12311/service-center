import { config } from '../config.js';
import { ResendTransport } from '../services/email/resend-transport.js';
import { setNotificationTransport, setPersonInvitationTransport } from '../services/notifications.js';

/**
 * Chooses real providers when they are configured. Every entry point (the
 * long-lived server, the Vercel function, the worker CLI) calls this once,
 * so a delivery is sent the same way whichever of them runs it.
 */
export const configureTransports = (): void => {
  if (config.RESEND_API_KEY) {
    const resendTransport = new ResendTransport(config.RESEND_API_KEY);
    setNotificationTransport(resendTransport);
    setPersonInvitationTransport(resendTransport);
  }
};
