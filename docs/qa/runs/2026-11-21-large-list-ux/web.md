# Large-list web QA

Tested November 21, 2026 in the Orca embedded Chromium browser against a local API and Supabase. The synthetic organization had 173 active songs, 238 visible people, 25 team choices and 45 messages. Order edits used a new draft with Welcome, Sermon and Closing items.

| Flow | Result | Screenshots |
| --- | --- | --- |
| Song browsing | Suggested opened at the marked insertion point. All A–Z loaded 20 of 173 songs, then 40 of 173 with Show more. Searching `chua` returned titles containing Chúa. | [Suggested](evidence/web/order-song-panel-open.png), [All A–Z](evidence/web/panel-tab-all-az.png), [Second page](evidence/web/order-song-panel-second-page.png), [Accentless search](evidence/web/panel-search-chua.png) |
| Keyboard add and undo | ArrowDown and Enter added the highlighted song between Welcome and Sermon. The drawer stayed open and moved the insertion point after the added song. Undo removed it and returned the point to Welcome. Escape returned focus to the button that opened the drawer. | [Insertion and Undo](evidence/web/order-song-panel-insert-undo.png) |
| Responsive drawer | At 1869px and 1280px, the drawer left the order's Remove Sermon button visible and reachable. At 390×844, the drawer filled the viewport with Done visible and no horizontal overflow. Shift+Tab and Tab wrapped within the modal. Escape returned focus to Add songs. | [Wide](evidence/web/order-song-panel-open.png), [1280px](evidence/web/order-song-panel-1280px.png), [390px](evidence/web/order-song-panel-390px.png) |
| Schedule People | The team picker offered 25 choices. Worship Band defaulted to its 27 people. Searching `nguyen` matched Nguyễn. The selected Bùi Quốc Nhung chip stayed visible after searching and switching to Everyone (238). The wider scope marked matching Worship Band members. | [Team picker](evidence/web/schedule-people-team-picker.png), [Team search](evidence/web/schedule-people-team-search.png), [Everyone with selected person](evidence/web/schedule-people-everyone-pinned.png) |
| People directory | The count dropped from 238 people to 27 after selecting Worship Band. The URL retained the team filter. | [Team-filtered directory](evidence/web/people-team-total.png) |
| Messages | Load older messages grew the list from 30 to 45 links. | [Older messages](evidence/web/messages-loaded-older.png) |

The earlier session captured the [song library](evidence/web/songs-page-desktop.png). The screenshot environment still used the original API and schema when Recently added started sending its revised sort parameter.
