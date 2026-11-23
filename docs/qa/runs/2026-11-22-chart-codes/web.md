# Web QA: chart codes (branch feature/chart-section-headings)

Tester: Sonnet QA agent. Web app http://localhost:5183, API :4120, Orca embedded browser (desktop 1338px wide; 390px via `orca viewport --mobile`). Test song: "QA Chart Codes", arrangement "Default Arrangement", key G. Evidence dir: `evidence/web/`.

| Flow | Result | Screenshots |
|---|---|---|
| 1. Editor + live preview, 1 column, Chords view | PASS. Section labels VERSE 1, CHORUS, BRIDGE, TAG, SPONTANEOUS, VERSE 2 all render as bold headings. The all-caps lyric stanza (AMAZING GRACE HOW SWEET / THAT SAVED...) stays as lyrics. `{ Repeat 2x }` and `{{ Build }}` italic grey. Bold, italic and underline visible. `[Em]` literal in "Eu [Em] canto". No COLUMN_BREAK, PAGE_BREAK or TRANSPOSE lines printed. VERSE 2 starts on page 2 with chords A and D. | [01](evidence/web/01-editor-1col.png) |
| 2. Two columns | PASS. TAG starts at the top of column 2 (after COLUMN_BREAK) and SPONTANEOUS follows it. | [02](evidence/web/02-two-columns.png) |
| 3. Chart codes reference (desktop and 390px) | PASS with a copy nit (D3). Collapsible opens and reads well. At 390px, scrollWidth equals innerWidth (390), so no horizontal overflow. The preview iframe overlaps the textarea in the mobile screenshot; I did not check whether this predates the branch (D5). | [03a](evidence/web/03a-chart-codes-desktop.png), [03b](evidence/web/03b-chart-codes-390.png) |
| 4a. Numbers notation | FAIL (D1). Chords are numbers, but BRIDGE renders as "3ridge". `{{ Build }}` is still shown (correct for a chord view). `[Em]` stays literal. VERSE 2 shows 1 4 (see Q1). | [04a](evidence/web/04a-numbers.png) |
| 4b. Lyrics notation | FAIL (D1). Chords are gone, `{{ Build }}` is hidden, `{ Repeat 2x }` is shown, `[Em]` is literal, and bold, italic and underline are kept. The BRIDGE heading is missing entirely and leaves a blank gap above "Holy holy". | [04b](evidence/web/04b-lyrics.png) |
| 4c. Preview key A | FAIL (D1). Chords move correctly (G to A, C to D, Em to F#m, VERSE 2 to B and E, title shows [A]). BRIDGE renders as "C#ridge". | [04c](evidence/web/04c-key-A.png) |
| 5. Save, reload, in-app view | PASS (see N1). After Save and reload, the 371-char text, key G and Two columns persist. In-app ChordChart on the song page shows heading labels (coloured), italic notes, bold, italic and underline, a literal `[Em]`, and VERSE 2 as A and D. BRIDGE is correct there in Original Key. I could not open the key and notation menu on the song page, so in-app transposed, Numbers and Lyrics views are untested. | [05](evidence/web/05-inapp-chordchart.png) |
| 6. Download PDF | PASS. Downloaded "QA Chart Codes [G].pdf" with 2 pages. Page 1 is a two-column layout with the TAG column break, italic notes, underline, bold and a literal `[Em]`. Page 2 exists (PAGE_BREAK works); I did not render it. "Open in new tab" was blocked as a popup by the Orca browser, so it is untested. | [pdf](evidence/web/06-download.pdf), [page 1](evidence/web/06-pdf-page1.png) |
| 7. Plan item sequence choices | NOT TESTED (optional, and it would need plan data). | none |
| 8. Vietnamese Chart codes | PASS. The reference and editor labels are translated, the layout is fine, and the code samples are unchanged. Language set back to English afterwards. | [08](evidence/web/08-vi-chart-codes.png) |

## Defects

### D1. `[Bridge]` heading is mangled whenever the key or notation changes (Medium to High)
- Steps: paste the test chart (key G) and Save. In the editor preview, open "Chart key and notation" and (a) pick key A, (b) pick Numbers, or (c) pick Lyrics.
- Expected: a BRIDGE heading in every view, as in Original Key.
- Actual: with key A the heading reads "C#ridge", with Numbers it reads "3ridge" (and a blank gap follows), and with Lyrics the heading is missing and a blank gap remains. It looks like the `[Bridge]` line is read as the chord `[B]` plus "ridge" before it is recognised as a heading, and only when the transpose or notation path runs. Original Key renders it correctly (the editor preview and the in-app view both show BRIDGE).
- Screenshots: 04a-numbers.png, 04b-lyrics.png, 04c-key-A.png.
- Impact: a bracket-style heading (`[Verse]`, `[Chorus]`) would probably break the same way. I only tested `[Bridge]`.

### D3. Chart codes copy for COLUMN_BREAK and PAGE_BREAK is ambiguous (Low)
- The text reads "Put it in double braces to break chord charts only". The test chart uses bare `COLUMN_BREAK` and `PAGE_BREAK`, and both work. A reader cannot tell whether braces are required, optional, or a way to hide the break from the lyrics view. I did not test `{{ COLUMN_BREAK }}`.
- Screenshots: 03a-chart-codes-desktop.png, 03b-chart-codes-390.png.

### D5. Mobile (390px) editor: preview iframe overlaps the lyrics textarea (Low, possibly not from this branch)
- Steps: open the chart editor at 390px wide, expand Chart codes and scroll.
- Actual: the preview pane overlays the bottom of the textarea in the screenshot. Not checked against main.
- Screenshot: 03b-chart-codes-390.png.

## Questions and notes
- Q1. In Numbers view, VERSE 2 (after `TRANSPOSE KEY +2`) shows `1 4`, the same as the untransposed chords. The editor text says TRANSPOSE prints chords higher and REDEFINE changes how numbers are counted, so this may be intended. Please confirm.
- N1. The Formatting dialog's "Save This Chart" button only stages the change. The header "Save" button stays enabled until clicked, and reloading before that Save drops the columns setting and any unsaved lyrics. Not a regression, but the label suggests it persists.

## Not tested
- Flow 7 (plan item sequence and section choices).
- "Open in new tab" (popup blocked by the Orca browser).
- PDF page 2 contents (page count of 2 confirmed only).
- In-app (non-editor) key, Numbers and Lyrics views.
- `{{ COLUMN_BREAK }}` in double braces, other headings (`Chorus:`, `Chorus 2x`, `ĐIỆP KHÚC`, `Intro`, `PRE-CHORUS`) and the mobile app.
- No source files were edited. The only data created was the "QA Chart Codes" song. Language was switched to Vietnamese and back to English for flow 8.

## Retest (D1 fix, D3 wording)

Retested in the editor preview of "QA Chart Codes" at http://localhost:5183 on 2026-11-22. Nothing was saved. In every view the headings VERSE 1, CHORUS, BRIDGE, TAG, SPONTANEOUS and VERSE 2 were all present.

| View | Result | Screenshot |
|---|---|---|
| Original Key (G) | Pass. BRIDGE heading, chords `Em D`. | evidence/web/retest-original-key.png |
| Key A | Pass. BRIDGE heading, chords `F#m E` (Em transposes to F#m). Other chords A / D shift correctly. | evidence/web/retest-keyA.png |
| Numbers | Pass. BRIDGE heading, chords `6m 5`. | evidence/web/retest-numbers.png |
| Numerals | Pass. BRIDGE heading, chords `vi V`. | evidence/web/retest-numerals.png |
| Lyrics | Pass. BRIDGE heading kept, lyrics "Holy holy" below, no chords. | evidence/web/retest-lyrics.png |
| Chart codes reference (D3) | COLUMN_BREAK / PAGE_BREAK row now reads: "Starts a new column or a new page in the printed chart. On its own line it breaks chord charts and lyric sheets; inside double braces it breaks chord charts only." The ambiguity is resolved. | evidence/web/retest-chart-codes.png |

D1: fixed. D3: wording now clear. No new defects.
