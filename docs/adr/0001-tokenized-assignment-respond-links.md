# Tokenized respond links for assignments

Confirming or declining an assignment normally requires a signed-in session, because
row-level security is what scopes a person to their own assignment. Notification emails
instead carry a single-use token, so a person can respond in one tap without hitting a
login wall — the drop-off there is severe enough on mobile that a login-gated response
effectively means no response. The token expires, and anyone holding the link can answer
on that person's behalf, which we accept for scheduling but would not for anything
carrying real consequence.

The token is scoped to **one person on one plan**, not to a single assignment. A person
can hold several assignments on the same service (bass in Band, plus a Sound position),
and we send them one email covering all of it; one answer settles every assignment that
email described. Splitting the token per assignment would mean two emails for one Sunday
morning and half-answered plans nobody looks at.

## Consequences

There is now an unauthenticated write path into `assignments`. It must stay narrow: one
person, one plan, expiring, confirm-or-decline only, and never a means to read plan or
person detail beyond what the email already disclosed. Because one token now moves several
rows, the respond handler must update them as a set.
