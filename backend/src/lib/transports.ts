import { config } from '../config.js';
import { ResendTransport } from '../services/email/resend-transport.js';
import { setNotificationTransport, setPersonInvitationTransport } from '../services/notifications.js';
import { ResendPlatformEmailTransport } from '../services/email/resend-platform-transport.js';
import { setPlatformEmailTransport } from '../services/platform-email.js';

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
    setPlatformEmailTransport(new ResendPlatformEmailTransport(config.RESEND_API_KEY));
  }
};
