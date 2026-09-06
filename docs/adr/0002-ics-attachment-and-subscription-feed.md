# Reach external calendars with an .ics attachment plus a subscription feed, not OAuth

People want their assignments in Google, Apple, or Outlook Calendar. We do this two ways:
a per-assignment `.ics` attachment on the notification email, for the "add this one thing
now" moment; and a per-person subscribable schedule feed, for people who want their whole
schedule to live in their calendar and stay current without effort.

We rejected OAuth write access to the user's calendar. It is the only option that is both
instant and exact, and it alone can withdraw an event when someone declines — but it costs
per-provider consent screens, token refresh, and ongoing API maintenance, and Apple has no
comparable path, so a meaningful share of people would fall back to the other mechanisms
anyway.

## Consequences

Neither mechanism is instant. An attachment is a copy the recipient owns, so a changed
service time leaves them holding a stale event unless we re-send an event with the same
`UID` and an incremented `SEQUENCE`. Subscribed feeds refresh on the calendar provider's
own schedule, commonly 12–24 hours in Google's case, so the feed must never be the only
way someone learns about a last-minute change.
