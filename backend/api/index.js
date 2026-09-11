/**
 * Vercel entrypoint. `backend/src/index.ts` is the long-lived-server entrypoint
 * (Docker, local dev) and is not used here: Vercel invokes this module per
 * request and never calls `listen()`. Anything `src/index.ts` wires up at boot
 * has to be wired up here too.
 *
 * The imports point at `../dist` — the compiled output of `npm run build -w
 * @service-center/backend`, which `buildCommand` in `vercel.json` produces
 * before this function is bundled. `backend/tsconfig.json` only includes `src`,
 * so this file is never fed through `tsc`.
 */
import { createApp } from '../dist/app.js';
import { config } from '../dist/config.js';
import { ResendTransport } from '../dist/services/email/resend-transport.js';
import {
  setNotificationTransport,
  setPersonInvitationTransport,
} from '../dist/services/notifications.js';

if (config.RESEND_API_KEY) {
  const resendTransport = new ResendTransport(config.RESEND_API_KEY);
  setNotificationTransport(resendTransport);
  setPersonInvitationTransport(resendTransport);
}

// An Express app is itself an (req, res) handler, which is what Vercel expects.
export default createApp();
