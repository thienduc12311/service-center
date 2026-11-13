# App Store submission

Everything needed to submit the iOS app (Service Center) for App Review: the
reviewer demo account, the App Review Information fields, and the product page
copy for App Store Connect.

## 1. Create the reviewer demo account

`supabase/demo/app-store-review.sql` creates a sign-in account for Apple's
reviewers. It owns an isolated **Demo Community Church** organization with
teams, four public-domain hymns (one with a chord chart), and the next four
Sunday plans. The reviewer leads worship: they're confirmed for the first
Sunday and have **pending requests** for the others, so they can try accepting
or declining.

The script is safe to re-run. It resets the password, re-confirms the email,
keeps the reviewer an active owner, and adds plans for upcoming Sundays that
don't exist yet. It never deletes anything, and it only touches rows that
belong to the demo organization. The four teammates (`appreview.*@example.com`)
can't sign in because each gets a random password that is thrown away.

The script is a single statement with two placeholders, `__REVIEWER_EMAIL__`
and `__REVIEWER_PASSWORD__`. Fill them into a temporary copy so the password
never lands in the repo, and run the copy against the linked project
(`supabase link` once, if this checkout isn't linked yet):

```bash
f=$(mktemp) && sed -e 's/__REVIEWER_EMAIL__/appreview@yourdomain.com/' -e 's/__REVIEWER_PASSWORD__/choose-a-strong-password/' supabase/demo/app-store-review.sql > "$f" && supabase db query --linked -f "$f"; rm -f "$f"
```

It prints `DO` on success. The password must be at least 8 characters, and it
can't contain `'`, `/` or `&` (those break the substitution). You can also paste
the substituted SQL into the dashboard's SQL Editor and run it there.

Before you submit, sign in on a TestFlight build with those credentials and
check that the plans show up.

**Re-run the script before each resubmission.** Plans are generated relative
to today, so if a review happens weeks later the reviewer would otherwise see
only past services.

## 2. App Review Information (App Store Connect → version → App Review)

- **Sign-in required**: checked
- **User name**: the `reviewer_email` you used
- **Password**: the `reviewer_password` you used
- **Notes**:

> Service Center helps churches plan worship services and schedule volunteer
> teams. The demo account is the owner of a sample organization, "Demo
> Community Church", which has upcoming Sunday services already planned.
>
> To try the main features:
> 1. Home / Plans: open an upcoming Sunday to see the order of service, songs,
>    times, and the scheduled team.
> 2. Open a song in a plan (e.g. "Amazing Grace") to view its chord chart.
> 3. Inbox: accept or decline a pending request to serve on a later Sunday.
> 4. Calendar: see upcoming services; Songs: browse the song library.
>
> Camera and photo library access are only requested when importing a photo of
> a chord sheet (Songs → import). All song content in the demo is in the
> public domain.

## 3. Product page copy (English U.S.)

### Promotional text (170 max)

```text
Plan every service, schedule your teams, and keep chord charts in everyone's pocket. Accept serving requests, block out dates, and rehearse the set — all in one place.
```

### Description (4,000 max)

```text
Service Center brings your whole worship team onto the same page. Plan services, schedule volunteers, and share songs and chord charts. Everyone sees what they need, wherever they are.

PLAN SERVICES
• Build each service's order: songs, headers, announcements, sermon and more
• Set rehearsal, soundcheck and service times
• Start new plans from reusable templates
• Add notes for the whole team or for a single item

SCHEDULE YOUR TEAMS
• Organize teams and positions: worship band, production, hospitality and more
• Send serving requests that volunteers can accept or decline from their phone
• Spot conflicts and blockout dates before you schedule
• Fill open spots with sign-ups and replacement requests

SONGS & CHORD CHARTS
• Keep a shared song library with keys, tempo, meter and themes
• View clean, readable chord charts for every arrangement
• Import a chord sheet from a photo
• Download plans for offline use at rehearsal

STAY CONNECTED
• Get notified when you're scheduled or a plan changes
• Message your team and chat about a service
• Subscribe to your serving schedule in your calendar app
• See your schedule across every organization you serve with

FOR VOLUNTEERS
See when you're serving, respond to requests, block out the dates you're away, and show up prepared with the setlist and charts already on your phone.

FOR LEADERS AND ADMINS
Manage people, teams and permissions, track responses at a glance, and keep every service on schedule.

Available in English and Vietnamese.
```

### Keywords (100 max, comma-separated, no spaces)

```text
worship,church,setlist,chord,chords,volunteer,schedule,roster,band,songs,planning,rehearsal,ministry
```

Leave the app name out of the keywords; Apple indexes the name already.

### Also required on this page

- **Screenshots**: at least one set for 6.9" iPhone (1320 × 2868), plus 13"
  iPad (2064 × 2752) because `supportsTablet` is on. Take them while signed in
  as the demo account so they show the demo data.
- **Support URL** and **Privacy Policy URL** (required).
- **Header asset** (the empty drop zone at the top) is optional.
