# HexLife — Live Specimens on Reddit

**HexLife** turns a hexagonal cellular automaton into an interactive Reddit post: a live,
GPU-rendered world you can play, pause, reseed/restart, and zoom — right in the feed.

Homepage / full lab: [HexLife Explorer](https://sidem.github.io/HexLife/)

---

## What it does

- **Live Specimen posts** — each post shows one world (ruleset + grid + starting cells + colors)
  as a playable simulation, not a GIF or video.
- **Create from the explorer** — design a world at [sidem.github.io/HexLife](https://sidem.github.io/HexLife/),
  export a **world code** (`HXW1.…`), then on a subreddit with this app installed use
  **⋯ → New HexLife post**, paste the code, and set a title.
- **In-post controls** — play / pause, restart, speed slider; scroll-wheel zoom (desktop) and
  pinch zoom (mobile). Click/drag to **draw** (invert brush, pause while drawing). Brush size
  comes from the explorer export (default 2 for older codes).
- **Open in Explorer** — deep-link to the full lab with the post’s ruleset loaded (`?r=<ruleset>`).
- **Starts paused** — play is explicit so large grids don’t lag phones scrolling past in the feed.
- **No external network calls** — the simulation engine (Rust → WebAssembly) and WebGL renderer
  are bundled in the webview. Redis only stores the world code per post ID.

## Who it’s for

- **r/hexlife** (and other communities that install the app) — share emergent hex-CA “specimens”
  that others can run live.
- Creators who already use HexLife Explorer and want a Reddit distribution surface.

## How to use (members)

1. Open [HexLife Explorer](https://sidem.github.io/HexLife/) and set up a world you like.
2. **Share → Copy World Code** (or **Copy code & open r/hexlife**).
3. On the subreddit where HexLife is installed: **subreddit menu (⋯) → New HexLife post**.
4. Paste the world code, optionally edit the title, create the post.
5. Open the post → tap play on the specimen.

**Note:** Reddit’s normal “create text post” screen is *not* the Live Specimen form. Only the
app menu (**New HexLife post**) creates an interactive post. There is no deep link from outside
Reddit into that form — that is a platform limitation, not a missing feature of this app.

## How to install (moderators)

1. Install **hexlifeapp** from the Reddit Apps tools for your community (after the app is
   published/approved, any mod can install; before that only the developer on small test subs).
2. Keep the sub under any install limits Reddit applies for unpublished apps (&lt; 200 subscribers).
3. Tell members the create path: explorer → world code → **⋯ → New HexLife post**.

No extra configuration is required. On install, a demo post may appear automatically.

## Privacy & data

- Stores **world codes** in Redis keyed by post ID (`world:<t3>`). A world code is the grid,
  ruleset, cells, and color settings of the simulation — not Reddit account passwords or private
  messages.
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
