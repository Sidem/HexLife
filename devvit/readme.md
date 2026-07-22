# HexLife — Live Specimens on Reddit

**HexLife** turns a hexagonal cellular automaton into an interactive Reddit post: a live,
GPU-rendered world you can play, pause, reseed/restart, and zoom — right in the feed.

Homepage / full lab: [HexLife Explorer](https://sidem.github.io/HexLife/)

---

## What it does

- **Live Specimen posts** — each post shows one world (ruleset + grid + starting cells + colors)
  as a playable simulation, not a GIF or video.
- **Post your remix** — draw on any specimen, then hit **Post my remix**: your version is posted
  exactly as it looks on screen. No copying, no pasting, no leaving Reddit.
- **Create from the explorer** — design a world at [sidem.github.io/HexLife](https://sidem.github.io/HexLife/),
  export a **world code** (`HXW1.…`), then on a subreddit with this app installed use
  **⋯ → New HexLife post**, paste the code, and set a title.
- **Tap to play** — in the feed, the specimen shows a play button over its starting state; the
  first tap runs it.
- **In-post controls** — play / pause and restart in the feed; the expanded view adds a speed
  slider, a **Ruleset** card, and click/drag **drawing** (invert brush, pauses while you draw —
  brush size comes from the explorer export, default 2 for older codes).
- **"What ruleset is this?"** — answered everywhere it gets asked: every specimen is created with
  a first comment naming its ruleset (with `B2/S35`-style notation when the rule reduces to
  neighbor counts, orbit notation like `B2o3p/S2` for rotationally symmetric rules), the card
  shows the notation next to the specimen name, and the expanded view's **Ruleset** button opens
  a read-only card — birth/survival diagrams, the full hex with copy, and a deep link that opens
  the Explorer's ruleset editor in the mode that fits the rule.
- **Zoom without hijacking the feed** — **ctrl/⌘ + scroll wheel** zooms on desktop (a plain scroll
  moves the page, as it should); trackpad pinch and touch pinch zoom directly.
- **Paste a code (advanced)** — the expanded view still has **Create your own** for pasting a
  world code from the explorer; the subreddit menu **⋯ → New HexLife post** does the same.
- **Posted as you** — specimens you create are authored by *your* account, not the app's, so they
  appear in your post history and earn your karma.
- **Open in Explorer** — deep-link to the full lab with the post’s ruleset loaded (`?r=<ruleset>`);
  the Ruleset card’s link adds `&edit=1`, which opens the lab with the ruleset editor already up.
- **Starts paused** — play is explicit so large grids don’t lag phones scrolling past in the feed.
- **No external network calls** — the simulation engine (Rust → WebAssembly) and WebGL renderer
  are bundled in the webview. Redis stores the world code per post ID, plus anonymous counts of how
  the controls get used (no identity, nothing on your device — see **Privacy & data**).

## Who it’s for

- **r/hexlife** (and other communities that install the app) — share emergent hex-CA “specimens”
  that others can run live.
- Creators who already use HexLife Explorer and want a Reddit distribution surface.

## How to use (members)

**The easy way — remix a post you're already looking at:**

1. Open any HexLife post and press **Open lab**.
2. Play with it: drag on the world to paint, let it run, pause where it looks good.
3. **Post my remix** → give it a title → done. What you see is exactly what gets posted, drawing
   and all.

**From the explorer** — for a world you build from scratch:

1. Open [HexLife Explorer](https://sidem.github.io/HexLife/) and set up a world you like.
2. **Share → Copy World Code** (or **Copy code & open r/hexlife**).
3. On the subreddit: **⋯ → New HexLife post** (or **Open lab** → **Create your own**),
   paste the code, optionally edit the title, and create.
4. Open the post → tap play on the specimen.

Every path authors the post as your account. If a code doesn’t paste cleanly, the form comes
back with what you typed still in it — world codes are long and easy to truncate.

**Note:** Reddit’s normal “create text post” screen is *not* the Live Specimen form. There is no
deep link from outside Reddit into it — that is a platform limitation, not a missing feature of
this app. If you do post a bare world code as text, the app replies with a link to a Live Specimen
of it rather than touching your post.

## How to install (moderators)

1. Install **hexlifeapp** from the Reddit Apps tools for your community (after the app is
   published/approved, any mod can install; before that only the developer on small test subs).
2. Keep the sub under any install limits Reddit applies for unpublished apps (&lt; 200 subscribers).
3. Tell members the easy path: **Open lab** → draw → **Post my remix**. Advanced:
   explorer → world code → **⋯ → New HexLife post**.

No extra configuration is required. On install, a demo post may appear automatically.

## Privacy & data

**Short version:** the app stores the worlds people post, and counts how its own controls get used.
It does not know who you are, does not store anything on your device, and never sends anything to
anyone but Reddit.

### Anonymous usage counts

The app counts interactions with its own controls — play, draw, open lab, post a remix — so the
interface can be improved by evidence rather than guesswork. This is worth being precise about:

- **No identity, ever.** No username, user ID, IP address, device or browser fingerprint, or
  anything derived from them is collected, stored, or transmitted. The app never asks Reddit who is
  looking at a post, and there is no field anywhere in the data where the answer could go.
- **Nothing is stored on your device.** No cookies, no `localStorage`, no `sessionStorage`. Each
  view generates a random number that exists only in memory, only while the page is open, and is
  gone when it closes. Two views by the same person are indistinguishable from two views by
  different people — including to us.
- **A closed list of events.** Only the fixed set of named interactions in
  [`src/shared/telemetry.ts`](src/shared/telemetry.ts) is recorded — never free text, never mouse
  coordinates, never anything you type or draw. Anything not on that list is discarded server-side.
- **Time is bucketed,** not measured: "stayed longer than 30 seconds", not a precise duration.
- **It stays on Reddit.** Counts are written to this app's own Reddit-hosted Redis. There is no
  third-party analytics service, no external endpoint, and no data sharing or sale of any kind.
- **Moderators see totals.** The **⋯ → HexLife usage stats** menu item shows aggregate counts to
  the community's moderators. Per-visit detail is withheld entirely on days with fewer than 10
  visits, so a single visit can never be matched to the person who made it.
- **It expires.** Per-visit records are deleted after 7 days, per-post counts after 30, and daily
  totals after 90. Deleting a post deletes its counts.

If you would rather not be counted at all, blocking the app's `api/track` request (or any content
blocker that stops background requests) disables it. Nothing else about the post changes.

### Everything else

- Stores **world codes** in Redis keyed by post ID (`world:<t3>`). A world code is the grid,
  ruleset, cells, and color settings of the simulation — not Reddit account passwords or private
  messages.
- **Posts on your behalf, only when you ask.** Creating a specimen submits the post as your account
  (`permissions.reddit.asUser: ["SUBMIT_POST"]`), which is why it earns your karma. This happens
  only in response to you submitting the create form — never in the background. The app-install
  demo post and the reply to a bare world-code text post are made by the app account.
- Each post also carries its own world code in Reddit's `postData` so it can render without a
  round-trip. Same data as Redis, no extra collection.
- On **post delete**, the stored code for that post is removed.
- Does **not** call external HTTP APIs, collect emails, or track users across sites or across
  visits. The app declares no `http.domains`, so it is technically incapable of reaching any server
  other than Reddit's.
- The in-post webview does **not** link out to third-party apps (attribution link is off). Links to
  HexLife Explorer are ordinary outbound links you choose to click, and carry only the ruleset.

## Support

- Issues / discussion: [GitHub — Sidem/HexLife](https://github.com/Sidem/HexLife)
- Subreddit: [r/hexlife](https://www.reddit.com/r/hexlife/)

## License

The source in this directory is **MIT**, under the repository's root [`LICENSE`](../LICENSE) —
the whole repo is single-licensed, so there is no per-directory exception to reason about.

Originally scaffolded from Reddit's Devvit web template
(BSD-3-Clause, © Reddit Inc.); whatever remains of that scaffold keeps its notice here.

## Developer notes

Source lives in the HexLife monorepo under `devvit/`. This is a **separate app with its own
toolchain** — TypeScript + esbuild + Biome, Node 22.6+, its own `package.json`, `tsconfig`s and
tests. The root project's `npm run lint` / `test` / `typecheck` deliberately do not cover it
(root ESLint ignores `devvit/**`, root Vitest only collects `tests/**`); `npm test` in *this*
directory is the gate, and CI runs both.

What the two apps share is the engine, and only through a declared surface:

| | |
| :--- | :--- |
| **`src/embed/api.js`** | Host boundary — ruleset descriptor, mnemonic names, world codec, GPU detection. DOM-free, so the Node server bundles it safely. Types in `api.d.ts` (this app builds with `allowJs: false`). |
| **`src/embed/index.js`** | Browser entry — importing it registers `<hexlife-world>`. Client only; it pulls in the sim and the GL renderer. |

**`devvit/` imports from `src/embed/` and nowhere else in `src/`.** One engine, one codec, one
determinism contract for the explorer, embeds and Reddit — and a rename in the main app can't
silently break the Reddit app. `tests/devvitBoundary.test.js` (root suite) fails the build if
anything reaches past it; the fix is to re-export the symbol from `api.js`, not to widen the check.

```bash
# Node 22.6+
npm install
npm test
npm run playtest   # or: npx devvit playtest hexlife
npx devvit publish # submit a version for Reddit review (owner only)
```

The webview bundles are code-split: `splash.js` and `game.js` are thin entries over one shared
chunk holding the embed runtime, so expanding a post reuses what the feed card already fetched.
Sourcemaps are emitted for dev/watch builds only — `--minify` (the publish build) drops them, since
`public/` uploads whole.

`INLINE_WASM=0 npm run build:client` emits the engine as a real `public/hexlife_wasm_bg.wasm`
instead of a base64 `data:` URI, which is ~33% smaller and allows streaming compilation. **It is
not the default and must not be published until a playtest confirms it**: whether the webview's CSP
permits a same-origin `fetch` of the asset is not knowable from here. `loadWasmBytes` handles both
forms, so the flag is the only thing that changes.
