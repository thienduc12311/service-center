# Chart codes on iOS (blocked)

Environment: iPhone 18 Pro simulator, iOS 27.2, Expo Go 57.0.9. Metro ran on port 8093 with `EXPO_PUBLIC_API_URL=http://localhost:4120`. Signed in as it@graceaogchurch.com (session seeded into Expo Go storage, see Blockers). Song "QA Chart Codes Mobile" was created through the API, not the app.

| Flow | Result | Evidence |
| --- | --- | --- |
| Paste chart in editor, expand Chart codes, Preview | Not tested. Could not tap or scroll. The editor opens at the top; the chart field is visible only partly, and the Chart codes toggle and Preview tab content were not reached. | [Editor top](evidence/native/01-editor.png) |
| Save, then song detail chart view | Not tested. Song detail opens (title, key G, Default Arrangement), but the chart view is below the fold. | [Song detail](evidence/native/02-song-detail.png) |
| Lyrics and Numbers notation | Not tested (needs taps). | none |

Observed: the chart was saved via API with the exact text from the brief; the editor loaded it and shows the raw source (`<b>`, `{{ Build }}`, `<t>[Em]</t>`) in the Lyrics and Chords field, key G.

## Blockers
- The Xcode install has no Simulator.app, and the simulator ran headless. `orca computer` found no window to drive. `simctl` has no tap, scroll or typing command.
- Sign-in was done by writing a Supabase session into Expo Go's AsyncStorage manifest.json (simulator container, not repo files).
- Metro's inspector (CDP) accepted a connection but never answered Runtime.evaluate, so I could not script taps or scrolling.
- Navigation worked only by deep link, e.g. `exp://192.168.1.211:8093/--/song/chart?songId=...&arrangementId=...`.

## Defects
None observed. Nothing about section tags, notes, inline formatting, hidden codes, or the Chart codes toggle was verified.
