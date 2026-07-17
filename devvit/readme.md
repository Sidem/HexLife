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
  slider, the full ruleset hex, and click/drag **drawing** (invert brush, pauses while you draw —
  brush size comes from the explorer export, default 2 for older codes).
- **Zoom without hijacking the feed** — **ctrl/⌘ + scroll wheel** zooms on desktop (a plain scroll
  moves the page, as it should); trackpad pinch and touch pinch zoom directly.
- **Create your own from inside a post** — the expanded view has **Create your own**: paste a world
  code and your specimen is posted without leaving Reddit.
- **Posted as you** — specimens you create are authored by *your* account, not the app's, so they
  appear in your post history and earn your karma.
- **Open in Explorer** — deep-link to the full lab with the post’s ruleset loaded (`?r=<ruleset>`).
- **Starts paused** — play is explicit so large grids don’t lag phones scrolling past in the feed.
- **No external network calls** — the simulation engine (Rust → WebAssembly) and WebGL renderer
  are bundled in the webview. Redis only stores the world code per post ID.

## Who it’s for

- **r/hexlife** (and other communities that install the app) — share emergent hex-CA “specimens”
  that others can run live.
- Creators who already use HexLife Explorer and want a Reddit distribution surface.

## How to use (members)

**The easy way — remix a post you're already looking at:**

1. Expand any HexLife post.
2. Play with it: drag on the world to paint, let it run, pause where it looks good.
3. **Post my remix** → give it a title → done. What you see is exactly what gets posted, drawing
   and all.

**From the explorer** — for a world you build from scratch:

1. Open [HexLife Explorer](https://sidem.github.io/HexLife/) and set up a world you like.
2. **Share → Copy World Code** (or **Copy code & open r/hexlife**).
3. Paste it into either create path:
   - **From an existing post** — expand any HexLife post → **Create your own**.
   - **From the subreddit** — **subreddit menu (⋯) → New HexLife post**.
4. Optionally edit the title (leave it blank to name the post after its ruleset), then create.
5. Open the post → tap play on the specimen.

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
3. Tell members the create path: explorer → world code → **⋯ → New HexLife post**, or
   **Create your own** inside any existing HexLife post.

No extra configuration is required. On install, a demo post may appear automatically.

## Privacy & data

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
- Does **not** call external HTTP APIs, collect emails, or track users across sites.
- The in-post webview does **not** link out to third-party apps (attribution link is off).

## Support

- Issues / discussion: [GitHub — Sidem/HexLife](https://github.com/Sidem/HexLife)
- Subreddit: [r/hexlife](https://www.reddit.com/r/hexlife/)

## Developer notes

Source lives in the HexLife monorepo under `devvit/`. The webview imports the shared
`<hexlife-world>` embed (`src/embed/`) — one simulation engine for the explorer, embeds, and Reddit.

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
