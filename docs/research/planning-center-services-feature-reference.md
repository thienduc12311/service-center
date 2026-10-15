# Planning Center Services feature reference

Research date / all sources accessed: **2026-10-15**. Scope: official Planning Center help articles reachable from the supplied [Services category](https://help.planningcenter.com/en/138429-services.html), its setup guides, and focused searches of the same official help site. This is a documented feature-family inventory for comparison with service-center, not a claim that every preference, device action, commercial entitlement, or integration endpoint has been exhaustively tested. No authenticated Planning Center account was used.

The supplied category returned only its heading to the web parser. Substantive leaf articles were accessible. Public documentation establishes intended product behavior, not how its internals are implemented. Source IDs below are stable references for the gap analysis. All summaries are original paraphrases; links identify the source owning each claim.

## Documented capability inventory

| Family | Documented capabilities and relevant limits | Sources |
|---|---|---|
| Account organization | Nested folders organize service types; service types group plans, teams, and templates. Plans can recur regularly or occur sporadically. Multiple times of the same service belong in a single plan. Service types can be copied with settings and optional templates, without copying people or permissions. | [PC02](#pc02), [PC03](#pc03), [PC04](#pc04) |
| Service defaults | Frequency, folder, time preferences, default files, plan/item note categories, item row colors, limited file visibility, LIVE permissions, and public-view settings apply across a service type. | [PC05](#pc05) |
| Scoped authorization | Separate People/Plans, Songs, and Media permissions; scheduled viewer, viewer, scheduler, editor, administrator, plus organization administrator. Folder/service-type overrides inherit from parents. Team leadership limits scheduler actions. Plan/song/media attachment access is independently configurable. | [PC06](#pc06) |
| Permission policy | Organization administrators set defaults for new users, minimum permissions for people visibility/contact/household edits/CSV exports, and who may delete others' content. | [PC07](#pc07) |
| People onboarding | Create a person, add an existing People record to Services, or CSV-import through People. Sending the welcome email is optional; imported recipients create their password through that email. Team assignments can be applied in bulk. | [PC08](#pc08) |
| People classification and search | Services-specific people tags and tag groups represent skills/attributes and can drive tag-team membership. Universal search finds people, songs, media, teams and positions, including People records not yet imported into Services. | [PC72](#pc72), [PC73](#pc73) |
| Guests and temporary roles | Schedule a non-team-member guest into a plan; create a Services person from the scheduling sidebar if absent; use a temporary position for a role needed only on that plan. **Inference:** combining this with optional welcome emails supports scheduling before the person completes login onboarding. A person profile is still required. | [PC09](#pc09), [PC08](#pc08) |
| Team management | Create/copy teams, assign leaders and members, define/reorder positions, assign members to several positions, and reuse a team across service types. Members can contact leaders and set preferences. | [PC10](#pc10) |
| Team variants/defaults | Rehearsal teams receive item files/tools; secure teams require an eligible background check to schedule; split teams cover different service times; tag teams derive membership from tags. Related teams extend visibility. Defaults include response status, prepared notification, replies recipient, gap alerts, and decline recovery. | [PC11](#pc11) |
| Person lifecycle and bulk work | Archive/restore keeps scheduling history and team assignments; permanent removal removes the person from historical plans. Bulk changes include tags, team assignment, scoped permissions, and file access, with a recent-edit history. | [PC12](#pc12), [PC13](#pc13) |
| Assigned times | Distinct service, rehearsal, and other times have start/end dates and times, assigned teams/positions, and team reminders. People can have individual time assignments. Updates can apply to future matching times and already-scheduled people. | [PC14](#pc14) |
| Scheduling conflicts | Warnings evaluate overlaps in assigned times, blockouts, and preferences. Badge details explain warnings; human schedulers can override them. Correct time assignments are necessary for meaningful conflict warnings. | [PC15](#pc15) |
| Availability | All-day or timed blockouts, ranges, reasons, repeat patterns, household coverage, and linked-account coverage. Repeating series can be changed for one occurrence, future occurrences, or all; some recurring edits require web. | [PC16](#pc16) |
| Scheduling preferences | Maximum plans per day/month, per-team frequency, split-team preferred times, and household same-plan/concurrent-plan preferences generate preference warnings. General/household preferences are web-only in the referenced documentation. | [PC17](#pc17) |
| Household coordination | View family schedules, respond/sign up/block out for authorized household members, grant adult management permissions, and copy child emails. Managing another adult requires that adult's permission. Household membership comes from People. | [PC18](#pc18) |
| Manual scheduling | Needed positions capture required headcounts. Candidate lists show last-scheduled information and conflicts. Schedule manually, use templates/rotations, schedule guests, or schedule many plans together. | [PC19](#pc19), [PC20](#pc20) |
| Multi-plan matrix | Load plans from several service types and templates side by side; choose dates/sections, save custom matrices, use condensed layouts, and highlight repeated people/items. Drag a person to another plan; batch requests consolidate into one email per person. | [PC21](#pc21), [PC22](#pc22) |
| Multi-plan order reuse | Custom matrices also support cross-campus planning and dragging plan items between plans. This is distinct from a roster-only schedule grid; the reference product's matrix contains both service orders and team schedules. | [PC23](#pc23), [PC21](#pc21) |
| Auto-scheduling | Fill needed positions in one or multiple plans using availability and last scheduled plan. Team settings can change last-used context. Positions remain unfilled if no eligible candidate is available; matrix auto-scheduling can be undone before leaving that view. | [PC24](#pc24) |
| Signup sheets | Expose open needed positions to eligible team members for one plan, templates, or new plans by default; email open signups. Volunteers see dates/times/conflicts before committing. Visibility is position-based, not an unrestricted public signup. | [PC25](#pc25), [PC26](#pc26) |
| Responses and replacement | Accept/decline requests individually, in bulk, by position or split-team time; provide a decline reason. Depending on team policy, declining creates a need, invokes auto-scheduling, or lets a volunteer choose an available replacement and confirm prior coordination. | [PC26](#pc26), [PC11](#pc11) |
| Scheduling release | Prepared notifications create a penciled-in state until sending requests. Requests carry assigned times, item leadership, team notes, custom text, response actions, and plan links. Release can target one person, team, plan, or multiple plans. | [PC27](#pc27), [PC22](#pc22) |
| Automated reminders | Configure reminders per team per plan time, up to seven days ahead; exclude declined people; include assigned times, relevant notes, leadership, response links. Same-day reminders consolidate. Sending a reminder clears prepared notification state. | [PC28](#pc28) |
| Availability collection | Email a blockout request with actions to enter unavailable dates or affirm no blockouts. A last-set-blockouts column helps leaders see who has updated availability recently. | [PC74](#pc74) |
| Email customization | Personal/shared email templates cover general, schedule, signup, and welcome messages, with formatted content, inline images, and dynamic placeholders. Shared-template authoring has a higher permission requirement. | [PC75](#pc75) |
| Email, chat, and text | Email entire teams or scheduled people; start plan-specific or whole-team chats, including multiple teams. Services Mobile supports texting from a plan. SMS-gateway email notifications exist only for supporting carriers and are documented as less reliable than app notifications. | [PC29](#pc29), [PC30](#pc30) |
| Rich chat and messaging policy | Mobile chat supports direct messages when enabled, reactions, replies, images, GIFs, read receipts, editing/deleting own messages, and reporting. Shared team/group membership and youth-specific access rules constrain conversations. | [PC31](#pc31) |
| Order builder | Regular items, section headers, linked songs, and linked media; drag reorder; choose arrangement/key; quick-add syntax and keyboard shortcuts; clear the whole order with appropriate permission. Song notes can be reused from the previous occurrence. | [PC32](#pc32), [PC60](#pc60) |
| Detailed item editing | Name, description, duration, before/during/after placement, applicable service times, formatted details, categorized notes, attachments, linked song/media, and item/song leaders. Before/after items do not count toward service duration. | [PC33](#pc33) |
| Responsibility and notes | Assign a specific scheduled person or a position as leader; position-based leaders follow staffing changes and appear in emails/reports. Categorized item notes hold cues and other text; display chosen categories as columns. | [PC34](#pc34) |
| Reusable templates | Saved templates hold selected order items, notes, needed positions, and people; support rotations, copy between service types, and bulk creation. Import selected elements into existing plans and multiple target plans. Imports add information; later template changes do not update prior imports. | [PC35](#pc35), [PC36](#pc36), [PC37](#pc37) |
| Bulk plan creation and rescheduling | Create several plans/copies with selected content and copied times. Shift entire current/future plans forward/backward, optionally resetting responses, or move only service-order content while retaining scheduled people. | [PC76](#pc76), [PC77](#pc77) |
| Plan context/presentation | Series information/art, plan notes/files, collaborators, configurable columns, condensed/expanded views, and connected Calendar/Publishing links appear on plan pages. | [PC38](#pc38) |
| LIVE execution | One active controller advances current/next items and synchronizes watching displays; role-based control/takeover. Countdown modes favor full item duration, planned item end, or service end. View planned/projected lengths; watch other services and chat by organization/service type. | [PC39](#pc39), [PC40](#pc40) |
| LIVE history | Record actual timing per service occurrence, compare against planned duration, edit mistaken timestamps, reset timing, and export recorded-time reports including LIVE chats. | [PC41](#pc41) |
| Song library | Account-wide songs; several arrangements per song; keys per arrangement; configurable list columns, tags, schedule history, metadata import from CCLI/MultiTracks, or original creation. | [PC42](#pc42), [PC43](#pc43) |
| Arrangements, keys, sequences | Different versions carry separate files. Duplicate arrangement details/tags/keys/files; keys can have descriptive labels. Define/reorder song-section sequences, with plan-specific overrides or updates to the arrangement default. | [PC44](#pc44), [PC45](#pc45), [PC46](#pc46) |
| Song discovery/curation | Search title/CCLI number, musical properties, lyrics/themes/author, tags, and scheduling/creation history; pin filters. Archive/restore songs or arrangements singly/in bulk while historical plans retain them. Popular-song rankings can aid discovery. | [PC47](#pc47), [PC48](#pc48), [PC43](#pc43) |
| Lyrics/chords and audio | Built-in text chart editor generates chord/lyric PDFs for selected keys; transpose uploaded audio. These are processing features beyond storing a PDF or a YouTube link. | [PC49](#pc49), [PC50](#pc50) |
| Attachments | Upload or link files at song/arrangement/key levels, plan/item/service-type levels, and media items. Song references expose applicable song, arrangement, and key files. Streaming links and imported provider files are distinct attachment sources. | [PC51](#pc51), [PC42](#pc42), [PC38](#pc38) |
| Plan file authoring | Attach single-use plan files or reusable service-type files; create text documents; link streaming videos and webpages. Unlinking a referenced song/media file differs from deleting its stored source. | [PC78](#pc78) |
| File visibility/downloads | Position file tags and service-type limited visibility determine which files scheduled viewers receive. Higher permissions can retain broader access. MP3 download defaults, stream-only settings, and permission-based override are separate controls. | [PC52](#pc52), [PC53](#pc53) |
| Rehearsal | A rehearsal workspace supplies a song playlist, playable media, downloaded files, combined PDF songbook, and access to Music Stand when subscribed. Mobile adds persistent skipped tracks, audio-section loops, metronome, and temporary offline playlist caching. | [PC54](#pc54), [PC55](#pc55) |
| Media library | Reusable media bundles contain multiple file types, duration, creator, themes, tags, thumbnails, scheduled-use history, notes, and an optional auto-archive date. Media can link to service order items and supported presentation integrations. | [PC56](#pc56) |
| Stage planning | Build stage diagrams from templates, place scheduled people and instrument/gear objects, adjust labels/color/size/rotation, and download the result as a PDF. Custom stage-image templates can be reused across service types. | [PC79](#pc79) |
| Attendance | Mark attendance for scheduled people for specific plan times, one team or all teams, with team-leader scope. Check-Ins integration can populate the same records; this is volunteer attendance, distinct from congregation headcounts. | [PC57](#pc57), [PC58](#pc58) |
| Calendar | Services master calendar shows plan times, blockouts, birthdays, anniversaries with service-type/item filters. Personal read-only webcal feeds include confirmed schedule, optionally blockouts. | [PC59](#pc59), [PC61](#pc61) |
| Print/reporting | Configurable plan PDFs/web reports include order, teams, notes, service times and LIVE actuals. Service-type reports analyze people/song use/service length and can export applicable tables. Administrators can author custom plan/matrix/people reports. | [PC62](#pc62), [PC63](#pc63), [PC64](#pc64) |
| File licensing and usage | Track purchased file licenses and warn when exceeded. CCLI reporting supports manual copy-activity data and automatic weekly reporting with documented license coverage and eligibility limits. | [PC65](#pc65), [PC66](#pc66) |
| Public distribution | Select public plan details, publish individually or on service day, share a worship set, and create nearest-before/after permalinks. Public settings deliberately exclude plan/item attachments from automatic Church Center publication. | [PC67](#pc67) |
| External products and providers | Song-file providers include MultiTracks/RehearsalPack/RehearsalMix, SongSelect, and PraiseCharts. Check-Ins attendance and Publishing sermon episodes integrate with Services. Music Stand is an optional add-on, not the standard rehearsal player. | [PC42](#pc42), [PC58](#pc58), [PC68](#pc68), [PC38](#pc38) |
| Mobile and cross-account use | Web and Services Mobile provide different feature subsets. Widgets expose upcoming requests, rehearsal song lists, and scheduler status. Linked church profiles share a schedule view and cross-account conflicts without exposing other churches' plan details. | [PC55](#pc55), [PC69](#pc69), [PC70](#pc70) |

## Interpretation boundaries for implementation planning

- A partial implementation is not parity: a database `files` table does not demonstrate upload, authorization, preview, playback, songbook generation, or derivative processing. A copy-plan button does not demonstrate independently saved templates. A schedule grid does not establish service-order editing or batch request delivery.
- Person-first scheduling is supported by administrator-created Services profiles and optional welcome emails; the articles do **not** establish that requests can target arbitrary text with no person record, nor that a missing email can receive a request.
- “Matrix” is Planning Center's documented combined multi-plan workspace. service-center may sensibly expose scheduling and order planning separately; matching the workflow matters more than matching navigation labels.
- Documentation confirms archive/restore and arrangement duplication; this investigation did **not** establish automated duplicate-song detection or song merging. Treat those as proposed service-center improvements, not verified parity requirements.
- Cross-product features require separate scope decisions: People owns shared profiles/households and CSV-import infrastructure; Check-Ins owns stations/labels; Calendar owns room/resource booking; Publishing owns sermon distribution; Groups owns small-group management; Giving/Registrations own payments. Those products' complete feature sets are outside Services parity.
- API documentation exists, but its JavaScript-only page could not be inspected by the text parser. Public API endpoint coverage, webhooks, rate limits, provider contracts, pricing, and entitlement details require a separate implementation spike; do not infer them from the help inventory.
- No claim is made about unreviewed full administration/security settings, localization/accessibility, commercial limits, every file-management action, or every third-party integration. The reference is broad across documented feature families and explicit about these limits.

## Source register

All links below were accessed **2026-10-15**. Unless explicitly identified otherwise, every source is an official Planning Center help article. Publication timestamps in the migrated help system can reflect republication; the access date is the evidence date.

| ID | Official source |
|---|---|
| <a id="pc01"></a>PC01 | [Services category — supplied starting point; parsed without leaf content](https://help.planningcenter.com/en/138429-services.html) |
| <a id="pc02"></a>PC02 | [Set up Services](https://help.planningcenter.com/en/179245-set-up-services.html) |
| <a id="pc03"></a>PC03 | [Main Plans page overview](https://help.planningcenter.com/en/139397-main-plans-page-overview.html) |
| <a id="pc04"></a>PC04 | [Create a new service type](https://help.planningcenter.com/en/142847-create-a-new-service-type.html) |
| <a id="pc05"></a>PC05 | [Manage service type settings](https://help.planningcenter.com/en/142848-manage-service-type-settings.html) |
| <a id="pc06"></a>PC06 | [Permissions in Services](https://help.planningcenter.com/en/136863-permissions-in-services.html) |
| <a id="pc07"></a>PC07 | [Manage default permission settings](https://help.planningcenter.com/en/142865-manage-default-permission-settings.html) |
| <a id="pc08"></a>PC08 | [Add or import people](https://help.planningcenter.com/en/142859-add-or-import-people.html) |
| <a id="pc09"></a>PC09 | [Schedule additional people](https://help.planningcenter.com/en/142870-schedule-additional-people.html) |
| <a id="pc10"></a>PC10 | [Create or edit a team](https://help.planningcenter.com/en/140130-create-or-edit-a-team.html) |
| <a id="pc11"></a>PC11 | [Manage team settings](https://help.planningcenter.com/en/140131-manage-team-settings.html) |
| <a id="pc12"></a>PC12 | [Archive, remove, and restore people](https://help.planningcenter.com/en/142860-archive%2C-remove%2C-and-restore-people.html) |
| <a id="pc13"></a>PC13 | [Bulk edit people](https://help.planningcenter.com/en/142863-bulk-edit-people.html) |
| <a id="pc14"></a>PC14 | [Add and assign times](https://help.planningcenter.com/en/139401-add-and-assign-times.html) |
| <a id="pc15"></a>PC15 | [Scheduling conflicts and blockouts](https://help.planningcenter.com/en/142878-scheduling-conflicts-and-blockouts.html) |
| <a id="pc16"></a>PC16 | [Manage blockout dates](https://help.planningcenter.com/en/142872-manage-blockout-dates.html) |
| <a id="pc17"></a>PC17 | [Set your scheduling preferences](https://help.planningcenter.com/en/142873-set-your-scheduling-preferences.html) |
| <a id="pc18"></a>PC18 | [Manage your household's schedule](https://help.planningcenter.com/en/142879-manage-your-household-s-schedule.html) |
| <a id="pc19"></a>PC19 | [Schedule your teams](https://help.planningcenter.com/en/142868-schedule-your-teams.html) |
| <a id="pc20"></a>PC20 | [Set up needed positions](https://help.planningcenter.com/en/142880-set-up-needed-positions.html) |
| <a id="pc21"></a>PC21 | [Set up the matrix](https://help.planningcenter.com/en/139474-set-up-the-matrix.html) |
| <a id="pc22"></a>PC22 | [Use the matrix to schedule](https://help.planningcenter.com/en/139475-use-the-matrix-to-schedule.html) |
| <a id="pc23"></a>PC23 | [Tips for multiple campuses](https://help.planningcenter.com/en/144864-tips-for-multiple-campuses.html) |
| <a id="pc24"></a>PC24 | [Auto-schedule your team](https://help.planningcenter.com/en/142881-auto-schedule-your-team.html) |
| <a id="pc25"></a>PC25 | [Schedule with signup sheets](https://help.planningcenter.com/en/142882-schedule-with-signup-sheets.html) |
| <a id="pc26"></a>PC26 | [Manage your schedule](https://help.planningcenter.com/en/142874-manage-your-schedule.html) |
| <a id="pc27"></a>PC27 | [Send scheduling emails](https://help.planningcenter.com/en/142892-send-scheduling-emails.html) |
| <a id="pc28"></a>PC28 | [Set up reminder emails](https://help.planningcenter.com/en/142894-set-up-reminder-emails.html) |
| <a id="pc29"></a>PC29 | [Communicate with your teams](https://help.planningcenter.com/en/142889-communicate-with-your-teams.html) |
| <a id="pc30"></a>PC30 | [Set up and respond to text notifications](https://help.planningcenter.com/en/142891-set-up-and-respond-to-text-notifications.html) |
| <a id="pc31"></a>PC31 | [Chat in the Services mobile app](https://help.planningcenter.com/en/142890-chat-in-the-services-mobile-app.html) |
| <a id="pc32"></a>PC32 | [Set up the service order](https://help.planningcenter.com/en/139467-set-up-the-service-order.html) |
| <a id="pc33"></a>PC33 | [Edit item details](https://help.planningcenter.com/en/139464-edit-item-details.html) |
| <a id="pc34"></a>PC34 | [Communicate plan responsibilities](https://help.planningcenter.com/en/139466-communicate-plan-responsibilities.html) |
| <a id="pc35"></a>PC35 | [Set up scheduling templates](https://help.planningcenter.com/en/142876-set-up-scheduling-templates.html) |
| <a id="pc36"></a>PC36 | [Export a template or plan](https://help.planningcenter.com/en/139471-export-a-template-or-plan.html) |
| <a id="pc37"></a>PC37 | [Import a template or plan](https://help.planningcenter.com/en/139470-import-a-template-or-plan.html) |
| <a id="pc38"></a>PC38 | [Individual plan page overview](https://help.planningcenter.com/en/139396-individual-plan-page-overview.html) |
| <a id="pc39"></a>PC39 | [What is Services LIVE?](https://help.planningcenter.com/en/139479-what-is-services-live-.html) |
| <a id="pc40"></a>PC40 | [Services LIVE permissions](https://help.planningcenter.com/en/139480-services-live-permissions.html) |
| <a id="pc41"></a>PC41 | [Manage recorded LIVE times](https://help.planningcenter.com/en/139482-manage-recorded-live-times.html) |
| <a id="pc42"></a>PC42 | [Songs page overview](https://help.planningcenter.com/en/139427-songs-page-overview.html) |
| <a id="pc43"></a>PC43 | [Add a song to the library](https://help.planningcenter.com/en/139428-add-a-song-to-the-library.html) |
| <a id="pc44"></a>PC44 | [Add or edit an arrangement](https://help.planningcenter.com/en/139430-add-or-edit-an-arrangement.html) |
| <a id="pc45"></a>PC45 | [Add or edit a key](https://help.planningcenter.com/en/139429-add-or-edit-a-key.html) |
| <a id="pc46"></a>PC46 | [Edit song sequences](https://help.planningcenter.com/en/139432-edit-song-sequences.html) |
| <a id="pc47"></a>PC47 | [Filter the Songs page](https://help.planningcenter.com/en/139437-filter-the-songs-page.html) |
| <a id="pc48"></a>PC48 | [Archive and restore songs and arrangements](https://help.planningcenter.com/en/139431-archive-and-restore-songs-and-arrangements.html) |
| <a id="pc49"></a>PC49 | [Use the Lyrics & Chords editor](https://help.planningcenter.com/en/139440-use-the-lyrics---chords-editor.html) |
| <a id="pc50"></a>PC50 | [Transpose audio files](https://help.planningcenter.com/en/139442-transpose-audio-files.html) |
| <a id="pc51"></a>PC51 | [Add files to a song](https://help.planningcenter.com/en/139434-add-files-to-a-song.html) |
| <a id="pc52"></a>PC52 | [Set up limited file visibility](https://help.planningcenter.com/en/139416-set-up-limited-file-visibility.html) |
| <a id="pc53"></a>PC53 | [Allow MP3 downloads](https://help.planningcenter.com/en/139420-allow-mp3-downloads.html) |
| <a id="pc54"></a>PC54 | [Get ready for rehearsal](https://help.planningcenter.com/en/142841-get-ready-for-rehearsal.html) |
| <a id="pc55"></a>PC55 | [Use the Services Mobile media player](https://help.planningcenter.com/en/143035-use-the-services-mobile-media-player.html) |
| <a id="pc56"></a>PC56 | [Create media](https://help.planningcenter.com/en/139423-create-media.html) |
| <a id="pc57"></a>PC57 | [Take attendance in Services](https://help.planningcenter.com/en/142909-take-attendance-in-services.html) |
| <a id="pc58"></a>PC58 | [Check-Ins and Services integration](https://help.planningcenter.com/en/139446-check-ins-and-services-integration.html) |
| <a id="pc59"></a>PC59 | [Use the master calendar in Services](https://help.planningcenter.com/en/142851-use-the-master-calendar-in-services.html) |
| <a id="pc60"></a>PC60 | [Use keyboard shortcuts in Services](https://help.planningcenter.com/en/144368-use-keyboard-shortcuts-in-services.html) |
| <a id="pc61"></a>PC61 | [Subscribe to your Services calendar](https://help.planningcenter.com/en/143026-subscribe-to-your-services-calendar.html) |
| <a id="pc62"></a>PC62 | [Create plan reports](https://help.planningcenter.com/en/139387-create-plan-reports.html) |
| <a id="pc63"></a>PC63 | [Create service type reports](https://help.planningcenter.com/en/139392-create-service-type-reports.html) |
| <a id="pc64"></a>PC64 | [Create custom reports](https://help.planningcenter.com/en/139394-create-custom-reports.html) |
| <a id="pc65"></a>PC65 | [Track file licenses](https://help.planningcenter.com/en/139421-track-file-licenses.html) |
| <a id="pc66"></a>PC66 | [CCLI reporting](https://help.planningcenter.com/en/139389-ccli-reporting.html) |
| <a id="pc67"></a>PC67 | [Share your plan](https://help.planningcenter.com/en/139461-share-your-plan.html) |
| <a id="pc68"></a>PC68 | [Sermons and Services integration](https://help.planningcenter.com/en/139235-sermons-and-services-integration.html) |
| <a id="pc69"></a>PC69 | [Scheduling and rehearsal widgets](https://help.planningcenter.com/en/143031-scheduling-and-rehearsal-widgets.html) |
| <a id="pc70"></a>PC70 | [Link accounts from multiple churches](https://help.planningcenter.com/en/140718-link-accounts-from-multiple-churches.html) |
| <a id="pc71"></a>PC71 | [API documentation — JavaScript-only shell; endpoint contents not verified](https://developer.planning.center/docs/#/apps/services) |
| <a id="pc72"></a>PC72 | [Organize people with tags](https://help.planningcenter.com/en/142861-organize-people-with-tags.html) |
| <a id="pc73"></a>PC73 | [Search in Planning Center — Services section](https://help.planningcenter.com/en/141424-search-in-planning-center.html) |
| <a id="pc74"></a>PC74 | [Send blockout requests for predictable scheduling](https://help.planningcenter.com/en/142885-send-blockout-requests-for-predictable-scheduling.html) |
| <a id="pc75"></a>PC75 | [Create email templates](https://help.planningcenter.com/en/142895-create-email-templates.html) |
| <a id="pc76"></a>PC76 | [Create or copy a plan](https://help.planningcenter.com/en/139399-create-or-copy-a-plan.html) |
| <a id="pc77"></a>PC77 | [Reschedule your plans](https://help.planningcenter.com/en/139460-reschedule-your-plans.html) |
| <a id="pc78"></a>PC78 | [Add files to a plan](https://help.planningcenter.com/en/139463-add-files-to-a-plan.html) |
| <a id="pc79"></a>PC79 | [Create stage layouts](https://help.planningcenter.com/en/139419-create-stage-layouts.html) |
