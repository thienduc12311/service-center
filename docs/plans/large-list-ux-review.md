# Large-list UX review

**Date:** 2026-11-21
**Scope:** web (`frontend/`) and mobile (`mobile/`), every place where the user browses, searches, filters or picks data whose volume grows with the church: songs, people, teams and positions, plans, templates, media, messages, notifications.
**Sizing assumption:** 100–300 songs, 200–500 people, 20–40 teams, 2–4 services a week, a few hundred media items, years of messages and notifications.

---

## 1. Summary

The browse screens are mostly in good shape. The mobile song library, the people list and the plans list are paged and searched on the server. The trouble is in the **pickers inside workflows**, where scale problems hurt most because the user is mid-task. Plan building is the worst case.

Main findings:

1. **Adding songs to a plan has no browsing at all.** The web "Add item" modal (`frontend/src/components/plan/AddItemModal.tsx`):
   - Shows the first 20 title matches, with no count and no "more" link.
   - Searches the title only.
   - Has no filters, even though the API already supports key, theme, type, style, speed, author and scheduled-date filters.
   - Doesn't show "last used", even though the API already returns `last_scheduled_at`.
   - Doesn't mark songs already in the plan.
   - Closes after each song, so a 5-song set means opening it 5 times.

   Mobile has the same shape (`mobile/app/plan/add-item/[id].tsx`): it fetches 100 songs, shows 30, and isn't debounced.
2. **Search doesn't ignore accents on the server.** Song search is `title ilike '%q%'` (`supabase/migrations/20261101000000_f15_song_curation.sql`, `list_curated_songs`). People, media and the staffing matrix use `ilike` or `lower()` too. A Vietnamese congregation typing `chua` won't find *Chúa*. Only the client-side filters (`frontend/src/lib/search.ts`) fold accents.
3. **People pickers download the whole roster and list everyone.** This happens in:
   - Schedule People (web and mobile)
   - Edit item → leader (a native `<select>` of every person)
   - Teams → Add member (no search; picking a position in a row's `<select>` adds that person immediately)
   - Opportunity → offer a replacement (native `<select>`)
   - Mobile compose and handoff lists

   A good component already exists, `settings/MemberCombobox.tsx`, but only `ScopeAccessEditor` uses it.
4. **Some lists hide data without saying so:**
   - Messages: only the newest 30, with no "load more" (web and mobile).
   - Media: capped at 200 by title, and archived items are removed *after* the cap.
   - Staffing matrix: people sorted by UUID, and an error once 8 weeks holds more than 12 plans.
   - Reports: the "truncated" notice is buried in grey text.
   - Join requests: "Recent (20)" reads like a total.
5. **No shared list tooling.** There's no debounce hook (it's copied by hand in two places), filter state never lives in the URL, and there's no pagination or "x of y" component. Each screen invents its own, and most leave it out.

The rest of this document gives a decision rule for choosing controls (§2), a redesign of the plan-building flow (§3), app-wide findings ranked by severity (§4), backend prerequisites (§5) and a phased plan (§6).

---

## 2. Choosing a control by how big the list can get

Pick the control by the **largest the list can realistically get**, not by how big it is in seed data.

| List size, realistically | Examples | Control |
|---|---|---|
| Fixed, ≤ 6 | segment, leader mode, visibility, capo | Segmented buttons or radios |
| Fixed, 7–30 | musical key, style, speed, roles | Native `<select>` (fine; the OS handles it) |
| Org data, ≤ ~15 | service types, arrangements of one song, plan times | Native `<select>` or radio cards. Show detail (key, sequence) when it helps choose |
| Org data, 15–100 | teams, positions, templates, folders, tags | **Searchable select**: a combobox with type-to-filter, grouping (e.g. positions by team) and the most likely options first |
| Unbounded entities | people, songs, media, past plans | **Server-searched combobox** for a single pick inside a form. A **browse panel** when the user compares, filters or picks several |
| Browse page | Songs, People, Plans, Media, Messages | Server-paged list, filters in the URL, honest counts, "load more" or a pager, bulk select across pages |

These rules apply to every list, whatever control it uses:

