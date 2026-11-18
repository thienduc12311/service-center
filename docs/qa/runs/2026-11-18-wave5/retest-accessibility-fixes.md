# QA wave 5 — accessibility fix retest

Date: 2026-11-18. Scope: focused retest of `W5-UX-D1` and `W5-UX-D2` only. The original report is commit `4884653` on `feature/qa-wave5`; its four FAIL results remain the historical pre-fix record.

## Result

All four original failing records passed this focused retest:

| Original record | Defect | Retest | Observed result |
|---|---|---|---|
| `W5-UX-05` | `W5-UX-D2` | PASS | At 390×844 the initials profile trigger exposed `Account menu` in English and `Trình đơn tài khoản` in Vietnamese. |
| `W5-UX-07` | `W5-UX-D1` | PASS | Opening the real Vietnamese New Plan dialog at `/plans` focused `input#plan-title` inside the dialog. |
| `W5-UX-08` | `W5-UX-D1` | PASS | Tab from the final Create button wrapped to Close; Shift+Tab from Close wrapped to Create. Both active elements remained inside the dialog. |
| `W5-UX-10` | `W5-UX-D1` | PASS | Escape removed the dialog and returned focus to `Chương trình mới`; the close button did the same. Body overflow returned from `hidden` to its prior empty value. |

The existing `W5-UX-09` Escape-dismiss behavior also remained intact.

## Behavioral regression coverage

`npm test -w @service-center/frontend` exercises the shared modal rather than a duplicate focus helper. Ten tests cover:

- initial focus and a consumer-provided `autoFocus` target;
- forward and reverse Tab wrapping;
- Escape restoration, including the New Plan autofocus ordering;
- disabled/empty dialog content;
- rerenders with a new `onClose` function;
- modal-only unmount cleanup and body-scroll restoration;
- stacked dialogs, topmost Escape handling, and scroll-lock reference counting;
- the localized account-menu name at a 390 px viewport for initials and photo variants.

The authenticated Orca browser retest used the existing local seed owner and did not create, submit, or mutate a plan. No database reset or migration ran. The browser session was signed out and cleared, the test tab was closed, and the owned API, Vite, and Supabase processes were stopped. Detailed sanitized observations are in [`evidence/accessibility-fix-observations.json`](evidence/accessibility-fix-observations.json).

## Validation

- `npm run build:shared`: PASS.
- `npm run build -w @service-center/frontend`: PASS (the existing Vite large-chunk warning remained).
- `npm run typecheck -w @service-center/frontend`: PASS.
- `npm test -w @service-center/frontend`: PASS, 10/10 tests.
- `npm test -w @service-center/shared`: 528 PASS, 5 FAIL. All five failures are the previously reported `W4-I18N-D1` Node/Vietnamese plural-selection defect (missing `_one` expectations and English fallback at counts 0/1); this accessibility fix does not alter or relabel it.

## Boundaries

This is not an all-QA or release pass. `W4-I18N-D1` remains a separate open Node/Vietnamese plural issue. Native/provider/full-journey gates, comprehensive assistive-technology coverage, and the Live-control gate for missing migration `20261121000000` remain outside this retest.
