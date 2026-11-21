# Mention emails are delayed, skipped if read, and collapsed per thread

Mentions in team/plan chat and in plan item discussions reached people only in the app and by
push. Volunteers who rarely open the app missed being asked something directly. We now email a
mention, but email is the noisiest channel we have, so it is held to a narrow rule:

- **Only mentions are emailed.** Ordinary messages and replies stay in-app and push. The same
  rule applies to chat (`conversation_message_mentions`) and item discussions
  (`plan_item_comment_mentions`), with one shared template.
- **Delayed and skipped if read.** The email delivery is queued about 10 minutes out. At send
  time it is cancelled if the person has seen the mention — for a chat, their read position
  (`conversation_member_states.last_read_at`) is at or past the message, or they marked its feed
  row read; for an item discussion, which has no read position, they marked the mention's feed
  row read (`notifications.read_at`) — if they muted the chat, or if the usual checks
  fail (still a participant, the message not deleted or hidden, still an active member, not
  blocked by the author). If they are in the app, the push or in-app notice already did the job.
- **Collapsed per thread.** While a mention email for a person and a thread is still queued, a
  further mention there does not queue another; the one email shows the latest excerpt and "and
  N more mentions".
- **Content.** The author's name, where it happened (team or plan name, or item title), an
  excerpt of up to 280 characters and a sign-in link to the thread. The excerpt is acceptable in
  email because the recipient can read the thread (rechecked at send time). Push stays generic.
  People without a login (`no_login`) are not emailed: they could not open the thread.
- **Opt-out.** A personal "Email me when I'm @mentioned" setting, on by default, stored as
  `person_reminder_preferences.mention_email`; the settings section becomes "Notification
  preferences".

**Without a worker the delay is dropped, not the email.** The delay needs the scheduled worker
(ADR-0004) to run later. The API decides the delay when it posts the message: 10 minutes when
`CRON_SECRET` is configured, none otherwise, so the email goes out during the same request as
the push and the read check is skipped. Whether the worker is configured can change when a
mention email arrives, never whether it arrives. In that mode each mention is its own email; the
existing 20-messages-per-minute author limit bounds it.

Considered and rejected: emailing every chat message (a busy team chat would bury people), and a
daily digest (too late for "can you bring the capo tomorrow?").
