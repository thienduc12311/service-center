# Wave 1 - STATIC track

## Environment
- Commit f4f41cd, branch feature/app-store-review-demo (git status: only untracked mobile/ios.hollow-backup/, pre-existing)
- node v20.20.1, npm 10.8.2; package.json engines require node >=26.8.1 / npm >=11.19.0 (mismatch caused NO failure; no engine-strict enforcement)

## Results
| Command | Status | Duration | Counts | Notes |
|---|---|---|---|---|
| npm run build:shared | PASS | 5s | - | |
| typecheck shared | PASS | 3s | - | |
| typecheck backend | PASS | 5s | - | |
| typecheck frontend | PASS | 10s | - | app + node tsconfigs |
| typecheck mobile | PASS | 8s | - | |
| test shared | PASS | 1s | 47 files / 490 tests | |
| test backend | PASS | 3s | 40 files / 236 tests | no DB writes performed (suite ran fast, passes; not BLOCKED) |
| test mobile | PASS | 3s | 34 files / 370 tests | |
| test frontend | NOT_RUN | - | - | no test script in frontend/package.json (confirmed) |
| build backend | PASS | 5s | - | |
| build frontend | PASS | 11s | - | Vite chunk-size warning only |
| npm run i18n:check | PASS | 4s | 16 namespaces; en 4606, vi 4427 strings | catalogs OK |
| mobile JS bundle export | NOT_RUN | - | - | no export/bundle script in mobile/package.json |

## Failures
None. 1096 tests passed total, 0 failed. Only noise: Vite large-chunk warning (non-blocking).
Note: build commands write gitignored dist/ outputs; no tracked files changed.