- **Show the likely answers before the user types.** An empty search box is wasted space. Show recent, frequent or contextual options (people already on this plan, songs in this service type's rotation).
- **Search is forgiving.** Ignore accents and case, match several words (`amazing grace` → *Amazing Grace (My Chains…)*), and search the secondary fields (author, CCLI, email).
- **Search is calm.** Debounce by 200–300 ms and keep the previous results on screen while the next request loads (`placeholderData`). Never flash "No matches" or a skeleton on each keystroke.
- **Be honest about counts.** Every capped list says "Showing 20 of 143" and offers a way to see more or to narrow it down.
- **Mark state on each row.** Already in this plan, blocked out, already scheduled, archived. The user shouldn't have to pick something to find out it was a bad choice.
- **Selection stays visible.** In a multi-select, picked items sit in a tray or as pinned chips, so they don't vanish when the filter changes.
- **Keyboard-first on web.** ↑/↓/Enter/Esc and focus that stays in the search field. `MemberCombobox` already does this; generalize it.
- **Virtualize only past roughly 200 rendered rows.** Searching and capping should usually keep lists short; virtualization is the fallback, not the fix. On mobile, always use `FlatList` instead of `ScrollView` + `.map` for lists that come from data.

---

## 3. Plan-building flow, redesigned

### 3.1 Adding songs: replace the modal with a song browser panel

**Today.** "Add item" opens a modal with a type toggle, a search box, 20 results and a key select. Each Add closes the modal and appends the song at the end of the order.

**Proposed.** "Add songs" opens a **side panel** (a right-hand drawer on desktop, a full-height sheet on mobile). The order stays visible next to it, so the planner sees the set taking shape and what's already in it.

```
┌ Order ─────────────────────────────┐┌ Add songs ─────────────────────────── ✕ ┐
│ 1  Welcome              header     ││ 🔍 Search title, author, CCLI…          │
│ 2  ▶ Great Are You Lord    G      ││ [Key ▾] [Tempo ▾] [Theme ▾] [Type ▾]     │
│ 3  ▶ Build My Life         Bb      ││ [ ] Hide songs used in last 3 weeks      │
│ ┄┄┄ inserting here ┄┄┄┄┄┄┄┄┄┄┄┄┄  ││ ─────────────────────────────────────── │
│ 4  Sermon                          ││ Suggested · Recently added · All A–Z     │
│ 5  ▶ Doxology              G       ││                                          │
│                                    ││ Goodness of God         Ab · 63 bpm      │
│                                    ││   Bethel · used 5× · last 2 wks ago  [+] │
│                                    ││ Build My Life           Bb · 68 bpm      │
│                                    ││   Housefires · ✓ in this plan       [✓]  │
│                                    ││ Chúa Là Tình Yêu        D  · 72 bpm      │
│                                    ││   last used 4 months ago             [+] │
│                                    ││ …                                        │
│                                    ││ Showing 20 of 143 · Show more            │
└────────────────────────────────────┘└──────────────────────────────────────────┘
```

**What it does:**

- **The default view answers "what do we usually sing?"** It has three tabs:
  - **Suggested** (default): songs used with this service type in the last ~12 weeks, most used first. This is the church's rotation.
  - **Recently added**: new songs that are easy to forget.
  - **All A–Z**.
- **Search:**
  - Matches title, author, CCLI number and first lyric line.
  - Ignores accents (§5.1).
  - Debounced, and keeps the previous results on screen while loading.
- **Filters as chips:** key, tempo (speed or a BPM range), theme, type. These map 1:1 to `listSongsQuerySchema`, which already supports them. "Hide songs used in the last N weeks" uses `scheduled_from`/`scheduled_to` or a new `not_scheduled_since` parameter (§5.2).
- **Each row shows what the decision needs:**
  - Default key and BPM.
  - Author.
  - Times used and "last used 2 weeks ago" (`last_scheduled_at` is already in the payload).
  - A **"✓ in this plan"** badge.
  - A soft warning for songs used in the last 1–2 weeks.
- **Adding:**
  - Clicking **[+]** adds the song with its default arrangement and key. The panel **stays open**, the row flips to ✓, and an "Added *Goodness of God* · Undo" toast appears.
  - Several songs can be added in one visit, and Enter adds the highlighted row.
- **Insert point:**
  - Songs go in where the planner chose: a "+" button between items in the order opens the panel with that insert point set (the ┄ line).
  - Opened from the header button, songs go at the end.
  - This removes the "move it up 6 times" chore (on mobile, reordering is one step per tap and one request per step).
- **Preview without leaving the panel:** expanding a row shows arrangements (name, key, sequence) and the first lines of the chart. Choosing an arrangement or key there is optional. The default path stays one click, and Edit item handles fine-tuning.
- **Other item types:** headers and free-text items stay as a quick inline "Add header / Add item" input at the insert point. They don't need a modal at all.

**Why a panel and not a better modal:** a modal hides the order, which is exactly the context needed to choose the next song (key flow, tempo flow, what's already in). A panel also makes adding several songs feel natural.

**Mobile:** the same structure as a full-screen route:
- A `FlatList` with infinite scroll.
- Filters in a sticky horizontal chip row, with Suggested as the default.
- The same [+] behaviour and a running "3 added" counter in the header.
- "Done" returns to the order.

### 3.2 Edit item

- **Change song:** reuse the song browser's search and list component in a compact form. Today it's a 20-result, title-only list with no author or key.
- **Arrangement:** the native `<select>` is fine; a song has few arrangements. When there are ≤ 4, prefer radio cards showing key and sequence, so the difference is visible without opening anything.
- **Labeled key:** fine as a select.
- **Leader → person:**
  - Replace the full-roster `<select>` with `MemberCombobox`.
  - Before the user types, show **people assigned to this plan** first ("On this plan"), then everyone.
  - Mobile caps at 30 chips with a filter; use the same rule.
- **Leader → position:**
  - Use a searchable select **grouped by team**, with positions staffed on this plan first.
  - Mobile currently shows every position of every team as ungrouped chips.

### 3.3 Schedule people

This is the second most important flow after adding songs.

- **Team and position:**
  - Team: a searchable select once the org has more than about 10 teams.
  - Position: chips when the team has ≤ 8 positions, a select otherwise. Plan-only positions are already grouped; keep that.
- **The people list:**
  - **Scope toggle:** "Team members (12) | Everyone (340)", defaulting to team members. Today it's everyone, with team members sorted first, which is a 340-row scroll.
  - **Server-side search** through `listPeoplePage` (with a `team_id` filter, §5.3) instead of downloading the whole roster.
  - **Status on each row, before selecting:**
    - Blocked out
    - Already on this plan
    - Declined last time
    - Last served
    - No login

    Conflicts are only checked after a person is ticked today (`checkAssignmentConflicts`). A cheap per-row availability summary for the plan's dates lets the scheduler skip bad choices instead of finding them afterwards.
  - **Sort options:** "Least recently served" (fairness), A–Z, "Available first".
  - **Selected people** are pinned as chips above the list and stay visible when the search changes.
  - **Mobile** (`mobile/app/plan/schedule/[id].tsx`) renders the whole roster in a `ScrollView`. Move it to a `FlatList` with the same toggle and server search.

### 3.4 Templates, importing from a past plan, creating a plan

- **Apply template:**
  - The template `<select>` is fine at ≤ 15 templates. Group it by service type, with the plan's own type first. Add a filter once it passes about 15.
  - Replace the "Put items: after *item*" `<select>`, which has one option per plan item, with the same insert point as §3.1.
- **Import from a past plan:**
  - Today it's the last 25 plans of the same service type, with no search and no way to reach older ones.
  - Add search by title or date, "Show more", and a "same service type only" toggle. Picking "Easter last year" is the main reason to import.
- **Generate plans:** group the template list by service type (web `<select>` and mobile chips).
- **Create plan:** the service-type `<select>` is fine. No change.

---

## 4. App-wide findings, ranked

Severity:
- **S1:** data hidden or wrong at scale.
- **S2:** a workflow becomes painful.
- **S3:** polish.

Paths are relative to the repo root.

### 4.1 Pickers (web)

| Sev | Where | Problem | Proposal |
|---|---|---|---|
| S1 | `frontend/src/components/plan/AddItemModal.tsx` | Covered in §3.1. | Song browser panel. |
| S2 | `frontend/src/pages/TeamsPage.tsx:354` Add member | Every person in the org listed with no search. Changing a row's position `<select>` adds that person **immediately**, so scrolling or using the keyboard can add someone by accident. | `MemberCombobox` (multi) with position chips and an explicit Add button. Exclude current members. |
| S2 | `frontend/src/components/plan/EditItemModal.tsx:300` leader person | Native `<select>` over the full roster. | `MemberCombobox`, with people on the plan first. |
| S2 | `frontend/src/components/plan/OpportunityPanel.tsx:122` offer candidate | Native `<select>` over the full roster. | `MemberCombobox`, with team or position members first and availability shown. |
| S2 | `frontend/src/components/plan/SchedulePeopleModal.tsx` | Covered in §3.3. | Scope toggle, row status, server search. |
| S2 | `frontend/src/components/plan/ImportTemplateModal.tsx` | 25 most recent plans only. | Search plus "Show more". |
| S2 | `frontend/src/pages/MediaPage.tsx:280` thumbnail | `<select>` of image titles (up to 200). | Thumbnail grid picker with search. |
| S3 | `frontend/src/components/settings/ScheduleHelp.tsx:96` delegate | `<select>` over people. | `MemberCombobox`. |
| S3 | `frontend/src/components/scheduling/RotationEditor.tsx:143` | One `<select>` per week × position. An 8-week, 10-position rotation is 80 selects. Each one only lists that position's members, so each is small. | Fine for now. Later, a grid where clicking a cell opens a small popover picker. |
| S3 | Reports, Calendar and Staffing-matrix team / service-type filters | Single-value `<select>`s. | A searchable multi-select filter once there are more than about 15 teams. The matrix filter state already allows several. |
| OK | Key, capo, style, speed, segment, roles, policies, gender, file category | Fixed vocabularies. | Keep native selects. |

### 4.2 Pickers (mobile)

| Sev | Where | Problem | Proposal |
|---|---|---|---|
| S1 | `mobile/app/plan/schedule/[id].tsx:326` | Full roster in a `ScrollView`. | `FlatList`, server search, team-members toggle (§3.3). |
| S1 | `mobile/app/messages/compose.tsx:326, 546` | Every recipient in a `ScrollView`; text handoff downloads the full roster. | Collapse to "142 recipients · Review", with search and select-all behind it. |
| S2 | `mobile/app/plan/add-item/[id].tsx:75,169` | Fetches 100, shows 30 with no hint. Not debounced, no `placeholderData`, so the list blanks on each keystroke. One song per trip. | Song browser (§3.1). |
| S2 | `mobile/app/plan/edit-item/[id].tsx:283,452` | Change-song search not debounced and title-only. Position chips ungrouped. | Shared song search. Positions grouped by team. |
| S2 | `mobile/src/components/PlanOrder.tsx:168` | Reorder is up/down, one request per step. | Drag to reorder, or "Move to…". Insert-at on add (§3.1) removes most of the need. |
| S2 | `mobile/app/teams/[id].tsx:66` add member | Full roster, filtered on device, one person per Add. | `listPeoplePage` with `q`, multi-select. |
| S2 | `mobile/app/plan/media/[id].tsx:166` | Up to 200 rows in a `ScrollView`, cap not mentioned. | `FlatList` and a "refine your search" hint at the cap. |
| S3 | Template, team and service-type chip rows: `apply-template`, `generate`, `schedule-report`, `ChatList`, compose, note audience, `AudiencePicker` | Chip walls that wrap with no search. | Above about 12 options, switch to a searchable sheet list grouped by service type or team. |
| S3 | `mobile/src/components/mentions.tsx:160` | Empty `@` renders every candidate. | Cap at about 20, people in the conversation first. |
| S3 | `mobile/app/people/[id].tsx:62` | Downloads the entire roster, archived included, to show one person. | Read the row from `getPerson`. |

### 4.3 Browse pages and panels

| Sev | Where | Problem | Proposal |
|---|---|---|---|
| S1 | Messages: `frontend/src/pages/MessagesPage.tsx:62`, `mobile/src/components/MessageList.tsx:35` | Only the newest 30, ever. | `useInfiniteQuery` on the existing `before` cursor. Add search. |
| S1 | Media: `backend/src/services/media.ts:58` | `limit 200` by title. Archived removed after the cap. Usage counted from at most 4000 rows. No hint in the UI. | Archived filter in SQL, cursor paging, usage counted in SQL, "x of y". |
| S1 | Staffing matrix: `backend/src/services/staffing-matrix.ts:137`, `frontend/src/pages/StaffingMatrixPage.tsx:23` | People ordered by `id` (looks random). The default 8-week window errors once there are more than 12 plans. Forward-only paging. Search not debounced. | Order by `sort_name`. Default to "next 12 plans" and page through plan columns. Add Previous. Debounce. |
| S1 | Chat thread: `frontend/src/pages/ChatPage.tsx:112` | Search not debounced, flashes "No matches". No "load older". Quotes of older messages disappear. | Debounce plus `placeholderData`. "Load older" with `before`. Inverted `FlatList` on mobile. |
| S2 | Teams: `frontend/src/pages/TeamsPage.tsx:142` | Every team with every member expanded. Thousands of rows at 30 × 40. | Collapsed team cards (name, member count, open needs) with search across teams and members. Expand one at a time, or open a team detail route. |
| S2 | Songs: `frontend/src/pages/SongsPage.tsx` | Not debounced. State not in the URL, so Back loses filters. "Page N" with no total. Selection clears on page change, no select-all. | URL state, debounce, "Page N of M", select-all on the page and across all matches (bulk edit is already capped server-side at 100). |
| S2 | Plans: `frontend/src/pages/PlansPage.tsx:52` | No search (no `q` in the API). The API supports a service-type filter but the UI doesn't. Flat list. | Service-type filter, month headers, `q`, URL state. Consider a compact table view for admins. |
| S2 | People: `frontend/src/pages/PeoplePage.tsx` | No total. No team, tag, role or login filters. No select-all. Hidden selections stay active after the search changes. | `total` in `RosterPersonPage`, filter chips (team, tag, has-login, role), select-all, selection tray. |
| S2 | Plan Teams tab: `frontend/src/components/plan/TeamsTab.tsx` | Team → position → assignment fully expanded for every team. | Collapsible teams with a status summary ("3/5 confirmed"). "Only gaps" filter (unfilled or declined). |
| S2 | Reports: `frontend/src/pages/ReportsPage.tsx:287` | Up to 2000 rows, no column sort, truncation buried. Exports counter shows a capped count as the total. | Warning banner when truncated, column sort, "show all" for follow-ups. |
| S2 | Calendar: `frontend/src/pages/CalendarPage.tsx:231,253` | Layer events cut to 2 silently. "+N more" isn't clickable. Agenda has no day headers. | Clickable "+N" opens the day. Agenda grouped by day. Month in the URL. |
| S2 | Attendance tab (web) and attendance sheet (mobile) | One flat list of everyone. | Group by team, search, status filter. |
| S3 | Notifications | The API supports `unread_only`, but there's no toggle. No day grouping. | Unread/All toggle, day headers. |
| S3 | Templates page | No search or grouping. | Group by service type and kind, plus a client-side filter. |
| S3 | Person page history | Capped at 50 with no hint. No serving history. | "Load older". Add a "Serving history" section, which is also what a scheduler wants when choosing people. |
| S3 | Song schedule panel | At most 12 entries, no total. | "Played N times · last on …", "Show all". |
| S3 | Plan files tab | One "No files" row per item for long orders. | "Only items with files" toggle. |
| S3 | Join requests "Recent (20)" | The 20 is a cap, not a total. | Label it "Latest 20". |
| S3 | Global search "More matches" | Leads nowhere. | Link to the list page with `?q=` once list pages read URL state. |
| OK | Mobile song library, people list, plans tab, notifications, chat list | Paged, searched, `FlatList`. | Keep, and copy them elsewhere. Web `AccessSettings.tsx:105` is a good web reference (search, tabs with counts, "x of y", show more). |

---

## 5. Backend and data prerequisites

Database changes must follow `.agents/skills/supabase-postgres-best-practices/` (CLAUDE.md rule 11) and ship as new migrations.

### 5.1 Search that ignores accents

- Enable `unaccent` and `pg_trgm`. Postgres's `unaccent()` isn't `IMMUTABLE`, so add an immutable wrapper, e.g. `private.search_fold(text)`, that also maps `đ`→`d` to match `foldForSearch`.
- Add a generated `search_text` column with a GIN trigram index:
  - `songs`: title, author, CCLI, first lyric line.
  - `people`: name and email.
  - `media`: title.
- Change the search clauses in `list_curated_songs`, `people-page.ts`, `media.ts` and `staffing-matrix.ts` to use it.
- Split the query into words and AND them together, so search behaves like `matchesSearch` on the client.
- Escape `%` and `_` in `q`. `list_curated_songs` concatenates `q` straight into the `ilike` pattern today.

### 5.2 Songs list, for the browser panel

- New sorts: `last_used` and `most_used`, scoped to a service type when one is passed.
- `not_scheduled_since` (date), plus `usage_count` in the row payload.
- An `in_plan` flag (or `plan_id` input) so rows can show "✓ in this plan" without a second request.
- A "Suggested" query: rotation for a service type over a window. This can be a sort plus a scope filter on the same RPC rather than a new endpoint.

### 5.3 People for pickers

- Move every web and mobile picker from `listPeople()` (whole roster) to `listPeoplePage` with `q`.
- Add `team_id` / `position_id` filters and `total`.
- Optional: a per-plan availability summary for each person (blocked out, already on the plan, last served) for Schedule People rows.

### 5.4 Other lists

| List | Change |
|---|---|
| Plans | `q` (title), and expose the service-type filter in the UI |
| Messages | Cursor paging already exists; wire it up |
| Media | Archived filter in SQL, cursor paging, usage counts in SQL |
| Staffing matrix | Order by `sort_name`, keyset paging both ways, plan-column paging |
| Notifications | Server count of read items (for "Clear read") |

---

## 6. Phased plan

Each phase is a separate `feature/*` branch, per CLAUDE.md.

**Phase 1: Plan building (highest value)** — `feature/plan-song-browser`
1. Search that ignores accents and splits words, for songs (§5.1), with LIKE escaping.
2. Songs list additions: usage sort, `not_scheduled_since`, `in_plan` (§5.2).
3. Shared web hooks and components:
   - `useDebouncedValue`
   - `useUrlState` (search params)
   - `SearchCombobox`, generalized from `MemberCombobox`: async, grouped, with suggestions before typing
   - `ListFooter` ("Showing x of y · Show more")
4. Web song browser panel with insert point and adding several songs at once. Inline header and item add.
5. Mobile song browser route.
6. Edit item: shared song search, leader combobox, positions grouped by team.

**Phase 2: People pickers and scheduling** — `feature/people-pickers`
1. Accent-insensitive people search, plus `team_id` and `total` on `listPeoplePage`.
2. Replace every full-roster picker with the combobox: Teams add member, Opportunity candidate, Schedule help, mobile team add.
3. Schedule People: scope toggle, per-row status, selection tray, fairness sort, mobile `FlatList`.
4. Mobile compose: recipient count with a searchable review.

**Phase 3: Honest lists** — `feature/list-truncation-fixes`
- Paging for Messages (web and mobile), Chat "load older", the media cap and archived filter, staffing matrix order and paging, reports truncation banner, calendar "+N", join-requests label.

**Phase 4: Browse pages** — `feature/browse-page-state`
- URL state and debounce on Songs, People, Plans and Media.
- Plans: search, service-type filter, month headers.
- Teams: collapsed cards and search.
- People: filters, total, select-all.
- Plan Teams tab: "only gaps".
- Notifications: unread toggle.
- Templates: grouping.

### Open questions for product

1. Should "Suggested" be per service type, or across the whole church?
2. "Recently used" warning threshold: 2 weeks, 3 weeks, or a setting?
3. Should Schedule People default to "Team members", or to "Everyone" with team members first (today's behaviour)?
4. Is a table view on Plans and People (dense rows, sortable columns) wanted for admins, alongside the card lists?
