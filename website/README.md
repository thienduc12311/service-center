# Service Center website

The public marketing site and product documentation for Service Center: a static site with no build step and no dependencies. It is deliberately **not** an npm workspace, so it can be deployed (or moved into its own repository) on its own.

```
website/
  index.html            Landing page (Apple-style, scroll-driven "film" of the app)
  docs/index.html       Documentation for every web and mobile feature
  assets/js/config.js   ← all external links: App Store, Google Play, web app, support email
  assets/js/common.js   Nav, theme switch (auto/light/dark), store badges, links
  assets/js/landing.js  Scroll-scrubbed scenes + "Watch the film" playback
  assets/js/docs.js     Sidebar scroll-spy, search, mobile topic menu
  assets/css/           site.css (shared tokens/theme), landing.css, docs.css
  assets/img/           App icon and iPad screenshots (from docs/app-store/ipad-13)
  vercel.json           Its own Vercel project config (static, no build)
```

## Run locally

```bash
python3 -m http.server 4321 --directory website
```

Then open http://localhost:4321. (Also available as the `website` entry in `.claude/launch.json`.)

## When the apps are approved

Edit `assets/js/config.js` only:

```js
appStoreUrl: 'https://apps.apple.com/app/service-center/id…',
playStoreUrl: 'https://play.google.com/store/apps/details?id=com.servicecenter.app',
```

While a URL is empty, its badge shows **Coming soon** and is not clickable; once set, every badge on the landing page and docs becomes a live download link. The badges are drawn in CSS. Apple and Google require their official badge artwork once the apps are live, so swap in the official badges from Apple Marketing Tools and Google Play at that point.

## Light and dark themes

Both pages follow the visitor's system appearance by default. The round button in the nav cycles **Automatic → Light → Dark**; the choice is saved in `localStorage` (`sc-theme`). All colors come from the tokens at the top of `assets/css/site.css`.

## Deploy on Vercel

Create a **separate** Vercel project for this folder:

1. New Project → import this repository.
2. Set **Root Directory** to `website`.
3. Framework preset: **Other**. `vercel.json` already disables the install and build steps and serves the folder as is.

`vercel.json` also adds security headers, short asset caching (with `config.js` always revalidated so link changes go live immediately), clean URLs (`/docs`), and a `/app` redirect to the web app. Its `ignoreCommand` skips deployments when nothing under `website/` changed.

## Keeping the docs accurate

`docs/index.html` documents what is implemented today, checked against `frontend/src/pages`, `mobile/app`, and the shared i18n strings. When a feature ships or changes, update the matching section and the **Web vs. mobile** table.
