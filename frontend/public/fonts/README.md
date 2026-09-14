# PDF fallback fonts

Loaded only by the chord chart PDF export (`src/lib/chart-export/fonts.ts`), and
only for a chart that contains a character the PDF's built-in fonts cannot
represent — most charts never fetch them.

| File | Face | Upstream |
| --- | --- | --- |
| `roboto-mono-regular.ttf` | Roboto Mono 400 | [Roboto Mono](https://fonts.google.com/specimen/Roboto+Mono) |
| `roboto-mono-bold.ttf` | Roboto Mono 700 | [Roboto Mono](https://fonts.google.com/specimen/Roboto+Mono) |
| `roboto-regular.ttf` | Roboto 400 | [Roboto](https://fonts.google.com/specimen/Roboto) |
| `roboto-bold.ttf` | Roboto 700 | [Roboto](https://fonts.google.com/specimen/Roboto) |

Both families are Apache License 2.0, and both cover Latin, Latin Extended,
Vietnamese, Greek and Cyrillic — which is what a chart set in any of the app's
font options can throw at them.

Taken from the `@expo-google-fonts/roboto-mono` and `@expo-google-fonts/roboto`
packages, which redistribute the upstream TrueType files unchanged. They are
kept here rather than as a dependency because the export fetches them as plain
files at run time; nothing imports them, so nothing bundles them.
