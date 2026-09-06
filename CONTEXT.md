# Service Center

An organization schedules people onto its recurring services, plans what happens
at each one, and tells those people they are expected.

## Language

### Scheduling

**Plan**:
The record of a single occasion an organization runs — its date, its running
order, and who is scheduled onto it.
_Avoid_: Event, gathering

**Service**:
The occasion itself, as it happens in the world. A plan describes exactly one
service, which is why "the service" and "the plan" often refer to the same
thing from different angles.
_Avoid_: Meeting, session

**Rehearsal**:
A preparation slot attached to a plan, distinct from the service it prepares
for. A plan may have several, or none.
_Avoid_: Practice, run-through

**Service Type**:
A recurring category of service that carries its own default teams, such as
"Sunday Morning" or "Youth Night".
_Avoid_: Category, template

**Plan Item**:
One entry in a plan's running order — a song, a section header, or a free-form
item.
_Avoid_: Element, row

### People

**Person**:
Someone an organization keeps records for, whether or not they have ever signed
in. A person exists independently of any login.
_Avoid_: Contact, member record

**Profile**:
The account behind a person who has signed in. Not every person has one.
_Avoid_: User, login

**Team**:
A named group a person can be scheduled into for a service, such as "Band" or
"Hosts".
_Avoid_: Group, department

**Position**:
A specific role within a team, such as "Bass" or "Sound". Optional — a person
can be scheduled onto a team without one.
_Avoid_: Role, slot, seat

**Assignment**:
The record that a specific person is expected at a specific plan, on a specific
team. It carries their answer: unconfirmed until they reply, then confirmed or
declined.
_Avoid_: Booking, shift, invitation

**Invitation**:
A one-time, expiring offer for a person to create a login and join an
organization. Strictly about joining the organization — never about being asked
to serve at a service, which is an Assignment.
_Avoid_: Invite (as a verb for scheduling someone)

**Blockout**:
A window a person has declared themselves unavailable, used to warn schedulers
before they assign someone.
_Avoid_: Time off, unavailability, PTO

### Notification

**Notifying**:
Telling an assigned person they are expected, and asking them to confirm or
decline. Distinct from inviting, which is about joining the organization.
_Avoid_: Inviting, requesting

**Respond Link**:
The single-use link in a notification that lets a person confirm or decline one
assignment.
_Avoid_: Accept link, RSVP link

**Schedule Feed**:
A per-person subscribable calendar covering all of that person's assignments,
which their own calendar application keeps up to date.
_Avoid_: Calendar export, sync
