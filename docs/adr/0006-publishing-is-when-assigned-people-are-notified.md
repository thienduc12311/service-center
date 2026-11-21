# Publishing a plan is when the people on it are notified

Until now `plans.status` had no effect on email: an assignment request went out the moment
someone was scheduled, whether the plan was a draft or published, and publishing only fired the
`plan.published` webhook. Schedulers build a plan over days, so people were asked about plans
that were still changing, and nobody heard anything when the plan was actually ready.

We make publishing the moment people are asked:

- **Draft plans are quiet.** No assignment email is sent for a draft plan: requests, pending
  reminders, "coming up" reminders and time-change re-notifies. The dispatcher checks the plan's
  status when it sends, not only when it queues, so a plan moved back to draft also stops what
  is already queued. Archived plans never send.
- **The server ignores `notify` on a draft.** Every client (web, mobile, the developer API)
  gets the same rule; the scheduling UI replaces the checkbox with "People will be notified when
  this plan is published".
- **Publishing asks everyone released and not yet notified** (`notified_at is null`), as one
  request email per person, the same email and respond link as today. Prepared requests stay
  prepared; releasing one on a draft marks it released but sends nothing until publish, and a
  multi-plan release leaves draft plans out of its email.
- **Publishing is a plan-level act.** Anyone who can edit the plan can publish it, and
  publishing asks everyone released on it, whatever teams the publisher can schedule. Replies
  still go to each assignment's response owner.
- **Re-publishing never re-asks.** Unpublish → publish only reaches people never notified.
  Changes to times keep their own re-notify path.
- **Past plans send nothing.** A plan whose service date (in the organization's time zone) has
  passed is published silently; its respond links would expire at once anyway (ADR-0001).
- **Publishing can be quiet.** The publish confirmation shows who will be emailed and who has
  no address, with "Notify people" ticked by default.

Considered and rejected:

- **A separate "plan published" announcement** on top of the request sent at scheduling time:
  two emails per person per service, and the first one still arrives while the plan is a draft.
- **Publishing releases every prepared request.** It would merge two decisions that schedulers
  make separately: "this plan is ready" and "this person is the one we're asking".
- **Auto-publishing existing drafts at rollout.** It would change data, fire a burst of webhooks
  and could expose plans with public sharing set up. Instead, draft plans show schedulers a
  banner — "Draft — people you schedule won't be notified until you publish" — and the change
  is announced in the release notes.

Consequences: "draft" is now a third way to hold requests back, next to "prepared" (per
request) and a scheduled release (per batch). The mobile app gets a Publish action, since a
scheduler who can only schedule from a phone would otherwise have no way to send anything.
