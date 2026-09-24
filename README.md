# Backbone — Prototype

A **Prototype** workspace for Backbone. Share a live website (the one you're building with Claude Code) the way you'd share a Figma prototype: inside a MacBook or iPhone mockup, with pinned comments. The client never sees the website's real address.

**Live demo:** https://markelmallakh.github.io/prototype-tool/

## Demo (GitHub Pages)

The demo is a static build that runs entirely in the browser, so it can live on GitHub Pages:

- Every prototype previews a bundled sample site (`demo/site`) instead of a real link, since there's no preview server.
- Projects and comments are saved in each visitor's browser (localStorage), so teammates don't see each other's comments. **Reset demo** on the list page restores the sample data.
- Share links use `#/p/<token>` routes.

```bash
npm run build:demo     # → dist-demo/
npm run preview:demo   # http://localhost:5190/prototype-tool/
npm run deploy:demo    # build + push to the gh-pages branch
```

## Run it

```bash
npm install
npm run dev
```

- App: http://localhost:5180/prototype (Backbone top bar with the new **Prototype** tab)
- API: `:5181` · masked preview origin: `:5182`

With no `ADMIN_PASSWORD` set, admin sign-in is skipped (local dev only). Copy `.env.example` to `.env` to configure.

## How it works

| Piece | What it does |
| --- | --- |
| `/prototype` | Admin list of prototypes and **New prototype** (name, website link, MacBook 1512×982 or Mobile 430×932). |
| `/prototype/:id` | Admin presenter, plus **Share** (copy link, link on/off, comments on/off, reset link) and **Settings** (name, website link, default device, delete). |
| `/p/:token` | What the client opens: device mockup, Desktop/Mobile switch, comment tool (`C`), comments column. No URL anywhere. |
| `server/proxy.ts` | The **masked preview origin**. The iframe loads this origin, which forwards requests to the real site, rewrites its host, strips frame-blocking headers and injects the bridge. |
| `server/bridge.js` | Injected into every previewed page. Draws pins *inside* the page so they stay on their spot while scrolling, captures clicks in comment mode, and reports routes to the presenter. |
| `server/api.ts` | Projects (admin only; the only responses that include the URL) and share/comments (public by token, with live updates over SSE). |

Comments are anchored to the clicked element plus an offset, with the raw page position as a fallback. They're stored per page path and per device, so a mobile comment shows on the mobile view and clicking it from the list switches device.

## Deploying

The preview origin **must be a different origin** from the app. Otherwise the previewed site could read the admin session.

1. Point a subdomain at the same server, e.g. `preview.mitchdesigns.com`.
2. Set `PROXY_ORIGIN=https://preview.mitchdesigns.com`, `ADMIN_PASSWORD`, and `PORT`.
3. `npm run build && npm start`. Requests for the preview host are routed to the proxy automatically.

Keep the preview on the same registrable domain as the app (a subdomain), because the preview cookie has to work inside the iframe.

## Merging into Backbone

- **Tab:** add `{ key: 'prototype', label: 'Prototype', href: '/prototype' }` to Backbone's tab list (the `Sl` array in the header).
- **Auth:** replace `AdminGate` / `server/auth.ts#isAdmin` with Backbone's `mdpm_session` check (`/orbit/api/auth/me`).
- **Storage:** `server/db.ts` is a JSON file (`data/db.json`). Swap it for Backbone's database. The shapes are in `shared/types.ts`.
- **Routes:** mount `createApi()` under `/orbit/api/prototype` and add the three client routes.

## Limitations

- Sites that detect mobile by **user agent** on the server won't switch layouts. CSS breakpoints and JS width checks do.
- WebSocket-based features on the previewed site aren't proxied (dev-server hot reload, live chat widgets).
- Images and fonts served from another domain (e.g. a CDN bucket) load from that domain directly. That doesn't reveal the site's address.
