# Universal Links / App Links verification files

These two files let the mobile app register itself as the handler for
`https://<this domain>/accept-invite` links (so tapping an invite email link
opens the app instead of a browser, when installed). They must be served
byte-for-byte from `/.well-known/...` at whatever domain `APP_URL`
(`backend/.env`) points at — Vite copies this `public/` directory verbatim
into the build output, so no server config is needed beyond deploying it
normally, as long as the host doesn't rewrite or redirect `/.well-known/*`.

Both files currently contain placeholders and must be edited before
Universal/App Links will actually work — they only matter for a real native
build (EAS build / `expo prebuild`) against this real domain; local dev
(`expo start`) uses the `servicecenter://` custom scheme instead and needs
neither file.

## `apple-app-site-association`

Replace `REPLACE_WITH_APPLE_TEAM_ID` with your Apple Developer Team ID
(developer.apple.com → Membership → Team ID), so `appID` reads e.g.
`ABCDE12345.com.servicecenter.app`.

Also set `mobile/.env` (or your EAS build environment)'s `WEB_APP_DOMAIN` to
this domain (no protocol), which adds the matching `associatedDomains` entry
to the iOS build via `mobile/app.config.js`.

## `assetlinks.json`

Replace `REPLACE_WITH_ANDROID_SHA256_FINGERPRINT` with the SHA-256
certificate fingerprint of the key your Android build is signed with —
from `keytool -list -v -keystore <your-keystore>` or, if using EAS Build,
from `eas credentials`.

Same `WEB_APP_DOMAIN` env var also drives the Android `intentFilters` entry
in `mobile/app.config.js`.
