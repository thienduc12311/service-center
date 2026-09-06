# Calendar files use METHOD:PUBLISH, so the app owns the RSVP

An `.ics` carrying `METHOD:REQUEST` and an `ORGANIZER` makes Gmail and Outlook render
native Yes/No/Maybe buttons. Those buttons do not call our API — they send an iTIP reply
by email to the organizer address, which we would have to receive and parse to move an
assignment's status. We use `METHOD:PUBLISH` instead, so no native buttons appear and the
respond link in the email body is the only way to answer.

The alternative was worse than it looks: two Accept buttons in one email, where the more
prominent one silently fails to update the roster, is a data-integrity problem dressed as
a feature. Building inbound iTIP handling to fix that is a mail-receiving pipeline we do
not otherwise need.
